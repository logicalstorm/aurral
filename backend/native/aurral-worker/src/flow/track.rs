use crate::types::PlaylistTrack;
use rand::seq::SliceRandom;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct TrackRange {
    pub start: usize,
    pub end: usize,
}

pub fn deep_dive_ranges(deep_dive: bool) -> Vec<TrackRange> {
    if deep_dive {
        vec![
            TrackRange { start: 9, end: 24 },
            TrackRange { start: 0, end: 9 },
            TrackRange {
                start: 0,
                end: usize::MAX,
            },
        ]
    } else {
        vec![
            TrackRange { start: 0, end: 9 },
            TrackRange {
                start: 0,
                end: usize::MAX,
            },
        ]
    }
}

pub fn artist_key(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn slice_range<'a>(track_list: &'a [Value], start: usize, end: usize) -> Vec<&'a Value> {
    if track_list.is_empty() || start >= track_list.len() {
        return Vec::new();
    }
    let safe_end = end.min(track_list.len() - 1);
    if safe_end < start {
        return Vec::new();
    }
    track_list[start..=safe_end].iter().collect()
}

pub fn pick_random_track<'a>(candidates: &[&'a Value]) -> Option<&'a Value> {
    let mut filtered: Vec<&Value> = candidates
        .iter()
        .copied()
        .filter(|track| {
            track
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
        })
        .collect();
    filtered.sort_by(|left, right| {
        let left_album = album_title(left);
        let right_album = album_title(right);
        if left_album.is_some() != right_album.is_some() {
            return right_album.is_some().cmp(&left_album.is_some());
        }
        let left_play = playcount(left);
        let right_play = playcount(right);
        right_play
            .cmp(&left_play)
            .then_with(|| track_name(left).cmp(&track_name(right)))
    });
    filtered.first().copied()
}

pub fn pick_track_from_ranges<'a>(
    track_list: &'a [Value],
    ranges: &[TrackRange],
) -> Option<&'a Value> {
    for range in ranges {
        let candidates: Vec<&Value> = slice_range(track_list, range.start, range.end)
            .into_iter()
            .filter(|track| !track_name(track).is_empty())
            .collect();
        if let Some(pick) = pick_random_track(&candidates) {
            return Some(pick);
        }
    }
    None
}

pub fn track_name(track: &Value) -> String {
    track
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

pub fn album_title(track: &Value) -> Option<String> {
    let title = track
        .pointer("/album/title")
        .or_else(|| track.get("album"))
        .and_then(|v| {
            if v.is_string() {
                v.as_str().map(|s| s.to_string())
            } else {
                v.get("title")
                    .or_else(|| v.get("#text"))
                    .and_then(|n| n.as_str())
                    .map(|s| s.to_string())
            }
        })?;
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn playcount(track: &Value) -> i64 {
    track
        .get("playcount")
        .or_else(|| track.get("listeners"))
        .and_then(|v| v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64()))
        .unwrap_or(0)
}

pub fn build_track_entry(
    artist_name: &str,
    track_name: &str,
    album_name: Option<String>,
    artist_mbid: Option<String>,
    album_mbid: Option<String>,
    track_mbid: Option<String>,
    release_year: Option<String>,
    reason: &str,
) -> Option<PlaylistTrack> {
    let safe_artist = artist_name.trim();
    let safe_track = track_name.trim();
    if safe_artist.is_empty() || safe_track.is_empty() {
        return None;
    }
    Some(PlaylistTrack {
        artist_name: Some(safe_artist.to_string()),
        track_name: Some(safe_track.to_string()),
        album_name: album_name.filter(|s| !s.trim().is_empty()),
        artist_mbid: artist_mbid.filter(|s| !s.trim().is_empty()),
        album_mbid: album_mbid.filter(|s| !s.trim().is_empty()),
        track_mbid: track_mbid.filter(|s| !s.trim().is_empty()),
        release_year: release_year.and_then(|year| year.chars().take(4).collect::<String>().parse().ok()),
        reason: Some(reason.to_string()),
    })
}

pub fn track_from_value(
    pick: &Value,
    artist_name: &str,
    artist_mbid: Option<String>,
    reason: &str,
) -> Option<PlaylistTrack> {
    let track_name = track_name(pick);
    if track_name.is_empty() {
        return None;
    }
    build_track_entry(
        artist_name,
        &track_name,
        album_title(pick),
        artist_mbid,
        None,
        None,
        None,
        reason,
    )
}

pub fn shuffle<T>(items: &mut [T]) {
    let mut rng = rand::thread_rng();
    items.shuffle(&mut rng);
}
