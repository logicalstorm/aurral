use crate::discovery::scoring::merge_resolved_recommendations;
use crate::net::lastfm::{LastfmClient, LastfmHealth};
use crate::net::metadata::MetadataClient;
use crate::types::Recommendation;
use crate::util::concurrency::map_with_concurrency;
use crate::util::metadata_concurrency;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;

fn pick_lastfm_image(images: &Value) -> Option<String> {
    let list = if images.is_array() {
        images.as_array().cloned().unwrap_or_default()
    } else if images.is_object() {
        vec![images.clone()]
    } else {
        Vec::new()
    };
    list.iter()
        .rev()
        .find_map(|entry| {
            entry
                .get("#text")
                .or_else(|| entry.get("url"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}


fn build_trending_artist_entry(artist: &Value, image_override: Option<String>) -> Option<Recommendation> {
    let name = artist
        .get("name")
        .or_else(|| artist.get("#text"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())?;
    let id = artist
        .get("mbid")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let image = image_override.or_else(|| pick_lastfm_image(artist.get("image").unwrap_or(&Value::Null)));
    Some(Recommendation {
        id: id.clone(),
        name: Some(name),
        kind: Some("Artist".to_string()),
        image,
        navigate_to: id,
        ..Recommendation::default()
    })
}

async fn resolve_global_top_mbids(
    metadata: Arc<MetadataClient>,
    items: &mut [Recommendation],
) {
    let resolve_jobs: Vec<(usize, String)> = items
        .iter()
        .enumerate()
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

    let resolved = map_with_concurrency(
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

    for (index, mbid) in resolved {
        if let Some(mbid) = mbid {
            items[index].id = Some(mbid.clone());
            items[index].navigate_to = Some(mbid);
        }
    }
}

pub async fn fetch_global_top(
    lastfm: &LastfmClient,
    metadata: Arc<MetadataClient>,
    existing_artist_keys: &HashSet<String>,
    health: &mut LastfmHealth,
    _concurrency: usize,
) -> Vec<Recommendation> {
    let failure_ratio = health.failure_ratio();
    let chart_limit = if failure_ratio >= 0.3 { 60 } else { 100 };
    let max_resolve = if failure_ratio >= 0.8 { 20 } else { 30 };

    let track_data = lastfm
        .chart_get_top_tracks(chart_limit, health)
        .await;
    let mut trending = Vec::new();
    if let Some(tracks) = track_data
        .as_ref()
        .and_then(|value| value.pointer("/tracks/track"))
    {
        let track_list = if tracks.is_array() {
            tracks.as_array().cloned().unwrap_or_default()
        } else {
            vec![tracks.clone()]
        };
        for track in track_list {
            let artist_value = track.get("artist").cloned().unwrap_or(Value::Null);
            if let Some(entry) = build_trending_artist_entry(
                &artist_value,
                pick_lastfm_image(track.get("image").unwrap_or(&Value::Null)),
            ) {
                trending.push(entry);
            }
        }
    }

    let mut global_top = merge_resolved_recommendations(trending, existing_artist_keys);
    global_top.truncate(32);

    if global_top.len() < 12 {
        if let Some(artist_data) = lastfm
            .chart_get_top_artists(chart_limit, health)
            .await
        {
            if let Some(artists) = artist_data.pointer("/artists/artist") {
                let artist_list = if artists.is_array() {
                    artists.as_array().cloned().unwrap_or_default()
                } else {
                    vec![artists.clone()]
                };
                let mut merged_input = global_top.clone();
                for artist in artist_list {
                    if let Some(entry) = build_trending_artist_entry(&artist, None) {
                        merged_input.push(entry);
                    }
                }
                global_top = merge_resolved_recommendations(merged_input, existing_artist_keys);
                global_top.truncate(32);
            }
        }
    }

    let resolve_count = global_top.len().min(max_resolve);
    if resolve_count > 0 {
        resolve_global_top_mbids(metadata.clone(), &mut global_top[..resolve_count]).await;
    }

    global_top
        .into_iter()
        .filter(|item| item.id.is_some() || item.navigate_to.is_some())
        .take(32)
        .collect()
}
