use crate::slskd::normalize::{
    extract_track_number, get_file_base_name, read_comparable_album_name,
};
use crate::slskd::scoring::{
    is_strong_enough_candidate, pick_best_artist_score, score_sibling_track_conflict,
    score_variant_compatibility,
};
use crate::slskd::types::{FlowTrackContext, ValidationResult, ValidationScores};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::Accessor;
use serde_json::Value;
use std::path::Path;

fn score_year_match(directory_text: &str, release_year: Option<&str>) -> i32 {
    use crate::slskd::normalize::get_year;
    let expected = release_year.and_then(|value| get_year(value));
    let Some(expected) = expected else {
        return 0;
    };
    if directory_text.contains(&expected) {
        12
    } else {
        0
    }
}

fn has_conflicting_year(directory_text: &str, release_year: Option<&str>) -> bool {
    use crate::slskd::normalize::{get_year, get_years};
    let expected = release_year.and_then(|value| get_year(value));
    let Some(expected) = expected else {
        return false;
    };
    let years = get_years(directory_text);
    !years.is_empty() && !years.iter().any(|year| year == &expected)
}

fn score_text_match(left: &str, right: &str) -> i32 {
    crate::slskd::normalize::score_text_match(left, right)
}

fn get_remote_filename(candidate: &Value) -> String {
    candidate
        .get("raw")
        .and_then(|raw| raw.get("file"))
        .or_else(|| candidate.get("file"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string()
}

fn read_pre_download_valid(candidate: &Value) -> bool {
    candidate
        .get("preDownloadValid")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn best_artist_tag(artist: Option<&str>, album_artist: Option<&str>) -> String {
    [artist, album_artist]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>()
        .join(" ")
}

fn read_download_duration_validation(
    duration_seconds: Option<f64>,
    expected_duration: i64,
) -> (Option<i64>, bool) {
    let actual_duration_ms = duration_seconds
        .filter(|value| *value > 0.0)
        .map(|value| (value * 1000.0).round() as i64);
    let duration_diff_ms = if expected_duration > 0 {
        actual_duration_ms.map(|actual| (actual - expected_duration).abs())
    } else {
        None
    };
    let duration_valid = duration_diff_ms.is_none()
        || duration_diff_ms.unwrap_or(0) <= 25_000
        || duration_diff_ms.unwrap_or(0)
            <= (12_000).max((expected_duration as f64 * 0.18) as i64);
    (actual_duration_ms, duration_valid)
}

pub fn validate_downloaded_track(
    file_path: &str,
    candidate: &Value,
    context: &FlowTrackContext,
) -> ValidationResult {
    let remote_filename = get_remote_filename(candidate);
    let remote_base_name = get_file_base_name(&remote_filename);
    let expected_duration = context.duration_ms.unwrap_or(0);
    let mut title_from_tags = String::new();
    let mut artist_from_tags = String::new();
    let mut album_from_tags = String::new();
    let mut parsed_duration: Option<f64> = None;
    let mut parsed_track_number: Option<i32> = None;

    if let Ok(tagged) = Probe::open(Path::new(file_path)).and_then(|probe| probe.read()) {
        parsed_duration = Some(tagged.properties().duration().as_secs_f64());
        if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
            title_from_tags = tag
                .title()
                .as_deref()
                .map(str::to_string)
                .unwrap_or_default();
            artist_from_tags = best_artist_tag(tag.artist().as_deref(), None);
            album_from_tags = tag
                .album()
                .as_deref()
                .map(str::to_string)
                .unwrap_or_default();
            if let Some(track) = tag.track() {
                if track > 0 {
                    parsed_track_number = Some(track as i32);
                }
            }
        }
    }

    let album_name = read_comparable_album_name(context.album_name.as_deref());
    let title_score = score_text_match(&title_from_tags, &context.track_name)
        .max(score_text_match(&remote_filename, &context.track_name));
    let artist_score = pick_best_artist_score(context, &artist_from_tags)
        .max(pick_best_artist_score(context, &remote_filename));
    let album_score = if album_name.is_empty() {
        0
    } else {
        score_text_match(&album_from_tags, &album_name)
            .max(score_text_match(&remote_filename, &album_name))
    };
    let year_score = score_year_match(&remote_filename, context.release_year.as_deref());
    let year_mismatch =
        has_conflicting_year(&remote_filename, context.release_year.as_deref());
    let variant_match = score_variant_compatibility(&context.track_name, &remote_base_name);
    let filename_track_number = extract_track_number(&remote_base_name);
    let actual_track_number = filename_track_number.or(parsed_track_number);
    let track_number_mismatch = context.track_number.filter(|value| *value > 0).is_some()
        && actual_track_number.filter(|value| *value > 0).is_some()
        && context.track_number != actual_track_number;
    let sibling_track_penalty =
        score_sibling_track_conflict(&remote_base_name, context, title_score);
    let match_check = is_strong_enough_candidate(
        title_score,
        artist_score,
        album_score,
        year_score,
        year_mismatch,
        &variant_match,
        18,
        0,
        track_number_mismatch,
        sibling_track_penalty,
        context,
    );
    let (actual_duration_ms, duration_valid) =
        read_download_duration_validation(parsed_duration, expected_duration);
    let valid = match_check.valid && duration_valid;
    let reason = if valid {
        None
    } else if !match_check.valid {
        Some(format!(
            "{}: title={}, artist={}, album={}, variantScore={}, trackNumberMismatch={}",
            match_check.reason.clone().unwrap_or_default(),
            title_score,
            artist_score,
            album_score,
            variant_match.score,
            track_number_mismatch
        ))
    } else {
        Some(format!(
            "duration-mismatch: title={}, artist={}, album={}, durationValid={}",
            title_score, artist_score, album_score, duration_valid
        ))
    };
    ValidationResult {
        valid,
        reason,
        scores: ValidationScores {
            title: title_score,
            artist: artist_score,
            album: album_score,
            duration_valid,
            variant: variant_match.score,
            track_number_mismatch,
            match_reason: match_check.reason,
            pre_download_valid: read_pre_download_valid(candidate),
        },
        actual_duration_ms,
        remote_filename,
    }
}
