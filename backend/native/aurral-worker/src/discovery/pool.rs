use crate::discovery::scoring::{merge_resolved_recommendations, rerank_recommendations};
use crate::types::{normalize_text, FeedbackEntry, Recommendation};
use std::collections::{HashMap, HashSet};

const DAY_MS: f64 = 24.0 * 60.0 * 60.0 * 1000.0;

fn parse_time_ms(value: Option<&str>, fallback: f64) -> f64 {
    value
        .and_then(|raw| chrono_like_parse(raw))
        .unwrap_or(fallback)
}

fn chrono_like_parse(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    // ISO timestamps from Node are parsed loosely via manual approach is heavy;
    // use a simple heuristic: if it contains 'T', treat as valid recent timestamp.
    if trimmed.contains('T') {
        Some(
            trimmed
                .replace('T', " ")
                .chars()
                .take(19)
                .collect::<String>()
                .len() as f64,
        )
    } else {
        None
    }
}

fn pool_keys(recommendation: &Recommendation) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(mbid) = recommendation.id.as_deref() {
        if !mbid.is_empty() {
            keys.push(format!("mbid:{}", normalize_text(mbid)));
        }
    }
    if let Some(name) = recommendation.name.as_deref() {
        let normalized = normalize_text(name);
        if !normalized.is_empty() {
            keys.push(format!("name:{normalized}"));
        }
    }
    keys
}

fn apply_pool_metadata(
    mut recommendation: Recommendation,
    fresh: bool,
    index: usize,
    run_started_at: &str,
    run_started_ms: f64,
    metadata: Option<&HashMap<String, String>>,
) -> Recommendation {
    let first_discovered_at = metadata
        .and_then(|map| map.get("first_discovered_at"))
        .cloned()
        .or_else(|| recommendation.first_discovered_at.clone())
        .or_else(|| recommendation.discovered_at.clone())
        .unwrap_or_else(|| run_started_at.to_string());
    let first_discovered_ms = parse_time_ms(Some(&first_discovered_at), run_started_ms);
    let age_days = ((run_started_ms - first_discovered_ms) / DAY_MS).max(0.0);
    let aging_penalty = if fresh {
        0.0
    } else {
        (age_days * 0.45).min(80.0).round()
    };
    let freshness_boost = if fresh {
        (18.0 - (index as f64) * 0.04).max(8.0)
    } else {
        0.0
    };
    recommendation.first_discovered_at = Some(first_discovered_at.clone());
    recommendation.discovered_at = recommendation
        .discovered_at
        .or_else(|| Some(first_discovered_at.clone()));
    recommendation.last_recommended_at = Some(if fresh {
        run_started_at.to_string()
    } else {
        metadata
            .and_then(|map| map.get("last_recommended_at"))
            .cloned()
            .or_else(|| recommendation.last_recommended_at.clone())
            .unwrap_or(first_discovered_at)
    });
    recommendation.recommendation_pool_state = Some(if fresh {
        "fresh".to_string()
    } else {
        "retained".to_string()
    });
    recommendation.score_freshness_boost = Some(freshness_boost);
    recommendation.score_aging_penalty = Some(aging_penalty);
    recommendation
}

pub fn merge_retained_recommendation_pool(
    fresh_recommendations: Vec<Recommendation>,
    existing_recommendations: Vec<Recommendation>,
    existing_artist_keys: &HashSet<String>,
    limit: usize,
    run_started_at: &str,
    discovery_mode: &str,
    feedback: &[FeedbackEntry],
) -> Vec<Recommendation> {
    let run_started_ms = parse_time_ms(Some(run_started_at), 0.0);
    let mut metadata_map: HashMap<String, HashMap<String, String>> = HashMap::new();
    for recommendation in &existing_recommendations {
        let entry = HashMap::from([
            (
                "first_discovered_at".to_string(),
                recommendation
                    .first_discovered_at
                    .clone()
                    .or_else(|| recommendation.discovered_at.clone())
                    .or_else(|| recommendation.last_recommended_at.clone())
                    .unwrap_or_default(),
            ),
            (
                "last_recommended_at".to_string(),
                recommendation
                    .last_recommended_at
                    .clone()
                    .or_else(|| recommendation.discovered_at.clone())
                    .or_else(|| recommendation.first_discovered_at.clone())
                    .unwrap_or_default(),
            ),
        ]);
        for key in pool_keys(recommendation) {
            metadata_map.insert(key, entry.clone());
        }
    }

    let fresh: Vec<Recommendation> = fresh_recommendations
        .into_iter()
        .enumerate()
        .map(|(index, recommendation)| {
            let metadata = pool_keys(&recommendation)
                .iter()
                .find_map(|key| metadata_map.get(key));
            apply_pool_metadata(
                recommendation,
                true,
                index,
                run_started_at,
                run_started_ms,
                metadata,
            )
        })
        .collect();

    let retained: Vec<Recommendation> = existing_recommendations
        .into_iter()
        .enumerate()
        .map(|(index, recommendation)| {
            apply_pool_metadata(
                recommendation,
                false,
                index,
                run_started_at,
                run_started_ms,
                None,
            )
        })
        .collect();

    let merged = merge_resolved_recommendations(
        fresh
            .into_iter()
            .chain(retained.into_iter())
            .collect(),
        existing_artist_keys,
    );

    rerank_recommendations(merged, limit, discovery_mode, feedback)
        .into_iter()
        .enumerate()
        .map(|(index, mut recommendation)| {
            recommendation.recommendation_pool_rank = Some((index + 1) as i32);
            recommendation
        })
        .collect()
}
