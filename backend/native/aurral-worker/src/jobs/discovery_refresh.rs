use crate::discovery::global_top::fetch_global_top;
use crate::discovery::image_hydrate::hydrate_recommendation_images;
use crate::discovery::seeds::{build_discovery_seed_list, build_taste_profile_seeds};
use crate::net::lastfm::{LastfmClient, LastfmHealth};
use crate::net::metadata::MetadataClient;
use crate::types::{
    existing_key_set, DiscoveryRefreshJob, DiscoverySeed, Recommendation, WorkerStats,
};
use serde::Serialize;
use std::env;
use std::time::Instant;

pub struct DiscoveryRefreshResult {
    pub seeds: Vec<DiscoverySeed>,
    pub global_top: Vec<Recommendation>,
    pub stats: WorkerStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRefreshPayload {
    pub seeds: Vec<DiscoverySeed>,
    pub global_top: Vec<Recommendation>,
}

impl DiscoveryRefreshResult {
    pub fn to_payload(&self) -> DiscoveryRefreshPayload {
        DiscoveryRefreshPayload {
            seeds: self.seeds.clone(),
            global_top: self.global_top.clone(),
        }
    }
}

pub async fn run(job: DiscoveryRefreshJob) -> Result<DiscoveryRefreshResult, String> {
    let started = Instant::now();
    let api_key = env::var("LASTFM_API_KEY")
        .or_else(|_| env::var("AURRAL_LASTFM_API_KEY"))
        .map_err(|_| "LASTFM_API_KEY is not configured".to_string())?;
    let concurrency = env::var("AURRAL_LASTFM_CONCURRENCY")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(12)
        .clamp(1, 16);

    let lastfm = LastfmClient::new(api_key, concurrency);
    let metadata = MetadataClient::new();
    let existing_keys = existing_key_set(&job.existing_artist_keys);

    let (library_seeds, history_seeds) = build_taste_profile_seeds(
        &job.recent_library_artists,
        &job.all_library_artists,
        &job.history_artists,
    );
    let mut seeds = build_discovery_seed_list(&library_seeds, &history_seeds);
    if let Some(limit) = job.seed_limit {
        seeds.truncate(limit.max(0));
    }

    let mut global_top = Vec::new();
    let mut metadata_calls = 0u64;
    if job.include_global_top {
        let mut health = LastfmHealth {
            success: 0,
            failure: 0,
        };
        global_top = fetch_global_top(
            &lastfm,
            &metadata,
            &existing_keys,
            &mut health,
            concurrency,
        )
        .await;
        let hydrate_limit = global_top.len().min(32);
        hydrate_recommendation_images(&metadata, &mut global_top, hydrate_limit).await;
        metadata_calls = *metadata.calls.lock().await;
    }

    let lastfm_calls = *lastfm.calls.lock().await;
    Ok(DiscoveryRefreshResult {
        seeds,
        global_top,
        stats: WorkerStats {
            lastfm_calls,
            musicbrainz_calls: metadata_calls,
            duration_ms: started.elapsed().as_millis() as u64,
        },
    })
}
