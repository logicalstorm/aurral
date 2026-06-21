use crate::discovery::pool::merge_retained_recommendation_pool;
use crate::discovery::scoring::rerank_recommendations;
use crate::discovery::similarity::{
    build_recommendations_from_seeds, resolve_recommendation_candidates,
};
use crate::net::lastfm::LastfmClient;
use crate::net::metadata::MetadataClient;
use crate::types::{
    existing_key_set, DiscoveryEnrichJob, Recommendation, WorkerStats,
};
use crate::util::network_concurrency;
use std::env;
use std::sync::Arc;
use std::time::Instant;

pub struct DiscoveryEnrichResult {
    pub recommendations: Vec<Recommendation>,
    pub fresh_recommendations: Vec<Recommendation>,
    pub stats: WorkerStats,
}

pub async fn run_with_clients(
    job: DiscoveryEnrichJob,
    lastfm: Arc<LastfmClient>,
    metadata: Arc<MetadataClient>,
) -> Result<DiscoveryEnrichResult, String> {
    let started = Instant::now();
    let existing_artist_keys = existing_key_set(&job.existing_artist_keys);
    let discovery_mode = job.discovery_mode.as_deref().unwrap_or("balanced");
    let run_started_at = job
        .recommendation_run_started_at
        .clone()
        .unwrap_or_else(|| "now".to_string());

    let (raw_recommendations, _, _) = build_recommendations_from_seeds(
        &job.seeds,
        &existing_artist_keys,
        &job.profile_tag_weights,
        &job.seed_tag_map,
        discovery_mode,
        job.limits.per_refresh,
        job.limits.pool_cap,
        lastfm.clone(),
    )
    .await;

    let resolve_limit = job.limits.per_refresh.max(120);
    let resolved = resolve_recommendation_candidates(
        raw_recommendations,
        &existing_artist_keys,
        resolve_limit,
        metadata.clone(),
    )
    .await;

    let fresh_recommendations = rerank_recommendations(
        resolved,
        job.limits.per_refresh,
        discovery_mode,
        &job.feedback,
    );

    let recommendations = merge_retained_recommendation_pool(
        fresh_recommendations.clone(),
        job.existing_recommendations,
        &existing_artist_keys,
        job.limits.pool_cap,
        &run_started_at,
        discovery_mode,
        &job.feedback,
    );

    let lastfm_calls = *lastfm.calls.lock().await;
    let metadata_calls = *metadata.calls.lock().await;
    let stats = WorkerStats {
        lastfm_calls,
        musicbrainz_calls: metadata_calls,
        duration_ms: started.elapsed().as_millis() as u64,
    };

    Ok(DiscoveryEnrichResult {
        recommendations,
        fresh_recommendations,
        stats,
    })
}

pub async fn run(job: DiscoveryEnrichJob) -> Result<DiscoveryEnrichResult, String> {
    let api_key = env::var("LASTFM_API_KEY")
        .or_else(|_| env::var("AURRAL_LASTFM_API_KEY"))
        .map_err(|_| "LASTFM_API_KEY is not configured".to_string())?;
    let lastfm = Arc::new(LastfmClient::new(api_key, network_concurrency()));
    let metadata = Arc::new(MetadataClient::new());
    run_with_clients(job, lastfm, metadata).await
}
