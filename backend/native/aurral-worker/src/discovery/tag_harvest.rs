use crate::net::lastfm::LastfmClient;
use crate::types::{normalize_mbid, normalize_text, DiscoverySeed};
use crate::util::concurrency::map_with_concurrency;
use crate::util::network_concurrency;
use std::collections::HashMap;
use std::sync::Arc;

const GENRE_KEYWORDS: &[&str] = &[
    "rock", "pop", "electronic", "metal", "jazz", "hip-hop", "indie", "alternative", "punk",
    "soul", "r&b", "folk", "classical", "blues", "country", "reggae", "disco", "funk",
];

pub struct TagHarvestResult {
    pub seed_tag_map: HashMap<String, Vec<String>>,
    pub profile_tag_weights: HashMap<String, f64>,
    pub top_tags: Vec<String>,
    pub top_genres: Vec<String>,
}

pub fn discovery_seed_tag_map_key(seed: &DiscoverySeed) -> String {
    if let Some(mbid) = normalize_mbid(seed.mbid.as_deref()) {
        return format!("mbid:{mbid}");
    }
    let normalized = normalize_text(&seed.artist_name);
    if normalized.is_empty() {
        return String::new();
    }
    format!("name:{normalized}")
}

fn normalize_tag(value: &str) -> String {
    value.trim().to_lowercase()
}

fn weighted_top_list(counts: &HashMap<String, f64>, limit: usize) -> Vec<String> {
    let mut entries: Vec<(String, f64)> = counts.iter().map(|(k, v)| (k.clone(), *v)).collect();
    entries.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    entries
        .into_iter()
        .take(limit)
        .map(|(name, _)| name)
        .collect()
}

pub async fn collect_seed_tags(
    seeds: &[DiscoverySeed],
    lastfm: Arc<LastfmClient>,
) -> TagHarvestResult {
    let mut tag_counts: HashMap<String, f64> = HashMap::new();
    let mut genre_counts: HashMap<String, f64> = HashMap::new();
    let mut seed_tag_map: HashMap<String, Vec<String>> = HashMap::new();

    let valid_seeds: Vec<DiscoverySeed> = seeds
        .iter()
        .filter(|seed| !seed.artist_name.trim().is_empty())
        .cloned()
        .collect();

    let harvests = map_with_concurrency(
        valid_seeds,
        network_concurrency(),
        move |seed| {
            let lastfm = lastfm.clone();
            async move {
                let tags = lastfm
                    .artist_top_tags(&seed.artist_name, seed.mbid.as_deref())
                    .await;
                (seed, tags)
            }
        },
    )
    .await;

    for (seed, tags) in harvests {
        if tags.is_empty() {
            continue;
        }
        let names: Vec<String> = tags
            .iter()
            .take(15)
            .map(|tag| tag.trim())
            .filter(|tag| !tag.is_empty())
            .map(|tag| tag.to_string())
            .collect();
        if names.is_empty() {
            continue;
        }
        let map_key = discovery_seed_tag_map_key(&seed);
        if !map_key.is_empty() {
            seed_tag_map.insert(map_key, names.clone());
        }
        let seed_weight = seed.weight.unwrap_or(1.0).max(0.5);
        for tag in tags.iter().take(15) {
            let name = tag.trim();
            if name.is_empty() {
                continue;
            }
            let normalized = normalize_tag(name);
            *tag_counts.entry(name.to_string()).or_insert(0.0) += seed_weight;
            if GENRE_KEYWORDS
                .iter()
                .any(|keyword| normalized.contains(keyword))
            {
                *genre_counts.entry(name.to_string()).or_insert(0.0) += seed_weight;
            }
        }
    }

    let profile_tag_weights = tag_counts
        .iter()
        .map(|(tag, weight)| (normalize_tag(tag), *weight))
        .filter(|(tag, _)| !tag.is_empty())
        .collect();

    TagHarvestResult {
        top_tags: weighted_top_list(&tag_counts, 20),
        top_genres: weighted_top_list(&genre_counts, 24),
        seed_tag_map,
        profile_tag_weights,
    }
}
