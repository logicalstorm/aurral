use crate::discovery::scoring::{merge_resolved_recommendations, rerank_recommendations};
use crate::discovery::tag_harvest::discovery_seed_tag_map_key;
use crate::net::lastfm::LastfmClient;
use crate::net::metadata::MetadataClient;
use crate::types::{
    normalize_mbid, normalize_text, DiscoverySeed, Recommendation, SupportingSeed,
};
use crate::util::concurrency::map_with_concurrency;
use crate::util::{metadata_concurrency, network_concurrency};
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

struct SeedSimilarHarvest {
    seed: DiscoverySeed,
    source_tags: Vec<String>,
    similar: Vec<(String, Option<String>, Option<String>, f64)>,
    tag_cached: bool,
    tag_fetch_failed: bool,
    similar_failed: bool,
}

struct BridgeSimilarHarvest {
    bridge_seed: DiscoverySeed,
    bridge_tags: Vec<String>,
    similar: Vec<(String, Option<String>, Option<String>, f64)>,
    similar_failed: bool,
}

struct CandidateEntry {
    id: Option<String>,
    name: String,
    image: Option<String>,
    best_match: f64,
    score_similarity: f64,
    score_tag_affinity: f64,
    tag_overlap_count: i32,
    tags: HashSet<String>,
    seed_weights: Vec<f64>,
    matched_tag_weights: HashMap<String, f64>,
    discovery_depth: i32,
    source_types: HashSet<String>,
    supporting_seeds: IndexMap<String, SupportingSeed>,
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn top_keys_from_map(map: &HashMap<String, f64>, limit: usize) -> Vec<String> {
    let mut entries: Vec<(String, f64)> = map.iter().map(|(k, v)| (k.clone(), *v)).collect();
    entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    entries
        .into_iter()
        .take(limit)
        .map(|(key, _)| key)
        .collect()
}

fn summarize_source_artists(names: impl Iterator<Item = String>) -> Option<String> {
    let artists: Vec<String> = names.take(4).collect();
    match artists.len() {
        0 => None,
        1 => Some(artists[0].clone()),
        2 => Some(format!("{}, {}", artists[0], artists[1])),
        n => Some(format!("{}, {} +{} more", artists[0], artists[1], n - 2)),
    }
}

fn add_candidate(
    accumulator: &mut IndexMap<String, CandidateEntry>,
    candidate_name: &str,
    candidate_mbid: Option<String>,
    candidate_image: Option<String>,
    match_score: f64,
    seed: &DiscoverySeed,
    source_tags: &[String],
    profile_tag_weights: &HashMap<String, f64>,
    existing_artist_keys: &HashSet<String>,
    discovery_depth: i32,
    similarity_multiplier: f64,
    tag_affinity_multiplier: f64,
) {
    let name = candidate_name.trim().to_string();
    if name.is_empty() {
        return;
    }
    let mbid = normalize_mbid(candidate_mbid.as_deref());
    let mut keys = Vec::new();
    if let Some(mbid) = &mbid {
        keys.push(format!("mbid:{mbid}"));
    }
    let normalized_name = normalize_text(&name);
    if !normalized_name.is_empty() {
        keys.push(format!("name:{normalized_name}"));
    }
    if keys.iter().any(|key| existing_artist_keys.contains(key)) {
        return;
    }
    let candidate_key = mbid
        .clone()
        .or_else(|| {
            if normalized_name.is_empty() {
                None
            } else {
                Some(format!("name:{normalized_name}"))
            }
        })
        .unwrap_or_default();
    if candidate_key.is_empty() {
        return;
    }

    let seed_weight = seed.weight.unwrap_or(1.0);
    let similarity_multiplier = clamp(
        seed.similarity_multiplier.unwrap_or(similarity_multiplier),
        0.0,
        1.0,
    );
    let tag_affinity_multiplier = clamp(
        seed.tag_affinity_multiplier.unwrap_or(tag_affinity_multiplier),
        0.0,
        1.0,
    );
    let normalized_tags: Vec<String> = source_tags
        .iter()
        .map(|tag| normalize_text(tag))
        .filter(|tag| !tag.is_empty())
        .collect();
    let matched_tags: Vec<String> = normalized_tags
        .iter()
        .filter(|tag| profile_tag_weights.contains_key(*tag))
        .cloned()
        .collect();
    let tag_weight_sum: f64 = matched_tags
        .iter()
        .map(|tag| profile_tag_weights.get(tag).copied().unwrap_or(0.0))
        .sum();
    let score_similarity =
        (clamp(match_score, 0.0, 1.0) * 100.0 * seed_weight * similarity_multiplier).max(0.0);
    let score_tag_affinity = (tag_weight_sum * 6.0 + matched_tags.len() as f64 * 3.0)
        .min(45.0)
        * tag_affinity_multiplier;

    if let Some(existing) = accumulator.get_mut(&candidate_key) {
        existing.score_similarity += score_similarity;
        existing.score_tag_affinity += score_tag_affinity;
        existing.best_match = existing.best_match.max(match_score);
        existing.tag_overlap_count += matched_tags.len() as i32;
        existing.seed_weights.push(seed_weight);
        existing.supporting_seeds.insert(
            seed.artist_name.clone(),
            SupportingSeed {
                artist_name: Some(seed.artist_name.clone()),
                source: seed.source.clone(),
                weight: Some(seed_weight),
                profile_bucket: seed.profile_bucket.clone(),
            },
        );
        existing
            .source_types
            .insert(seed.source.clone().unwrap_or_else(|| "library".to_string()));
        for tag in matched_tags {
            let weight = profile_tag_weights.get(&tag).copied().unwrap_or(0.0);
            let current = existing.matched_tag_weights.get(&tag).copied().unwrap_or(0.0);
            existing
                .matched_tag_weights
                .insert(tag, current.max(weight));
        }
        if existing.image.is_none() {
            existing.image = candidate_image;
        }
        if existing.id.is_none() {
            existing.id = mbid;
        }
        existing.discovery_depth = existing.discovery_depth.min(discovery_depth);
        return;
    }

    let mut tags = HashSet::new();
    for tag in normalized_tags {
        tags.insert(tag);
    }
    let mut matched_tag_weights = HashMap::new();
    for tag in &matched_tags {
        matched_tag_weights.insert(tag.clone(), profile_tag_weights.get(tag).copied().unwrap_or(0.0));
    }
    let mut supporting_seeds = IndexMap::new();
    supporting_seeds.insert(
        seed.artist_name.clone(),
        SupportingSeed {
            artist_name: Some(seed.artist_name.clone()),
            source: seed.source.clone(),
            weight: Some(seed_weight),
            profile_bucket: seed.profile_bucket.clone(),
        },
    );
    let mut source_types = HashSet::new();
    source_types.insert(seed.source.clone().unwrap_or_else(|| "library".to_string()));

    accumulator.insert(
        candidate_key,
        CandidateEntry {
            id: mbid,
            name,
            image: candidate_image,
            best_match: match_score,
            score_similarity,
            score_tag_affinity,
            tag_overlap_count: matched_tags.len() as i32,
            tags,
            seed_weights: vec![seed_weight],
            matched_tag_weights,
            discovery_depth,
            source_types,
            supporting_seeds,
        },
    );
}

fn finalize_entry(entry: &CandidateEntry, _discovery_mode: &str) -> Recommendation {
    let support_count = entry.supporting_seeds.len() as i32;
    let matched_tags = top_keys_from_map(&entry.matched_tag_weights, 4);
    let average_seed_weight = if entry.seed_weights.is_empty() {
        0.0
    } else {
        entry.seed_weights.iter().sum::<f64>() / entry.seed_weights.len() as f64
    };
    let score_seed_coverage =
        ((support_count - 1) * 8) as f64 + average_seed_weight * 4.0;
    let score_seed_coverage = score_seed_coverage.max(0.0).min(28.0);
    let score_novelty = clamp(
        28.0 - support_count as f64 * 3.0 - entry.best_match * 10.0 + matched_tags.len() as f64 * 2.0,
        0.0,
        30.0,
    );
    let score_popularity_penalty = clamp(
        support_count as f64 * 2.0 + entry.best_match * 8.0 - score_novelty * 0.15,
        0.0,
        18.0,
    );
    let base_total = entry.score_similarity
        + entry.score_tag_affinity
        + score_seed_coverage
        + score_novelty
        - score_popularity_penalty;
    let discovery_tier = if score_novelty >= 18.0 {
        "deeper"
    } else if entry.best_match >= 0.72 {
        "safer"
    } else {
        "balanced"
    };
    let confidence = clamp(
        35.0 + (entry.best_match * 28.0).min(25.0) + (support_count * 5).min(18) as f64
            + (matched_tags.len() * 3).min(12) as f64,
        20.0,
        98.0,
    ) as i32;

    Recommendation {
        id: entry.id.clone(),
        name: Some(entry.name.clone()),
        kind: Some("Artist".to_string()),
        image: None,
        tags: entry.tags.iter().cloned().collect(),
        matched_tags,
        supporting_seeds: entry
            .supporting_seeds
            .values()
            .cloned()
            .collect(),
        seed_count: Some(support_count),
        score: Some(base_total.round() as i32),
        score_total: Some(base_total.round() as i32),
        score_similarity: Some(entry.score_similarity.round() as i32),
        score_tag_affinity: Some(entry.score_tag_affinity.round() as i32),
        score_seed_coverage: Some(score_seed_coverage.round() as i32),
        score_novelty: Some(score_novelty.round() as i32),
        score_popularity_penalty: Some(score_popularity_penalty.round() as i32),
        score_diversity_penalty: Some(0),
        source_artist: summarize_source_artists(
            entry.supporting_seeds.keys().cloned(),
        ),
        source_artists: entry.supporting_seeds.keys().cloned().collect(),
        source_type: if entry.source_types.len() == 1 {
            entry.source_types.iter().next().cloned()
        } else {
            Some("blended".to_string())
        },
        source_types: entry.source_types.iter().cloned().collect(),
        source_mix: entry.source_types.iter().cloned().collect(),
        reason_codes: vec![],
        discovery_tier: Some(discovery_tier.to_string()),
        discovery_depth: Some(entry.discovery_depth),
        best_match: Some(entry.best_match),
        confidence: Some(confidence),
        ..Recommendation::default()
    }
}

fn finalize_accumulator(
    accumulator: IndexMap<String, CandidateEntry>,
    limit: usize,
    discovery_mode: &str,
) -> Vec<Recommendation> {
    let mut list: Vec<Recommendation> = accumulator
        .values()
        .map(|entry| finalize_entry(entry, discovery_mode))
        .filter(|entry| entry.name.as_deref().unwrap_or("").len() > 0)
        .collect();
    list.sort_by(|left, right| {
        right
            .score_total
            .unwrap_or(0)
            .cmp(&left.score_total.unwrap_or(0))
            .then_with(|| {
                right
                    .seed_count
                    .unwrap_or(0)
                    .cmp(&left.seed_count.unwrap_or(0))
            })
            .then_with(|| {
                left.name
                    .as_deref()
                    .unwrap_or("")
                    .cmp(right.name.as_deref().unwrap_or(""))
            })
    });
    list.truncate(limit);
    list
}

fn failure_ratio(success: u64, failure: u64) -> f64 {
    let total = success + failure;
    if total == 0 {
        0.0
    } else {
        failure as f64 / total as f64
    }
}

fn similar_sampling(target: usize, failure_ratio: f64) -> (usize, usize) {
    let max_per_seed = (target / 8).max(18).min(28);
    let similar_limit = (max_per_seed + 14).max(28).min(44);
    if failure_ratio >= 0.8 {
        return (
            (similar_limit as f64 * 0.7).max(20.0) as usize,
            (max_per_seed as f64 * 0.75).max(14.0) as usize,
        );
    }
    (similar_limit, max_per_seed)
}

fn second_hop_sampling(target: usize, failure_ratio: f64) -> (usize, usize, usize) {
    let seed_limit = (target / 5).max(28).min(48);
    if failure_ratio >= 0.8 {
        return (
            (seed_limit as f64 * 0.6).max(16.0) as usize,
            14,
            8,
        );
    }
    (seed_limit, 18, 10)
}

async fn hydrate_tags(
    lastfm: &LastfmClient,
    item: &Recommendation,
    profile_tag_weights: &HashMap<String, f64>,
    depth: i32,
) -> Recommendation {
    let name = item.name.clone().unwrap_or_default();
    if name.is_empty() {
        return item.clone();
    }
    let tags = lastfm
        .artist_top_tags(&name, item.id.as_deref())
        .await;
    if tags.is_empty() {
        return item.clone();
    }
    let normalized: Vec<String> = tags.iter().map(|tag| normalize_text(tag)).collect();
    let matched: Vec<String> = normalized
        .iter()
        .filter(|tag| profile_tag_weights.contains_key(*tag))
        .cloned()
        .collect();
    let tag_weight_sum: f64 = matched
        .iter()
        .map(|tag| profile_tag_weights.get(tag).copied().unwrap_or(0.0))
        .sum();
    let multiplier = if depth >= 2 { 0.55 } else { 1.0 };
    let score_tag_affinity =
        ((tag_weight_sum * 6.0 + matched.len() as f64 * 3.0).min(45.0) * multiplier).round() as i32;
    let previous = item.score_tag_affinity.unwrap_or(0);
    let previous_total = item.score_total.unwrap_or(item.score.unwrap_or(0));
    let score_total = previous_total - previous + score_tag_affinity;
    let mut updated = item.clone();
    updated.tags = normalized;
    updated.matched_tags = top_keys_from_map(
        &matched
            .iter()
            .map(|tag| (tag.clone(), profile_tag_weights.get(tag).copied().unwrap_or(0.0)))
            .collect(),
        4,
    );
    updated.score_tag_affinity = Some(score_tag_affinity);
    updated.score_total = Some(score_total);
    updated.score = Some(score_total);
    updated
}

pub async fn build_recommendations_from_seeds(
    seeds: &[DiscoverySeed],
    existing_artist_keys: &HashSet<String>,
    profile_tag_weights: &HashMap<String, f64>,
    seed_tag_map: &HashMap<String, Vec<String>>,
    discovery_mode: &str,
    per_refresh: usize,
    pool_cap: usize,
    lastfm: Arc<LastfmClient>,
) -> (Vec<Recommendation>, u64, u64) {
    let mut success = 0u64;
    let mut failure = 0u64;
    let candidate_limit = pool_cap.min((per_refresh as f64 * 2.5).ceil().max(160.0) as usize);
    let ratio = failure_ratio(success, failure);
    let (similar_limit, max_per_seed) = similar_sampling(per_refresh, ratio);

    let mut direct = IndexMap::new();
    let seed_tag_map = seed_tag_map.clone();
    let similar_limit = similar_limit;
    let lastfm_for_seeds = lastfm.clone();
    let seed_harvests = map_with_concurrency(
        seeds.to_vec(),
        network_concurrency(),
        move |seed| {
            let lastfm = lastfm_for_seeds.clone();
            let seed_tag_map = seed_tag_map.clone();
            async move {
                let seed_key = discovery_seed_tag_map_key(&seed);
                let mut source_tags = seed_tag_map
                    .get(&seed_key)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|tag| normalize_text(&tag))
                    .filter(|tag| !tag.is_empty())
                    .collect::<Vec<_>>();
                let mut tag_cached = false;
                let mut tag_fetch_failed = false;
                if source_tags.is_empty() {
                    let fetched = lastfm
                        .artist_top_tags(&seed.artist_name, seed.mbid.as_deref())
                        .await;
                    if fetched.is_empty() {
                        tag_fetch_failed = true;
                    } else {
                        source_tags = fetched
                            .into_iter()
                            .map(|tag| normalize_text(&tag))
                            .collect();
                    }
                } else {
                    tag_cached = true;
                }
                let similar = lastfm
                    .artist_similar(
                        &seed.artist_name,
                        seed.mbid.as_deref(),
                        similar_limit,
                    )
                    .await;
                let similar_failed = similar.is_empty();
                SeedSimilarHarvest {
                    seed,
                    source_tags,
                    similar,
                    tag_cached,
                    tag_fetch_failed,
                    similar_failed,
                }
            }
        },
    )
    .await;

    for harvest in seed_harvests {
        if harvest.tag_cached {
            success += 1;
        } else if harvest.tag_fetch_failed {
            failure += 1;
        } else {
            success += 1;
        }
        if harvest.similar_failed {
            failure += 1;
            continue;
        }
        success += 1;
        for (name, mbid, image, match_score) in harvest.similar.into_iter().take(max_per_seed) {
            add_candidate(
                &mut direct,
                &name,
                mbid,
                image,
                match_score,
                &harvest.seed,
                &harvest.source_tags,
                profile_tag_weights,
                existing_artist_keys,
                1,
                1.0,
                1.0,
            );
        }
    }

    let mut direct_list = finalize_accumulator(direct, candidate_limit, discovery_mode);
    let hydration_limit = (per_refresh as f64 * 1.5).max(per_refresh as f64) as usize;
    let hydration_take = hydration_limit.min(direct_list.len());
    if hydration_take > 0 {
        let hydration_items: Vec<(usize, Recommendation)> = (0..hydration_take)
            .map(|index| (index, direct_list[index].clone()))
            .collect();
        let profile_weights = profile_tag_weights.clone();
        let lastfm_for_hydration = lastfm.clone();
        let hydrated = map_with_concurrency(
            hydration_items,
            network_concurrency(),
            move |(index, item)| {
                let lastfm = lastfm_for_hydration.clone();
                let profile_weights = profile_weights.clone();
                async move {
                    (
                        index,
                        hydrate_tags(lastfm.as_ref(), &item, &profile_weights, 1).await,
                    )
                }
            },
        )
        .await;
        for (index, item) in hydrated {
            direct_list[index] = item;
        }
    }
    direct_list = rerank_recommendations(direct_list, candidate_limit, discovery_mode, &[]);

    let ratio = failure_ratio(success, failure);
    let (seed_limit, hop_similar_limit, hop_max_per_seed) =
        second_hop_sampling(per_refresh, ratio);
    if seed_limit == 0 || direct_list.is_empty() {
        return (direct_list, success, failure);
    }

    let bridge_seeds: Vec<Recommendation> = direct_list
        .iter()
        .filter(|candidate| {
            !candidate.matched_tags.is_empty() || !candidate.tags.is_empty()
        })
        .take(seed_limit)
        .cloned()
        .collect();

    let mut second_hop = IndexMap::new();
    let hop_similar_limit = hop_similar_limit;
    let lastfm_for_bridges = lastfm.clone();
    let bridge_harvests = map_with_concurrency(
        bridge_seeds,
        network_concurrency(),
        move |bridge| {
            let lastfm = lastfm_for_bridges.clone();
            async move {
                let bridge_tags: Vec<String> = if !bridge.matched_tags.is_empty() {
                    bridge.matched_tags.clone()
                } else {
                    bridge.tags.clone()
                };
                if bridge_tags.is_empty() {
                    return BridgeSimilarHarvest {
                        bridge_seed: DiscoverySeed {
                            mbid: bridge.id.clone(),
                            artist_name: bridge.name.clone().unwrap_or_default(),
                            source: Some("lastfm_related".to_string()),
                            weight: None,
                            affinity_weight: None,
                            profile_bucket: Some("two_hop_bridge".to_string()),
                            discovery_depth: Some(2),
                            similarity_multiplier: Some(0.55),
                            tag_affinity_multiplier: Some(0.55),
                        },
                        bridge_tags,
                        similar: Vec::new(),
                        similar_failed: true,
                    };
                }
                let bridge_weight = clamp(
                    0.42 + bridge.best_match.unwrap_or(0.0) * 0.25
                        + bridge.seed_count.unwrap_or(0).min(3) as f64 * 0.04,
                    0.45,
                    0.78,
                );
                let bridge_seed = DiscoverySeed {
                    mbid: bridge.id.clone(),
                    artist_name: bridge.name.clone().unwrap_or_default(),
                    source: Some("lastfm_related".to_string()),
                    weight: Some(bridge_weight),
                    affinity_weight: Some(bridge_weight),
                    profile_bucket: Some("two_hop_bridge".to_string()),
                    discovery_depth: Some(2),
                    similarity_multiplier: Some(0.55),
                    tag_affinity_multiplier: Some(0.55),
                };
                let similar = lastfm
                    .artist_similar(
                        bridge_seed.artist_name.as_str(),
                        bridge_seed.mbid.as_deref(),
                        hop_similar_limit,
                    )
                    .await;
                let similar_failed = similar.is_empty();
                BridgeSimilarHarvest {
                    bridge_seed,
                    bridge_tags,
                    similar,
                    similar_failed,
                }
            }
        },
    )
    .await;

    for harvest in bridge_harvests {
        if harvest.bridge_tags.is_empty() {
            continue;
        }
        if harvest.similar_failed {
            failure += 1;
            continue;
        }
        success += 1;
        for (name, mbid, image, match_score) in harvest.similar.into_iter().take(hop_max_per_seed) {
            add_candidate(
                &mut second_hop,
                &name,
                mbid,
                image,
                match_score,
                &harvest.bridge_seed,
                &harvest.bridge_tags,
                profile_tag_weights,
                existing_artist_keys,
                2,
                0.55,
                0.55,
            );
        }
    }

    let second_hop_limit = (per_refresh as f64 * 0.35).ceil() as usize;
    let mut second_hop_list =
        finalize_accumulator(second_hop, second_hop_limit, discovery_mode);
    let second_hydration = second_hop_limit;
    let second_hydration_take = second_hydration.min(second_hop_list.len());
    if second_hydration_take > 0 {
        let hydration_items: Vec<(usize, Recommendation)> = (0..second_hydration_take)
            .map(|index| (index, second_hop_list[index].clone()))
            .collect();
        let profile_weights = profile_tag_weights.clone();
        let lastfm_for_second_hydration = lastfm.clone();
        let hydrated = map_with_concurrency(
            hydration_items,
            network_concurrency(),
            move |(index, item)| {
                let lastfm = lastfm_for_second_hydration.clone();
                let profile_weights = profile_weights.clone();
                async move {
                    (
                        index,
                        hydrate_tags(lastfm.as_ref(), &item, &profile_weights, 2).await,
                    )
                }
            },
        )
        .await;
        for (index, item) in hydrated {
            second_hop_list[index] = item;
        }
    }
    second_hop_list =
        rerank_recommendations(second_hop_list, second_hop_limit, discovery_mode, &[]);
    if second_hop_list.is_empty() {
        return (direct_list, success, failure);
    }

    let merged = merge_resolved_recommendations(
        direct_list
            .into_iter()
            .chain(second_hop_list.into_iter())
            .collect(),
        existing_artist_keys,
    );
    let final_list = rerank_recommendations(merged, candidate_limit, discovery_mode, &[]);
    (final_list, success, failure)
}

pub async fn resolve_recommendation_candidates(
    mut recommendations: Vec<Recommendation>,
    existing_artist_keys: &HashSet<String>,
    resolve_limit: usize,
    metadata: Arc<MetadataClient>,
) -> Vec<Recommendation> {
    let shortlist_len = recommendations.len().min(resolve_limit);
    let resolve_jobs: Vec<(usize, String)> = recommendations
        .iter()
        .enumerate()
        .take(shortlist_len)
        .filter_map(|(index, item)| {
            if item.id.is_some() {
                return None;
            }
            let name = item.name.as_deref()?.trim();
            if name.is_empty() {
                return None;
            }
            Some((index, name.to_string()))
        })
        .collect();

    let resolved_pairs = map_with_concurrency(
        resolve_jobs,
        metadata_concurrency(),
        move |(index, name)| {
            let metadata = metadata.clone();
            async move {
                let mbid = metadata.resolve_artist_mbid(&name).await;
                (index, mbid)
            }
        },
    )
    .await;

    for (index, mbid) in resolved_pairs {
        if let Some(mbid) = mbid {
            recommendations[index].id = Some(mbid.clone());
            recommendations[index].navigate_to = Some(mbid);
        }
    }

    let merged = merge_resolved_recommendations(recommendations, existing_artist_keys);
    let mut sorted = merged;
    sorted.sort_by(|left, right| {
        right
            .score_total
            .unwrap_or(0)
            .cmp(&left.score_total.unwrap_or(0))
            .then_with(|| {
                right
                    .seed_count
                    .unwrap_or(0)
                    .cmp(&left.seed_count.unwrap_or(0))
            })
            .then_with(|| {
                left.name
                    .as_deref()
                    .unwrap_or("")
                    .cmp(right.name.as_deref().unwrap_or(""))
            })
    });
    sorted.truncate(sorted.len().min(resolve_limit.max(120)));
    sorted
}
