use crate::discovery::global_top::fetch_global_top;
use crate::discovery::image_hydrate::hydrate_recommendation_images;
use crate::discovery::seeds::{build_discovery_seed_list, build_taste_profile_seeds};
use crate::discovery::tag_harvest::collect_seed_tags;
use crate::jobs::discovery_run::{run_with_clients as run_discovery_run, DiscoveryRunResult};
use crate::net::lastfm::{LastfmClient, LastfmHealth};
use crate::net::metadata::MetadataClient;
use crate::types::{
    existing_key_set, DiscoveryPipelineJob, DiscoveryRunJob, DiscoverySeed, Recommendation,
    WorkerStats,
};
use serde::Serialize;
use std::env;
use std::sync::Arc;
use std::time::Instant;

pub struct DiscoveryPipelineResult {
    pub seeds: Vec<DiscoverySeed>,
    pub global_top: Vec<Recommendation>,
    pub recommendations: Vec<Recommendation>,
    pub fresh_recommendations: Vec<Recommendation>,
    pub playlists: Vec<crate::types::PlaylistPreview>,
    pub top_tags: Vec<String>,
    pub top_genres: Vec<String>,
    pub stats: WorkerStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryPipelinePayload {
    pub seeds: Vec<DiscoverySeed>,
    pub global_top: Vec<Recommendation>,
    pub recommendations: Vec<Recommendation>,
    #[serde(rename = "freshRecommendations")]
    pub fresh_recommendations: Vec<Recommendation>,
    pub playlists: Vec<crate::types::PlaylistPreview>,
    pub top_tags: Vec<String>,
    pub top_genres: Vec<String>,
}

impl DiscoveryPipelineResult {
    pub fn to_payload(&self) -> DiscoveryPipelinePayload {
        DiscoveryPipelinePayload {
            seeds: self.seeds.clone(),
            global_top: self.global_top.clone(),
            recommendations: self.recommendations.clone(),
            fresh_recommendations: self.fresh_recommendations.clone(),
            playlists: self.playlists.clone(),
            top_tags: self.top_tags.clone(),
            top_genres: self.top_genres.clone(),
        }
    }
}

pub async fn run(job: DiscoveryPipelineJob) -> Result<DiscoveryPipelineResult, String> {
    let started = Instant::now();
    let api_key = env::var("LASTFM_API_KEY")
        .or_else(|_| env::var("AURRAL_LASTFM_API_KEY"))
        .map_err(|_| "LASTFM_API_KEY is not configured".to_string())?;
    let concurrency = crate::util::network_concurrency();
    let lastfm = Arc::new(LastfmClient::new(api_key, concurrency));
    let metadata = Arc::new(MetadataClient::new());
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
    let mut refresh_metadata_calls = 0u64;
    let mut refresh_lastfm_calls = 0u64;
    if job.include_global_top {
        let mut health = LastfmHealth {
            success: 0,
            failure: 0,
        };
        global_top = fetch_global_top(
            lastfm.as_ref(),
            metadata.clone(),
            &existing_keys,
            &mut health,
            concurrency,
        )
        .await;
        let hydrate_limit = global_top.len().min(32);
        hydrate_recommendation_images(metadata.clone(), &mut global_top, hydrate_limit).await;
        refresh_metadata_calls = *metadata.calls.lock().await;
        refresh_lastfm_calls = *lastfm.calls.lock().await;
    }

    let harvest = collect_seed_tags(&seeds, lastfm.clone()).await;

    let run_job = DiscoveryRunJob {
        seeds: seeds.clone(),
        existing_artist_keys: job.existing_artist_keys,
        discovery_mode: job.discovery_mode,
        existing_recommendations: job.existing_recommendations,
        feedback: job.feedback,
        limits: job.limits,
        recommendation_run_started_at: job.recommendation_run_started_at,
        presets: job.presets,
        global_top: global_top.clone(),
        based_on: job.based_on,
        top_genres: job.top_genres,
        top_tags: job.top_tags,
        library_mix_artists: job.library_mix_artists,
        release_radar_releases: job.release_radar_releases,
        release_radar_size: job.release_radar_size,
        image_hydration: job.image_hydration,
        skip_playlist_plan: job.skip_playlist_plan,
    };

    let DiscoveryRunResult {
        recommendations,
        fresh_recommendations,
        playlists,
        top_tags,
        top_genres,
        stats: run_stats,
    } = run_discovery_run(run_job, lastfm.clone(), metadata.clone(), Some(harvest)).await?;

    let total_lastfm = refresh_lastfm_calls + run_stats.lastfm_calls;
    let total_metadata = refresh_metadata_calls + run_stats.musicbrainz_calls;

    Ok(DiscoveryPipelineResult {
        seeds,
        global_top,
        recommendations,
        fresh_recommendations,
        playlists,
        top_tags,
        top_genres,
        stats: WorkerStats {
            lastfm_calls: total_lastfm,
            musicbrainz_calls: total_metadata,
            duration_ms: started.elapsed().as_millis() as u64,
        },
    })
}
