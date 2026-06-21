use crate::discovery::image_hydrate::hydrate_recommendation_images;
use crate::discovery::tag_harvest::collect_seed_tags;
use crate::jobs::discovery_enrich::{run as run_discovery_enrich, DiscoveryEnrichResult};
use crate::jobs::playlist_plan::{run as run_playlist_plan, PlaylistPlanResult};
use crate::net::lastfm::LastfmClient;
use crate::net::metadata::MetadataClient;
use crate::types::{
    DiscoveryEnrichJob, DiscoveryRunJob, PlaylistPlanJob, PlaylistPreview, Recommendation,
    WorkerStats,
};
use serde::Serialize;
use std::env;
use std::sync::Arc;
use std::time::Instant;

pub struct DiscoveryRunResult {
    pub recommendations: Vec<Recommendation>,
    pub fresh_recommendations: Vec<Recommendation>,
    pub playlists: Vec<PlaylistPreview>,
    pub top_tags: Vec<String>,
    pub top_genres: Vec<String>,
    pub stats: WorkerStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRunPayload {
    pub recommendations: Vec<Recommendation>,
    #[serde(rename = "freshRecommendations")]
    pub fresh_recommendations: Vec<Recommendation>,
    pub playlists: Vec<PlaylistPreview>,
    pub top_tags: Vec<String>,
    pub top_genres: Vec<String>,
}

impl DiscoveryRunResult {
    pub fn to_payload(&self) -> DiscoveryRunPayload {
        DiscoveryRunPayload {
            recommendations: self.recommendations.clone(),
            fresh_recommendations: self.fresh_recommendations.clone(),
            playlists: self.playlists.clone(),
            top_tags: self.top_tags.clone(),
            top_genres: self.top_genres.clone(),
        }
    }
}

pub async fn run(job: DiscoveryRunJob) -> Result<DiscoveryRunResult, String> {
    let started = Instant::now();

    let harvest = {
        let api_key = env::var("LASTFM_API_KEY")
            .or_else(|_| env::var("AURRAL_LASTFM_API_KEY"))
            .map_err(|_| "LASTFM_API_KEY is not configured".to_string())?;
        let concurrency = env::var("AURRAL_LASTFM_CONCURRENCY")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(12)
            .clamp(1, 16);
        let lastfm = Arc::new(LastfmClient::new(api_key, concurrency));
        collect_seed_tags(&job.seeds, lastfm).await
    };

    let enrich_job = DiscoveryEnrichJob {
        seeds: job.seeds,
        existing_artist_keys: job.existing_artist_keys.clone(),
        profile_tag_weights: harvest.profile_tag_weights,
        seed_tag_map: harvest.seed_tag_map,
        discovery_mode: job.discovery_mode,
        existing_recommendations: job.existing_recommendations,
        feedback: job.feedback,
        limits: job.limits,
        recommendation_run_started_at: job.recommendation_run_started_at,
    };

    let DiscoveryEnrichResult {
        mut recommendations,
        mut fresh_recommendations,
        stats: enrich_stats,
    } = run_discovery_enrich(enrich_job).await?;

    let playlist_job = PlaylistPlanJob {
        presets: job.presets,
        existing_artist_keys: job.existing_artist_keys,
        recommendations: recommendations.clone(),
        global_top: job.global_top,
        based_on: job.based_on,
        top_genres: if job.top_genres.is_empty() {
            harvest.top_genres.clone()
        } else {
            job.top_genres
        },
        top_tags: if job.top_tags.is_empty() {
            harvest.top_tags.clone()
        } else {
            job.top_tags
        },
        library_mix_artists: job.library_mix_artists,
        release_radar_releases: job.release_radar_releases,
        release_radar_size: job.release_radar_size,
    };

    let PlaylistPlanResult {
        playlists,
        stats: playlist_stats,
    } = run_playlist_plan(playlist_job).await?;

    let metadata = MetadataClient::new();
    let hydration = job.image_hydration.unwrap_or_default();
    let fresh_limit = hydration
        .fresh_limit
        .unwrap_or(fresh_recommendations.len());
    let pool_limit = hydration.pool_limit.unwrap_or(recommendations.len());
    hydrate_recommendation_images(&metadata, &mut fresh_recommendations, fresh_limit).await;
    hydrate_recommendation_images(&metadata, &mut recommendations, pool_limit).await;
    let hydration_metadata_calls = *metadata.calls.lock().await;

    Ok(DiscoveryRunResult {
        recommendations,
        fresh_recommendations,
        playlists,
        top_tags: harvest.top_tags,
        top_genres: harvest.top_genres,
        stats: WorkerStats {
            lastfm_calls: enrich_stats.lastfm_calls + playlist_stats.lastfm_calls,
            musicbrainz_calls: enrich_stats.musicbrainz_calls
                + playlist_stats.musicbrainz_calls
                + hydration_metadata_calls,
            duration_ms: started.elapsed().as_millis() as u64,
        },
    })
}
