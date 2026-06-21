use crate::flow::track::artist_key;
use crate::types::PlaylistTrack;

#[derive(Debug, Clone)]
pub struct FlowCandidate {
    pub track: PlaylistTrack,
    pub source_rank: usize,
    pub focus_priority: i64,
    pub final_score: i64,
}

impl FlowCandidate {
    pub fn from_track(track: PlaylistTrack, _source: &str, source_rank: usize) -> Option<Self> {
        let artist = track.artist_name.clone().unwrap_or_default();
        let track_name = track.track_name.clone().unwrap_or_default();
        if artist.trim().is_empty() || track_name.trim().is_empty() {
            return None;
        }
        let metadata_confidence = (if track.album_name.is_some() { 0.45 } else { 0.0 })
            + (if track.release_year.is_some() { 0.2 } else { 0.0 })
            + (if track.track_mbid.is_some() { 0.1 } else { 0.0 });
        let source_base = 200_i64.saturating_sub(source_rank as i64).max(0);
        let downloadability = metadata_confidence * 10.0
            + if track.artist_mbid.is_some() { 4.0 } else { 0.0 }
            + if track.track_mbid.is_some() { 4.0 } else { 0.0 };
        let final_score = source_base + (metadata_confidence * 25.0) as i64 + downloadability as i64;
        Some(Self {
            track,
            source_rank,
            focus_priority: 0,
            final_score,
        })
    }

    pub fn with_focus(
        mut self,
        focus_priority: i64,
        tag_coverage_ratio: f64,
        related_coverage_ratio: f64,
    ) -> Self {
        self.focus_priority = focus_priority;
        self.final_score = focus_priority * 1000
            + (tag_coverage_ratio * 120.0) as i64
            + (related_coverage_ratio * 140.0) as i64;
        self
    }
}

pub fn sort_candidates(candidates: &mut [FlowCandidate]) {
    candidates.sort_by(|left, right| {
        right
            .final_score
            .cmp(&left.final_score)
            .then_with(|| left.source_rank.cmp(&right.source_rank))
    });
}

pub fn select_candidates(
    candidates: &[FlowCandidate],
    count: usize,
    used_artist_keys: &mut std::collections::HashSet<String>,
) -> Vec<PlaylistTrack> {
    let mut picked = Vec::new();
    for candidate in candidates {
        if picked.len() >= count {
            break;
        }
        let artist_key = artist_key(candidate.track.artist_name.as_deref().unwrap_or(""));
        if artist_key.is_empty() || used_artist_keys.contains(&artist_key) {
            continue;
        }
        used_artist_keys.insert(artist_key);
        picked.push(candidate.track.clone());
    }
    picked
}

pub fn candidate_track_artist_key(track: &PlaylistTrack) -> String {
    artist_key(track.artist_name.as_deref().unwrap_or(""))
}
