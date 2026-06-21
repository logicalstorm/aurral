use crate::flow::candidate::{sort_candidates, FlowCandidate};
use crate::flow::track::{artist_key, deep_dive_ranges, pick_track_from_ranges, track_from_value};
use crate::net::lastfm::LastfmClient;
use std::collections::{HashMap, HashSet};

fn normalize_focus_entries(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for value in values {
        let text = value.trim().to_string();
        let key = artist_key(&text);
        if text.is_empty() || seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        out.push(text);
    }
    out
}

fn focus_tier_details(
    tag_coverage: i64,
    total_tags: i64,
    related_coverage: i64,
    total_related: i64,
) -> (i64, f64, f64) {
    let has_tags = total_tags > 0;
    let has_related = total_related > 0;
    if !has_tags && !has_related {
        return (0, 0.0, 0.0);
    }
    let tag_ratio = if has_tags {
        (tag_coverage as f64 / total_tags as f64).min(1.0)
    } else {
        0.0
    };
    let related_ratio = if has_related {
        (related_coverage as f64 / total_related as f64).min(1.0)
    } else {
        0.0
    };
    if has_tags && has_related {
        if related_coverage >= total_related && tag_coverage >= total_tags {
            return (8, tag_ratio, related_ratio);
        }
        if related_coverage >= total_related && tag_coverage > 0 {
            return (7, tag_ratio, related_ratio);
        }
        if related_coverage > 0 && tag_coverage >= total_tags {
            return (6, tag_ratio, related_ratio);
        }
        if related_coverage > 0 && tag_coverage > 0 {
            return (5, tag_ratio, related_ratio);
        }
        if related_coverage >= total_related {
            return (4, tag_ratio, related_ratio);
        }
        if related_coverage > 0 {
            return (3, tag_ratio, related_ratio);
        }
        if tag_coverage >= total_tags {
            return (2, tag_ratio, related_ratio);
        }
        if tag_coverage > 0 {
            return (1, tag_ratio, related_ratio);
        }
        return (0, tag_ratio, related_ratio);
    }
    if has_related {
        let priority = if related_coverage >= total_related {
            4
        } else if related_coverage > 0 {
            3
        } else {
            0
        };
        return (priority, tag_ratio, related_ratio);
    }
    let priority = if tag_coverage >= total_tags {
        2
    } else if tag_coverage > 0 {
        1
    } else {
        0
    };
    (priority, tag_ratio, related_ratio)
}

struct FocusArtistEntry {
    name: String,
    artist_mbid: Option<String>,
    tag_matches: HashSet<String>,
    related_seeds: HashSet<String>,
}

pub async fn harvest_focus_candidates(
    lastfm: &LastfmClient,
    tags: &[String],
    related_artists: &[String],
    limit: usize,
    deep_dive: bool,
    exclude_artist_keys: &HashSet<String>,
) -> Vec<FlowCandidate> {
    let normalized_tags = normalize_focus_entries(tags);
    let normalized_related = normalize_focus_entries(related_artists);
    let total_tags = normalized_tags.len() as i64;
    let total_related = normalized_related.len() as i64;
    if limit == 0 || (total_tags == 0 && total_related == 0) {
        return Vec::new();
    }

    let requested_artists = 150.min(limit.saturating_mul(6).max(60));
    let mut candidate_map: HashMap<String, FocusArtistEntry> = HashMap::new();

    for tag in &normalized_tags {
        let tag_key = artist_key(tag);
        let artists = lastfm.tag_top_artists(tag, requested_artists).await;
        for (index, artist_name) in artists.into_iter().enumerate() {
            let key = artist_key(&artist_name);
            if key.is_empty() || exclude_artist_keys.contains(&key) {
                continue;
            }
            let entry = candidate_map.entry(key.clone()).or_insert(FocusArtistEntry {
                name: artist_name,
                artist_mbid: None,
                tag_matches: HashSet::new(),
                related_seeds: HashSet::new(),
            });
            entry.tag_matches.insert(tag_key.clone());
            let _ = index;
        }
    }

    for seed in &normalized_related {
        let seed_key = artist_key(seed);
        let similar = lastfm.artist_similar(seed, None, requested_artists.min(75)).await;
        for (artist_name, mbid, _, _) in similar {
            let key = artist_key(&artist_name);
            if key.is_empty() || exclude_artist_keys.contains(&key) {
                continue;
            }
            let entry = candidate_map.entry(key.clone()).or_insert(FocusArtistEntry {
                name: artist_name.clone(),
                artist_mbid: mbid.clone(),
                tag_matches: HashSet::new(),
                related_seeds: HashSet::new(),
            });
            if entry.artist_mbid.is_none() {
                entry.artist_mbid = mbid;
            }
            entry.related_seeds.insert(seed_key.clone());
        }
    }

    let normalized_tag_set: HashSet<String> =
        normalized_tags.iter().map(|tag| artist_key(tag)).collect();
    let mut preliminary: Vec<FocusArtistEntry> = candidate_map.into_values().collect();
    preliminary.sort_by(|left, right| {
        let left_signal = left.tag_matches.len() + left.related_seeds.len();
        let right_signal = right.tag_matches.len() + right.related_seeds.len();
        right_signal
            .cmp(&left_signal)
            .then_with(|| right.related_seeds.len().cmp(&left.related_seeds.len()))
            .then_with(|| right.tag_matches.len().cmp(&left.tag_matches.len()))
            .then_with(|| left.name.cmp(&right.name))
    });
    preliminary.truncate(limit.saturating_mul(2).max(60));

    let ranges = deep_dive_ranges(deep_dive);
    let mut candidates = Vec::new();
    for (index, artist) in preliminary.into_iter().enumerate() {
        let top_tags = lastfm
            .artist_top_tags(&artist.name, artist.artist_mbid.as_deref())
            .await;
        let mut tag_matches = artist.tag_matches.clone();
        for tag in top_tags {
            let tag_key = artist_key(&tag);
            if normalized_tag_set.contains(&tag_key) {
                tag_matches.insert(tag_key);
            }
        }
        let (focus_priority, tag_ratio, related_ratio) = focus_tier_details(
            tag_matches.len() as i64,
            total_tags,
            artist.related_seeds.len() as i64,
            total_related,
        );
        if focus_priority <= 0 {
            continue;
        }
        let track_list = lastfm.artist_top_track_values(&artist.name, 25).await;
        let Some(pick) = pick_track_from_ranges(&track_list, &ranges) else {
            continue;
        };
        let Some(track) = track_from_value(
            pick,
            &artist.name,
            artist.artist_mbid.clone(),
            "From focus filters",
        ) else {
            continue;
        };
        let Some(mut candidate) = FlowCandidate::from_track(track, "focus", index) else {
            continue;
        };
        candidate = candidate.with_focus(focus_priority, tag_ratio, related_ratio);
        candidates.push(candidate);
    }

    candidates.sort_by(|left, right| {
        right
            .focus_priority
            .cmp(&left.focus_priority)
            .then_with(|| right.final_score.cmp(&left.final_score))
            .then_with(|| left.source_rank.cmp(&right.source_rank))
    });
    sort_candidates(&mut candidates);
    candidates.truncate(limit);
    candidates
}
