use crate::types::{normalize_mbid, normalize_text, FeedbackEntry, Recommendation};
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy)]
struct ModeMultipliers {
    similarity: f64,
    tag_affinity: f64,
    seed_coverage: f64,
    novelty: f64,
    popularity_penalty: f64,
    diversity_penalty: f64,
}

fn mode_multipliers(mode: &str) -> ModeMultipliers {
    match normalize_text(mode).as_str() {
        "safer" => ModeMultipliers {
            similarity: 1.2,
            tag_affinity: 0.9,
            seed_coverage: 1.1,
            novelty: 0.6,
            popularity_penalty: 0.7,
            diversity_penalty: 0.8,
        },
        "deeper" => ModeMultipliers {
            similarity: 0.7,
            tag_affinity: 1.15,
            seed_coverage: 0.95,
            novelty: 2.0,
            popularity_penalty: 1.4,
            diversity_penalty: 1.2,
        },
        _ => ModeMultipliers {
            similarity: 1.0,
            tag_affinity: 1.0,
            seed_coverage: 1.0,
            novelty: 1.0,
            popularity_penalty: 1.0,
            diversity_penalty: 1.0,
        },
    }
}

fn feedback_boost(candidate: &Recommendation, feedback: &[FeedbackEntry]) -> (i32, bool) {
    let candidate_name = normalize_text(candidate.name.as_deref().unwrap_or(""));
    let candidate_mbid = normalize_mbid(candidate.id.as_deref());
    let candidate_tags: HashSet<String> = candidate
        .matched_tags
        .iter()
        .chain(candidate.tags.iter())
        .map(|tag| normalize_text(tag))
        .collect();

    let mut adjustment = 0;
    let mut hidden = false;
    for entry in feedback {
        let action = normalize_text(entry.action.as_deref().unwrap_or(""));
        let entry_name = normalize_text(entry.artist_name.as_deref().unwrap_or(""));
        let entry_mbid = normalize_mbid(entry.artist_mbid.as_deref());
        let exact_match = (!candidate_name.is_empty() && candidate_name == entry_name)
            || (candidate_mbid.is_some()
                && entry_mbid.is_some()
                && candidate_mbid == entry_mbid);
        let tag_overlap = entry
            .tags
            .iter()
            .map(|tag| normalize_text(tag))
            .filter(|tag| candidate_tags.contains(tag))
            .count();
        let contextual_match = tag_overlap > 0;
        match action.as_str() {
            "more_like_this" => {
                if exact_match {
                    adjustment += 16;
                } else if contextual_match {
                    adjustment += 10 + (tag_overlap as i32) * 2;
                }
            }
            "less_like_this" => {
                if exact_match {
                    hidden = true;
                    adjustment -= 100_000;
                } else if contextual_match {
                    adjustment -= 10 + (tag_overlap as i32) * 2;
                }
            }
            _ => {}
        }
    }
    (adjustment, hidden)
}

struct RerankScratch {
    base_score: f64,
    feedback_adjustment: i32,
    hidden: bool,
    tags: Vec<String>,
    seeds: Vec<String>,
}

fn candidate_tags(candidate: &Recommendation) -> Vec<String> {
    if !candidate.matched_tags.is_empty() {
        candidate.matched_tags.iter().map(|t| normalize_text(t)).collect()
    } else {
        candidate.tags.iter().map(|t| normalize_text(t)).collect()
    }
}

fn candidate_seeds(candidate: &Recommendation) -> Vec<String> {
    if !candidate.supporting_seeds.is_empty() {
        candidate
            .supporting_seeds
            .iter()
            .filter_map(|seed| seed.artist_name.as_ref())
            .map(|name| normalize_text(name))
            .collect()
    } else {
        candidate
            .source_artists
            .iter()
            .map(|name| normalize_text(name))
            .collect()
    }
}

pub fn rerank_recommendations(
    recommendations: Vec<Recommendation>,
    limit: usize,
    discovery_mode: &str,
    feedback: &[FeedbackEntry],
) -> Vec<Recommendation> {
    let multipliers = mode_multipliers(discovery_mode);
    let limit = limit.max(1);
    let mut pool: Vec<(RerankScratch, Recommendation)> = recommendations
        .into_iter()
        .map(|entry| {
            let tags = candidate_tags(&entry);
            let seeds = candidate_seeds(&entry);
            let (feedback_adjustment, hidden) = feedback_boost(&entry, feedback);
            let base_score = (entry.score_similarity.unwrap_or(0) as f64) * multipliers.similarity
                + (entry.score_tag_affinity.unwrap_or(0) as f64) * multipliers.tag_affinity
                + (entry.score_seed_coverage.unwrap_or(0) as f64) * multipliers.seed_coverage
                + (entry.score_novelty.unwrap_or(0) as f64) * multipliers.novelty
                - (entry.score_popularity_penalty.unwrap_or(0) as f64)
                    * multipliers.popularity_penalty
                + entry.score_freshness_boost.unwrap_or(0.0)
                - entry.score_aging_penalty.unwrap_or(0.0);
            (
                RerankScratch {
                    base_score,
                    feedback_adjustment,
                    hidden,
                    tags,
                    seeds,
                },
                entry,
            )
        })
        .filter(|(meta, _)| !meta.hidden)
        .collect();

    pool.sort_by(|left, right| {
        let left_score = left.0.base_score as i32 + left.0.feedback_adjustment;
        let right_score = right.0.base_score as i32 + right.0.feedback_adjustment;
        right_score
            .cmp(&left_score)
            .then_with(|| {
                right
                    .1
                    .seed_count
                    .unwrap_or(0)
                    .cmp(&left.1.seed_count.unwrap_or(0))
            })
            .then_with(|| {
                left.1
                    .name
                    .as_deref()
                    .unwrap_or("")
                    .cmp(right.1.name.as_deref().unwrap_or(""))
            })
    });

    let mut selected: Vec<Recommendation> = Vec::new();
    let mut selected_tag_counts: HashMap<String, i32> = HashMap::new();
    let mut selected_seed_counts: HashMap<String, i32> = HashMap::new();

    while !pool.is_empty() && selected.len() < limit {
        let mut best_index = 0;
        let mut best_score = i32::MIN;
        let mut best_diversity = 0;

        for (index, (meta, _)) in pool.iter().enumerate() {
            let mut diversity_penalty = 0.0;
            for tag in &meta.tags {
                diversity_penalty += (*selected_tag_counts.get(tag).unwrap_or(&0) as f64) * 1.8;
            }
            for seed in &meta.seeds {
                diversity_penalty += (*selected_seed_counts.get(seed).unwrap_or(&0) as f64) * 2.6;
            }
            let score_total = (meta.base_score
                - diversity_penalty * multipliers.diversity_penalty
                + meta.feedback_adjustment as f64)
                .round() as i32;
            if score_total > best_score {
                best_score = score_total;
                best_index = index;
                best_diversity = diversity_penalty.round() as i32;
            }
        }

        let (meta, mut chosen) = pool.swap_remove(best_index);
        for tag in meta.tags {
            *selected_tag_counts.entry(tag).or_insert(0) += 1;
        }
        for seed in meta.seeds {
            *selected_seed_counts.entry(seed).or_insert(0) += 1;
        }
        chosen.score_diversity_penalty = Some(best_diversity);
        chosen.score_total = Some(best_score);
        chosen.score = Some(best_score);
        selected.push(chosen);
    }

    selected
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Recommendation;

    #[test]
    fn rerank_limits_output_size() {
        let recommendations = (0..20)
            .map(|index| Recommendation {
                name: Some(format!("Artist {index}")),
                score_total: Some(100 - index),
                score_similarity: Some(80 - index),
                seed_count: Some(1),
                ..Recommendation::default()
            })
            .collect();
        let ranked = rerank_recommendations(recommendations, 5, "balanced", &[]);
        assert_eq!(ranked.len(), 5);
    }
}

pub fn merge_resolved_recommendations(
    recommendations: Vec<Recommendation>,
    existing_artist_keys: &HashSet<String>,
) -> Vec<Recommendation> {
    let mut merged: IndexMap<String, Recommendation> = IndexMap::new();
    let mut aliases: HashMap<String, String> = HashMap::new();

    for recommendation in recommendations {
        let keys = recommendation_identity_keys(&recommendation);
        if keys.iter().any(|key| existing_artist_keys.contains(key)) {
            continue;
        }
        let identity_keys: Vec<String> = vec![
            normalize_mbid(recommendation.id.as_deref()).map(|mbid| format!("mbid:{mbid}")),
            recommendation
                .name
                .as_ref()
                .map(|name| format!("name:{}", normalize_text(name))),
        ]
        .into_iter()
        .flatten()
        .collect();
        if identity_keys.is_empty() {
            continue;
        }
        let existing_identity = identity_keys
            .iter()
            .find_map(|key| aliases.get(key).cloned());
        let identity = existing_identity.unwrap_or_else(|| identity_keys[0].clone());

        if let Some(existing) = merged.get_mut(&identity) {
            merge_recommendation_entries(existing, recommendation);
        } else {
            for key in &identity_keys {
                aliases.insert(key.clone(), identity.clone());
            }
            merged.insert(identity, recommendation);
        }
    }

    merged.into_values().collect()
}

fn recommendation_identity_keys(recommendation: &Recommendation) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(mbid) = normalize_mbid(recommendation.id.as_deref()) {
        keys.push(format!("mbid:{mbid}"));
    }
    if let Some(name) = recommendation.name.as_deref() {
        let normalized = normalize_text(name);
        if !normalized.is_empty() {
            keys.push(format!("name:{normalized}"));
        }
    }
    keys
}

fn merge_recommendation_entries(target: &mut Recommendation, source: Recommendation) {
    target.score_similarity = Some(
        target.score_similarity.unwrap_or(0) + source.score_similarity.unwrap_or(0),
    );
    target.score_tag_affinity = Some(
        target.score_tag_affinity.unwrap_or(0) + source.score_tag_affinity.unwrap_or(0),
    );
    target.score_total = Some(target.score_total.unwrap_or(0) + source.score_total.unwrap_or(0));
    target.score = target.score_total;
    target.seed_count = Some(
        target
            .seed_count
            .unwrap_or(0)
            .max(source.seed_count.unwrap_or(0)),
    );
    for tag in source.tags {
        if !target.tags.iter().any(|t| normalize_text(t) == normalize_text(&tag)) {
            target.tags.push(tag);
        }
    }
    for tag in source.matched_tags {
        if !target
            .matched_tags
            .iter()
            .any(|t| normalize_text(t) == normalize_text(&tag))
        {
            target.matched_tags.push(tag);
        }
    }
    if target.id.is_none() {
        target.id = source.id;
    }
}
