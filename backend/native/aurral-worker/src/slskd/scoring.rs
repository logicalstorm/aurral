use crate::slskd::normalize::{
    extract_track_number, extract_variant_profile, get_file_base_name, get_file_extension,
    get_file_name, get_path_parts, get_year, get_years, is_ambiguous_title_album_context,
    is_self_titled_album_context, normalize_title, read_comparable_album_name, score_text_match,
    VariantProfile, AUDIO_EXTENSIONS,
};
use crate::slskd::types::{FlowTrackContext, MatcherOptions, RawSearchResult};

#[derive(Debug, Clone)]
pub struct VariantMatch {
    pub score: i32,
    pub hard_mismatch: bool,
}

#[derive(Debug, Clone)]
pub struct StrongEnoughResult {
    pub valid: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TracklistMatch {
    pub score: i32,
    pub matched_count: usize,
    pub ratio: f64,
}

#[derive(Debug, Clone)]
pub struct FolderScores {
    pub blacklisted: bool,
    pub score: i32,
    pub artist_score: i32,
    pub album_score: i32,
    pub year_score: i32,
    pub year_mismatch: bool,
    pub track_count_score: i32,
    pub tracklist_score: i32,
    pub tracklist_matched_count: usize,
    pub tracklist_match_ratio: f64,
}

#[derive(Debug, Clone)]
pub struct SearchGroup {
    pub user: String,
    pub directory_path: String,
    pub parts: Vec<String>,
    pub audio_files: Vec<RawSearchResult>,
    pub audio_file_count: usize,
}

pub fn read_matcher_options(options: &MatcherOptions) -> (String, bool) {
    let preferred = if options.preferred_format.as_deref() == Some("mp3") {
        "mp3".to_string()
    } else {
        "flac".to_string()
    };
    (preferred, options.strict_format)
}

pub fn is_user_blacklisted(username: &str, options: &MatcherOptions) -> bool {
    let key = username.trim().to_lowercase();
    let Some(stats) = options.peer_stats.get(&key) else {
        return false;
    };
    if stats.successes > 0 {
        return false;
    }
    stats.failures >= 5 || stats.validation_failures >= 3
}

pub fn get_user_queue_penalty(username: &str, options: &MatcherOptions) -> i32 {
    let key = username.trim().to_lowercase();
    let Some(stats) = options.peer_stats.get(&key) else {
        return 0;
    };
    let penalty = stats.active as i32 * 80
        + stats.failures as i32 * 25
        + stats.validation_failures as i32 * 20
        - stats.successes as i32 * 8;
    penalty.max(0).min(220)
}

fn score_track_count(expected: Option<i32>, actual: usize) -> i32 {
    let Some(expected) = expected.filter(|value| *value > 0) else {
        return 0;
    };
    let actual = actual as i32;
    if actual == expected {
        return 30;
    }
    let diff = (actual - expected).abs();
    if diff == 1 {
        18
    } else if diff == 2 {
        6
    } else {
        -(diff * 5).min(20)
    }
}

pub fn score_tracklist_match(audio_files: &[RawSearchResult], context: &FlowTrackContext) -> TracklistMatch {
    let titles = &context.album_track_titles;
    if titles.is_empty() {
        return TracklistMatch {
            score: 0,
            matched_count: 0,
            ratio: 0.0,
        };
    }
    let file_names: Vec<String> = audio_files
        .iter()
        .map(|item| get_file_base_name(&item.file))
        .collect();
    if file_names.is_empty() {
        return TracklistMatch {
            score: 0,
            matched_count: 0,
            ratio: 0.0,
        };
    }
    let mut used_files = vec![false; file_names.len()];
    let mut matched_count = 0usize;
    for title in titles {
        let mut best_score = 0i32;
        let mut best_index: Option<usize> = None;
        for (index, file_name) in file_names.iter().enumerate() {
            if used_files[index] {
                continue;
            }
            let match_score = score_text_match(file_name, title);
            if match_score >= 75 && match_score > best_score {
                best_score = match_score;
                best_index = Some(index);
            }
        }
        if let Some(index) = best_index {
            matched_count += 1;
            used_files[index] = true;
        }
    }
    let ratio = matched_count as f64 / titles.len() as f64;
    let score = if ratio >= 0.85 {
        40
    } else if ratio >= 0.65 {
        28
    } else if ratio >= 0.45 {
        14
    } else if ratio >= 0.25 {
        4
    } else {
        0
    };
    TracklistMatch {
        score,
        matched_count,
        ratio,
    }
}

fn score_year_match(directory_text: &str, release_year: Option<&str>) -> i32 {
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
    let expected = release_year.and_then(|value| get_year(value));
    let Some(expected) = expected else {
        return false;
    };
    let years = get_years(directory_text);
    !years.is_empty() && !years.iter().any(|year| year == &expected)
}

pub fn score_variant_compatibility(expected_title: &str, actual_title: &str) -> VariantMatch {
    let expected = extract_variant_profile(expected_title);
    let actual = extract_variant_profile(actual_title);
    let mut score = 0i32;
    let mut hard_mismatch = false;

    let compare_bool = |key: &str,
                        expected: &VariantProfile,
                        actual: &VariantProfile,
                        score: &mut i32,
                        hard: &mut bool,
                        bonus: i32,
                        penalty: i32| {
        let (exp, act) = match key {
            "live" => (expected.live, actual.live),
            "acoustic" => (expected.acoustic, actual.acoustic),
            "demo" => (expected.demo, actual.demo),
            "instrumental" => (expected.instrumental, actual.instrumental),
            "karaoke" => (expected.karaoke, actual.karaoke),
            _ => (false, false),
        };
        if exp && act {
            *score += bonus;
        } else if exp != act && (exp || act) {
            *score -= penalty;
            *hard = true;
        }
    };

    compare_bool("live", &expected, &actual, &mut score, &mut hard_mismatch, 14, 120);
    compare_bool(
        "acoustic",
        &expected,
        &actual,
        &mut score,
        &mut hard_mismatch,
        12,
        90,
    );
    compare_bool("demo", &expected, &actual, &mut score, &mut hard_mismatch, 12, 90);
    compare_bool(
        "instrumental",
        &expected,
        &actual,
        &mut score,
        &mut hard_mismatch,
        10,
        80,
    );
    compare_bool(
        "karaoke",
        &expected,
        &actual,
        &mut score,
        &mut hard_mismatch,
        10,
        80,
    );

    match (&expected.mix_variant, &actual.mix_variant) {
        (Some(left), Some(right)) if left == right => score += 10,
        (Some(_), Some(_)) => {
            score -= 95;
            hard_mismatch = true;
        }
        (None, None) => {}
        _ => {
            score -= 95;
            hard_mismatch = true;
        }
    }

    match (&expected.mono_stereo, &actual.mono_stereo) {
        (Some(left), Some(right)) if left == right => score += 6,
        (Some(_), Some(_)) => score -= 10,
        (None, None) => {}
        _ => score -= 6,
    }

    match (&expected.content_rating, &actual.content_rating) {
        (Some(left), Some(right)) if left == right => score += 4,
        (Some(_), Some(_)) => score -= 6,
        _ => {}
    }

    VariantMatch { score, hard_mismatch }
}

fn score_track_number_match(expected: Option<i32>, actual: Option<i32>) -> i32 {
    let Some(expected) = expected.filter(|value| *value > 0) else {
        return 0;
    };
    let Some(actual) = actual.filter(|value| *value > 0) else {
        return 0;
    };
    if expected == actual {
        18
    } else if (expected - actual).abs() == 1 {
        -8
    } else {
        -22
    }
}

fn score_title_confidence(title_score: i32) -> i32 {
    if title_score >= 95 {
        18
    } else if title_score >= 82 {
        10
    } else if title_score >= 65 {
        0
    } else if title_score >= 45 {
        -25
    } else {
        -60
    }
}

pub(crate) fn score_sibling_track_conflict(base_name: &str, context: &FlowTrackContext, title_score: i32) -> i32 {
    let titles = &context.album_track_titles;
    if titles.is_empty() {
        return 0;
    }
    let target_key = normalize_title(&context.track_name);
    let best_other = titles
        .iter()
        .filter(|title| normalize_title(title) != target_key)
        .map(|title| score_text_match(base_name, title))
        .max()
        .unwrap_or(0);
    if best_other >= 90 && best_other >= title_score + 25 {
        -120
    } else if best_other >= 82 && best_other >= title_score + 15 {
        -70
    } else {
        0
    }
}

pub fn is_strong_enough_candidate(
    title_score: i32,
    artist_score: i32,
    album_score: i32,
    year_score: i32,
    year_mismatch: bool,
    variant_match: &VariantMatch,
    track_count_score: i32,
    tracklist_score: i32,
    track_number_mismatch: bool,
    sibling_track_penalty: i32,
    context: &FlowTrackContext,
) -> StrongEnoughResult {
    if variant_match.hard_mismatch {
        return StrongEnoughResult {
            valid: false,
            reason: Some("variant-mismatch".to_string()),
        };
    }
    if sibling_track_penalty <= -100 {
        return StrongEnoughResult {
            valid: false,
            reason: Some("sibling-track-conflict".to_string()),
        };
    }
    if title_score < 58 {
        return StrongEnoughResult {
            valid: false,
            reason: Some("weak-title-match".to_string()),
        };
    }
    if !context.artist_name.is_empty()
        && is_ambiguous_title_album_context(context.album_name.as_deref(), &context.track_name)
        && artist_score < 45
    {
        return StrongEnoughResult {
            valid: false,
            reason: Some("weak-artist-ambiguous-title-album".to_string()),
        };
    }
    if !context.artist_name.is_empty()
        && is_self_titled_album_context(&context.artist_name, context.album_name.as_deref())
    {
        if year_mismatch {
            return StrongEnoughResult {
                valid: false,
                reason: Some("self-titled-year-mismatch".to_string()),
            };
        }
        if context
            .release_year
            .as_deref()
            .and_then(|value| get_year(value))
            .is_some()
            && year_score <= 0
            && track_count_score < 18
            && tracklist_score < 14
        {
            return StrongEnoughResult {
                valid: false,
                reason: Some("weak-self-titled-release-context".to_string()),
            };
        }
    }
    if artist_score < 45 && !(title_score >= 72 && album_score >= 35) {
        return StrongEnoughResult {
            valid: false,
            reason: Some("weak-artist-match".to_string()),
        };
    }
    if title_score < 72 && artist_score < 58 {
        return StrongEnoughResult {
            valid: false,
            reason: Some("weak-title-artist-combo".to_string()),
        };
    }
    if track_number_mismatch && title_score < 95 {
        return StrongEnoughResult {
            valid: false,
            reason: Some("track-number-mismatch".to_string()),
        };
    }
    if context.album_name.as_deref().is_some_and(|value| !value.is_empty())
        && album_score < 18
        && track_count_score < 18
        && !(title_score >= 90 && artist_score >= 90)
        && title_score < 92
    {
        return StrongEnoughResult {
            valid: false,
            reason: Some("weak-album-context".to_string()),
        };
    }
    StrongEnoughResult {
        valid: true,
        reason: None,
    }
}

pub fn pick_best_artist_score(context: &FlowTrackContext, text: &str) -> i32 {
    let mut candidates = vec![context.artist_name.clone()];
    candidates.extend(context.artist_aliases.clone());
    candidates
        .iter()
        .map(|entry| score_text_match(text, entry))
        .max()
        .unwrap_or(0)
}

pub fn score_release_folder(
    group: &SearchGroup,
    context: &FlowTrackContext,
    options: &MatcherOptions,
) -> FolderScores {
    if is_user_blacklisted(&group.user, options) {
        return FolderScores {
            blacklisted: true,
            score: 0,
            artist_score: 0,
            album_score: 0,
            year_score: 0,
            year_mismatch: false,
            track_count_score: 0,
            tracklist_score: 0,
            tracklist_matched_count: 0,
            tracklist_match_ratio: 0.0,
        };
    }
    let album_name = read_comparable_album_name(context.album_name.as_deref());
    let raw_directory_text = group.directory_path.clone();
    let artist_dir = group
        .parts
        .get(group.parts.len().saturating_sub(3))
        .cloned()
        .unwrap_or_default();
    let album_dir = group
        .parts
        .get(group.parts.len().saturating_sub(2))
        .cloned()
        .unwrap_or_default();
    let artist_score = pick_best_artist_score(context, &group.directory_path)
        .max(pick_best_artist_score(context, &artist_dir));
    let album_score = if album_name.is_empty() {
        0
    } else {
        score_text_match(&group.directory_path, &album_name)
            .max(score_text_match(&album_dir, &album_name))
    };
    let year_score = score_year_match(&raw_directory_text, context.release_year.as_deref());
    let track_count_score = score_track_count(context.album_track_count, group.audio_files.len());
    let tracklist_match = score_tracklist_match(&group.audio_files, context);
    let year_mismatch =
        has_conflicting_year(&raw_directory_text, context.release_year.as_deref());
    let availability_score = if group.audio_files.iter().any(|item| item.slots.unwrap_or(false)) {
        8
    } else {
        0
    };
    let speed_score = group
        .audio_files
        .iter()
        .map(|item| item.speed.unwrap_or(0))
        .max()
        .map(|speed| ((speed / 250_000) as i32).min(12))
        .unwrap_or(0);
    let user_queue_penalty_score =
        -(get_user_queue_penalty(&group.user, options) / 2).min(120);
    FolderScores {
        blacklisted: false,
        score: artist_score
            + album_score
            + year_score
            + track_count_score
            + tracklist_match.score
            + availability_score
            + speed_score
            + user_queue_penalty_score,
        artist_score,
        album_score,
        year_score,
        year_mismatch,
        track_count_score,
        tracklist_score: tracklist_match.score,
        tracklist_matched_count: tracklist_match.matched_count,
        tracklist_match_ratio: tracklist_match.ratio,
    }
}

pub fn is_release_folder_fitting(
    group: &SearchGroup,
    context: &FlowTrackContext,
    folder_scores: &FolderScores,
) -> bool {
    let album_name = read_comparable_album_name(context.album_name.as_deref());
    if album_name.is_empty() {
        return true;
    }
    let FolderScores {
        artist_score,
        album_score,
        track_count_score,
        tracklist_score,
        ..
    } = folder_scores;
    if *album_score < 18 && *track_count_score < 18 && *tracklist_score < 14 {
        return false;
    }
    if *album_score < 18 && *artist_score < 45 && *tracklist_score < 14 {
        return false;
    }
    if let Some(expected_count) = context.album_track_count.filter(|value| *value > 0) {
        let actual_count = group.audio_files.len() as i32;
        if actual_count > 0 {
            let diff = (actual_count - expected_count).abs();
            if diff > 5 {
                return false;
            }
            if diff > 3 && *album_score < 35 && *tracklist_score < 14 {
                return false;
            }
        }
    }
    let expected_titles = context.album_track_titles.len();
    if expected_titles >= 4 && *tracklist_score < 4 && *album_score < 35 && *track_count_score < 18
    {
        return false;
    }
    if *artist_score < 35 && *album_score < 50 && *tracklist_score < 14 {
        return false;
    }
    true
}

pub fn is_locked_search_result(item: &RawSearchResult) -> bool {
    item.locked.unwrap_or(false) || item.is_locked.unwrap_or(false)
}

fn is_audio_extension(ext: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&ext)
}

pub fn group_flow_search_results(results: &[RawSearchResult]) -> Vec<SearchGroup> {
    use std::collections::HashMap;
    let mut groups: HashMap<String, SearchGroup> = HashMap::new();
    for item in results {
        let parts = get_path_parts(&item.file);
        if parts.is_empty() {
            continue;
        }
        let directory = parts[..parts.len().saturating_sub(1)].join("/");
        let user = item.user.trim().to_string();
        let key = format!("{user}\0{directory}");
        let entry = groups.entry(key).or_insert_with(|| SearchGroup {
            user: user.clone(),
            directory_path: directory.clone(),
            parts: parts.clone(),
            audio_files: Vec::new(),
            audio_file_count: 0,
        });
        entry.audio_files.push(item.clone());
    }
    let mut grouped = Vec::new();
    for mut group in groups.into_values() {
        group.audio_files = group
            .audio_files
            .into_iter()
            .filter(|item| {
                !is_locked_search_result(item)
                    && is_audio_extension(&get_file_extension(&item.file))
            })
            .collect();
        if group.audio_files.is_empty() {
            continue;
        }
        group.audio_file_count = group.audio_files.len();
        grouped.push(group);
    }
    grouped
}

fn format_rank(ext: &str, preferred_format: &str) -> i32 {
    if preferred_format == "mp3" {
        if ext == ".mp3" {
            0
        } else if ext == ".flac" {
            1
        } else {
            2
        }
    } else if ext == ".flac" {
        0
    } else if ext == ".mp3" {
        1
    } else {
        2
    }
}

pub fn build_group_candidates(
    group: &SearchGroup,
    context: &FlowTrackContext,
    options: &MatcherOptions,
) -> Vec<crate::slskd::types::RankedCandidate> {
    use crate::slskd::types::{CandidateBreakdown, RankedCandidate};
    let folder_scores = score_release_folder(group, context, options);
    if folder_scores.blacklisted {
        return Vec::new();
    }
    let (preferred_format, strict_format) = read_matcher_options(options);
    let album_dir = group
        .parts
        .get(group.parts.len().saturating_sub(2))
        .cloned()
        .unwrap_or_default();
    let files: Vec<&RawSearchResult> = if strict_format {
        group
            .audio_files
            .iter()
            .filter(|item| get_file_extension(&item.file) == format!(".{preferred_format}"))
            .collect()
    } else {
        group.audio_files.iter().collect()
    };
    let mut candidates = Vec::new();
    for item in files {
        let ext = get_file_extension(&item.file);
        let base_name = get_file_base_name(&item.file);
        let title_score = score_text_match(&base_name, &context.track_name)
            .max(score_text_match(&get_file_name(&item.file), &context.track_name));
        let variant_match = score_variant_compatibility(&context.track_name, &base_name);
        let track_number_score =
            score_track_number_match(context.track_number, extract_track_number(&base_name));
        let actual_track_number = extract_track_number(&base_name);
        let track_number_mismatch = context.track_number.filter(|value| *value > 0).is_some()
            && actual_track_number.filter(|value| *value > 0).is_some()
            && context.track_number != actual_track_number;
        let title_confidence_score = score_title_confidence(title_score);
        let sibling_track_penalty =
            score_sibling_track_conflict(&base_name, context, title_score);
        let pre_download_check = is_strong_enough_candidate(
            title_score,
            folder_scores.artist_score,
            folder_scores.album_score,
            folder_scores.year_score,
            folder_scores.year_mismatch,
            &variant_match,
            folder_scores.track_count_score,
            folder_scores.tracklist_score,
            track_number_mismatch,
            sibling_track_penalty,
            context,
        );
        let format_score = if ext == format!(".{preferred_format}") {
            18
        } else if ext == ".flac" || ext == ".mp3" {
            9
        } else {
            0
        };
        let bitrate = item.bitrate.unwrap_or(0);
        let bitrate_score = if bitrate > 0 {
            (bitrate / 64).min(8)
        } else {
            0
        };
        let user_queue_penalty_score =
            -(get_user_queue_penalty(&group.user, options) / 2).min(120);
        let availability_score = if item.slots.unwrap_or(false) { 8 } else { 0 };
        let speed_score = ((item.speed.unwrap_or(0) / 250_000) as i32).min(12);
        let total_score = folder_scores.artist_score
            + folder_scores.album_score
            + title_score
            + folder_scores.year_score
            + folder_scores.track_count_score
            + availability_score
            + speed_score
            + user_queue_penalty_score
            + variant_match.score
            + track_number_score
            + title_confidence_score
            + sibling_track_penalty
            + format_score
            + bitrate_score as i32;
        let album_name = read_comparable_album_name(context.album_name.as_deref());
        candidates.push(RankedCandidate {
            raw: item.clone(),
            ext,
            score: total_score,
            pre_download_valid: pre_download_check.valid,
            pre_download_reject_reason: pre_download_check.reason,
            is_likely_match: title_score >= 75
                && (folder_scores.artist_score >= 55
                    || (folder_scores.album_score >= 35 && title_score >= 82))
                && (album_name.is_empty()
                    || folder_scores.album_score >= 35
                    || folder_scores.track_count_score >= 18),
            breakdown: CandidateBreakdown {
                artist_score: folder_scores.artist_score,
                album_score: folder_scores.album_score,
                title_score,
                year_score: folder_scores.year_score,
                track_count_score: folder_scores.track_count_score,
                user_queue_penalty_score,
                variant_score: variant_match.score,
                variant_hard_mismatch: variant_match.hard_mismatch,
                track_number_mismatch,
                track_number_score,
                title_confidence_score,
                sibling_track_penalty,
                format_score,
                speed: item.speed.unwrap_or(0),
                slots: if item.slots.unwrap_or(false) { 1 } else { 0 },
                bitrate,
            },
            resolved_album_name: if album_name.is_empty() {
                Some(album_dir.clone())
            } else {
                Some(album_name)
            },
            release_folder_fit: None,
            folder_score: None,
        });
    }
    candidates.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| {
                format_rank(&left.ext, &preferred_format)
                    .cmp(&format_rank(&right.ext, &preferred_format))
            })
            .then_with(|| right.raw.speed.unwrap_or(0).cmp(&left.raw.speed.unwrap_or(0)))
    });
    candidates
}

pub fn pick_best_track_candidate(
    track_candidates: &[crate::slskd::types::RankedCandidate],
) -> Option<crate::slskd::types::RankedCandidate> {
    track_candidates
        .iter()
        .find(|entry| entry.pre_download_valid)
        .or_else(|| track_candidates.iter().find(|entry| entry.is_likely_match))
        .or_else(|| track_candidates.first())
        .cloned()
}

pub fn rank_flow_search_results_flat(
    results: &[RawSearchResult],
    context: &FlowTrackContext,
    options: &MatcherOptions,
) -> Vec<crate::slskd::types::RankedCandidate> {
    let mut ranked = Vec::new();
    for group in group_flow_search_results(results) {
        ranked.extend(build_group_candidates(&group, context, options));
    }
    ranked.sort_by(|left, right| right.score.cmp(&left.score));
    ranked
}

pub fn rank_flow_search_results(
    results: &[RawSearchResult],
    context: &FlowTrackContext,
    options: &MatcherOptions,
) -> Vec<crate::slskd::types::RankedCandidate> {
    let album_name = read_comparable_album_name(context.album_name.as_deref());
    if album_name.is_empty() {
        return rank_flow_search_results_flat(results, context, options);
    }
    let groups = group_flow_search_results(results);
    let mut folder_entries = Vec::new();
    for group in groups {
        let folder_scores = score_release_folder(&group, context, options);
        if folder_scores.blacklisted {
            continue;
        }
        let track_candidates = build_group_candidates(&group, context, options);
        if track_candidates.is_empty() {
            continue;
        }
        let fitting = is_release_folder_fitting(&group, context, &folder_scores);
        folder_entries.push((group, folder_scores, fitting, track_candidates));
    }
    let mut fitting_folders: Vec<_> = folder_entries
        .iter()
        .filter(|(_, _, fitting, tracks)| {
            *fitting && tracks.iter().any(|track| track.pre_download_valid)
        })
        .collect();
    fitting_folders.sort_by(|left, right| {
        right
            .1
            .score
            .cmp(&left.1.score)
            .then_with(|| {
                let left_track = pick_best_track_candidate(&left.3);
                let right_track = pick_best_track_candidate(&right.3);
                right_track
                    .map(|entry| entry.score)
                    .unwrap_or(0)
                    .cmp(&left_track.map(|entry| entry.score).unwrap_or(0))
            })
    });
    let mut ranked = Vec::new();
    for (_, folder_scores, _, track_candidates) in fitting_folders {
        if let Some(mut best) = pick_best_track_candidate(track_candidates) {
            best.release_folder_fit = Some(true);
            best.folder_score = Some(folder_scores.score);
            ranked.push(best);
        }
    }
    if !ranked.is_empty() {
        return ranked;
    }
    rank_flow_search_results_flat(results, context, options)
}

pub fn select_ranked_match_attempts(
    matches: &[crate::slskd::types::RankedCandidate],
    limit: usize,
) -> Vec<crate::slskd::types::RankedCandidate> {
    let max = if limit > 0 { limit } else { 5 };
    if matches.len() <= max {
        return matches.to_vec();
    }
    let mut selected = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();
    let mut seen_users = std::collections::HashSet::new();
    let get_key = |candidate: &crate::slskd::types::RankedCandidate| {
        format!(
            "{}\0{}",
            candidate.raw.user.trim().to_lowercase(),
            candidate.raw.file.trim().to_lowercase()
        )
    };
    for candidate in matches {
        if selected.len() >= max {
            break;
        }
        let key = get_key(candidate);
        let user = candidate.raw.user.trim().to_lowercase();
        if key.is_empty() || seen_keys.contains(&key) || user.is_empty() || seen_users.contains(&user)
        {
            continue;
        }
        seen_keys.insert(key);
        seen_users.insert(user);
        selected.push(candidate.clone());
    }
    for candidate in matches {
        if selected.len() >= max {
            break;
        }
        let key = get_key(candidate);
        if key.is_empty() || seen_keys.contains(&key) {
            continue;
        }
        seen_keys.insert(key);
        selected.push(candidate.clone());
    }
    selected
}

pub fn count_pre_download_valid_candidates(
    results: &[RawSearchResult],
    context: &FlowTrackContext,
    options: &MatcherOptions,
) -> usize {
    rank_flow_search_results(results, context, options)
        .iter()
        .filter(|entry| entry.pre_download_valid)
        .count()
}
