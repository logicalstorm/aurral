use crate::types::{normalize_mbid, normalize_text, DiscoverySeed, TasteArtistInput};
use std::collections::HashSet;

const SOURCE_BASE_WEIGHTS: [(&str, f64); 4] = [
    ("library", 1.0),
    ("lastfm", 1.2),
    ("listenbrainz", 1.3),
    ("koito", 1.3),
];

fn source_base_weight(source: &str) -> f64 {
    let normalized = normalize_text(source);
    SOURCE_BASE_WEIGHTS
        .iter()
        .find_map(|(key, weight)| (*key == normalized).then_some(*weight))
        .unwrap_or(1.0)
}

fn build_seed_identity_keys(mbid: Option<&str>, artist_name: &str) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(mbid) = normalize_mbid(mbid) {
        keys.push(format!("mbid:{mbid}"));
    }
    let normalized_name = normalize_text(artist_name);
    if !normalized_name.is_empty() {
        keys.push(format!("name:{normalized_name}"));
    }
    keys
}

fn calculate_seed_weight(source: &str, index: usize, playcount: i64) -> f64 {
    let base_weight = source_base_weight(source);
    if source == "library" {
        let recency_boost = (0.5 - (index as f64) * 0.02).max(0.0);
        return (base_weight + recency_boost).clamp(0.0, 10.0);
    }
    let playcount_boost = if playcount > 0 {
        (playcount as f64 + 1.0).log10() * 0.4
    } else {
        0.15
    };
    (base_weight + playcount_boost.min(1.4)).clamp(0.0, 10.0)
}

pub fn build_taste_profile_seeds(
    recent_library_artists: &[TasteArtistInput],
    all_library_artists: &[TasteArtistInput],
    history_artists: &[TasteArtistInput],
) -> (Vec<TasteArtistInput>, Vec<TasteArtistInput>) {
    let mut recent_ids = HashSet::new();
    for artist in recent_library_artists {
        if let Some(mbid) = normalize_mbid(artist.mbid.as_deref()) {
            recent_ids.insert(mbid);
        }
    }

    let mut library_seeds = Vec::new();
    for (index, artist) in recent_library_artists.iter().take(28).enumerate() {
        let mbid = normalize_mbid(artist.mbid.as_deref());
        let artist_name = artist.artist_name.trim();
        if mbid.is_none() || artist_name.is_empty() {
            continue;
        }
        library_seeds.push(TasteArtistInput {
            mbid,
            artist_name: artist_name.to_string(),
            source: Some("library".to_string()),
            playcount: artist.playcount,
            affinity_weight: Some(1.7 - (index.min(20) as f64) * 0.035),
            profile_bucket: Some(
                if index < 12 {
                    "recent_interest".to_string()
                } else {
                    "core_favorites".to_string()
                },
            ),
        });
    }

    for (index, artist) in all_library_artists.iter().take(42).enumerate() {
        let mbid = normalize_mbid(artist.mbid.as_deref());
        let artist_name = artist.artist_name.trim();
        if mbid.is_none() || artist_name.is_empty() {
            continue;
        }
        if recent_ids.contains(mbid.as_ref().unwrap()) {
            continue;
        }
        library_seeds.push(TasteArtistInput {
            mbid,
            artist_name: artist_name.to_string(),
            source: Some("library".to_string()),
            playcount: artist.playcount,
            affinity_weight: Some(if index < 16 { 1.12 } else { 0.92 }),
            profile_bucket: Some(
                if index < 16 {
                    "collection_anchor".to_string()
                } else {
                    "exploratory_seed".to_string()
                },
            ),
        });
    }

    let history_seeds = history_artists
        .iter()
        .enumerate()
        .map(|(index, artist)| {
            let playcount = artist.playcount.unwrap_or(0).max(0);
            let affinity = 1.35 + ((playcount as f64 + 1.0).log10() * 0.35).min(1.2);
            TasteArtistInput {
                mbid: normalize_mbid(artist.mbid.as_deref()),
                artist_name: artist.artist_name.trim().to_string(),
                source: Some(
                    artist
                        .source
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| "lastfm".to_string()),
                ),
                playcount: Some(playcount),
                affinity_weight: Some(affinity),
                profile_bucket: Some(
                    if index < 12 {
                        "core_favorites".to_string()
                    } else if index < 24 {
                        "recent_interest".to_string()
                    } else {
                        "exploratory_seed".to_string()
                    },
                ),
            }
        })
        .filter(|artist| !artist.artist_name.is_empty())
        .collect();

    (library_seeds, history_seeds)
}

pub fn build_discovery_seed_list(
    library_artists: &[TasteArtistInput],
    history_artists: &[TasteArtistInput],
) -> Vec<DiscoverySeed> {
    let mut combined = Vec::new();
    combined.extend_from_slice(history_artists);
    combined.extend_from_slice(library_artists);

    let mut seen = HashSet::new();
    let mut seeds: Vec<DiscoverySeed> = Vec::new();

    for (index, artist) in combined.iter().enumerate() {
        let mbid = normalize_mbid(artist.mbid.as_deref());
        let artist_name = artist.artist_name.trim();
        if artist_name.is_empty() {
            continue;
        }
        let identity_keys = build_seed_identity_keys(mbid.as_deref(), artist_name);
        if identity_keys.is_empty() {
            continue;
        }
        let source = artist
            .source
            .as_deref()
            .map(normalize_text)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "library".to_string());
        let library_index = if source == "library" { index } else { 0 };
        let next_weight = calculate_seed_weight(
            &source,
            library_index,
            artist.playcount.unwrap_or(0).max(0),
        );
        let affinity_weight = artist
            .affinity_weight
            .unwrap_or(next_weight)
            .max(next_weight);

        if let Some(existing_key) = identity_keys.iter().find(|key| seen.contains(*key)) {
            if let Some(existing) = seeds.iter_mut().find(|entry| {
                entry
                    .artist_name
                    .eq_ignore_ascii_case(artist_name)
                    || entry.mbid == mbid
            }) {
                existing.weight = Some(
                    existing
                        .weight
                        .unwrap_or(0.0)
                        .max(next_weight),
                );
                existing.affinity_weight = Some(
                    existing
                        .affinity_weight
                        .unwrap_or(0.0)
                        .max(affinity_weight),
                );
                if existing.source.as_deref() == Some("library") && source != "library" {
                    existing.source = Some(source.clone());
                }
                if existing.profile_bucket.is_none() {
                    existing.profile_bucket = artist.profile_bucket.clone();
                }
                if existing.mbid.is_none() {
                    existing.mbid = mbid.clone();
                }
            }
            seen.insert(existing_key.clone());
            continue;
        }

        for key in &identity_keys {
            seen.insert(key.clone());
        }
        seeds.push(DiscoverySeed {
            mbid,
            artist_name: artist_name.to_string(),
            source: Some(source),
            weight: Some(next_weight),
            affinity_weight: Some(affinity_weight),
            profile_bucket: artist.profile_bucket.clone(),
            discovery_depth: None,
            similarity_multiplier: None,
            tag_affinity_multiplier: None,
        });
    }

    seeds.sort_by(|left, right| {
        right
            .affinity_weight
            .unwrap_or(0.0)
            .partial_cmp(&left.affinity_weight.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                right
                    .weight
                    .unwrap_or(0.0)
                    .partial_cmp(&left.weight.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| left.artist_name.cmp(&right.artist_name))
    });
    seeds
}
