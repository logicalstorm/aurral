use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TasteArtistInput {
    #[serde(default)]
    pub mbid: Option<String>,
    pub artist_name: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub playcount: Option<i64>,
    #[serde(default)]
    pub affinity_weight: Option<f64>,
    #[serde(default)]
    pub profile_bucket: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImageHydrationLimits {
    #[serde(default)]
    pub fresh_limit: Option<usize>,
    #[serde(default)]
    pub pool_limit: Option<usize>,
    #[serde(default)]
    pub global_top_limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRefreshJob {
    #[serde(default)]
    pub recent_library_artists: Vec<TasteArtistInput>,
    #[serde(default)]
    pub all_library_artists: Vec<TasteArtistInput>,
    #[serde(default)]
    pub history_artists: Vec<TasteArtistInput>,
    #[serde(default)]
    pub existing_artist_keys: Vec<String>,
    #[serde(default)]
    pub seed_limit: Option<usize>,
    #[serde(default)]
    pub include_global_top: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JobLimits {
    #[serde(default = "default_pool_cap")]
    pub pool_cap: usize,
    #[serde(default = "default_per_refresh")]
    pub per_refresh: usize,
}

fn default_pool_cap() -> usize {
    500
}

fn default_per_refresh() -> usize {
    200
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverySeed {
    pub mbid: Option<String>,
    pub artist_name: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub affinity_weight: Option<f64>,
    #[serde(default)]
    pub profile_bucket: Option<String>,
    #[serde(default)]
    pub discovery_depth: Option<i32>,
    #[serde(default)]
    pub similarity_multiplier: Option<f64>,
    #[serde(default)]
    pub tag_affinity_multiplier: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackEntry {
    #[serde(default)]
    pub artist_name: Option<String>,
    #[serde(default)]
    pub artist_mbid: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryEnrichJob {
    pub seeds: Vec<DiscoverySeed>,
    #[serde(default)]
    pub existing_artist_keys: Vec<String>,
    #[serde(default)]
    pub profile_tag_weights: HashMap<String, f64>,
    #[serde(default)]
    pub seed_tag_map: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub discovery_mode: Option<String>,
    #[serde(default)]
    pub existing_recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub feedback: Vec<FeedbackEntry>,
    #[serde(default)]
    pub limits: JobLimits,
    #[serde(default)]
    pub recommendation_run_started_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPreset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub size: Option<usize>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub related_artists: Vec<String>,
    #[serde(default)]
    pub mix: Option<Value>,
    #[serde(default)]
    pub deep_dive: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMixArtist {
    pub artist_name: String,
    #[serde(default)]
    pub artist_mbid: Option<String>,
    #[serde(default)]
    pub owned_titles: Vec<String>,
    #[serde(default)]
    pub owned_albums: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseRadarRelease {
    pub artist_name: String,
    pub album_name: String,
    #[serde(default)]
    pub album_mbid: Option<String>,
    #[serde(default)]
    pub artist_mbid: Option<String>,
    #[serde(default)]
    pub release_year: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPlanJob {
    #[serde(default)]
    pub presets: Vec<PlaylistPreset>,
    #[serde(default)]
    pub existing_artist_keys: Vec<String>,
    #[serde(default)]
    pub recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub global_top: Vec<Recommendation>,
    #[serde(default)]
    pub based_on: Vec<Value>,
    #[serde(default)]
    pub top_genres: Vec<String>,
    #[serde(default)]
    pub top_tags: Vec<String>,
    #[serde(default)]
    pub library_mix_artists: Vec<LibraryMixArtist>,
    #[serde(default)]
    pub release_radar_releases: Vec<ReleaseRadarRelease>,
    #[serde(default)]
    pub release_radar_size: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryPipelineJob {
    #[serde(default)]
    pub recent_library_artists: Vec<TasteArtistInput>,
    #[serde(default)]
    pub all_library_artists: Vec<TasteArtistInput>,
    #[serde(default)]
    pub history_artists: Vec<TasteArtistInput>,
    #[serde(default)]
    pub existing_artist_keys: Vec<String>,
    #[serde(default)]
    pub seed_limit: Option<usize>,
    #[serde(default)]
    pub include_global_top: bool,
    #[serde(default)]
    pub discovery_mode: Option<String>,
    #[serde(default)]
    pub existing_recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub feedback: Vec<FeedbackEntry>,
    #[serde(default)]
    pub limits: JobLimits,
    #[serde(default)]
    pub recommendation_run_started_at: Option<String>,
    #[serde(default)]
    pub presets: Vec<PlaylistPreset>,
    #[serde(default)]
    pub based_on: Vec<Value>,
    #[serde(default)]
    pub top_genres: Vec<String>,
    #[serde(default)]
    pub top_tags: Vec<String>,
    #[serde(default)]
    pub library_mix_artists: Vec<LibraryMixArtist>,
    #[serde(default)]
    pub release_radar_releases: Vec<ReleaseRadarRelease>,
    #[serde(default)]
    pub release_radar_size: Option<usize>,
    #[serde(default)]
    pub image_hydration: Option<ImageHydrationLimits>,
    #[serde(default)]
    pub skip_playlist_plan: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryRunJob {
    pub seeds: Vec<DiscoverySeed>,
    #[serde(default)]
    pub existing_artist_keys: Vec<String>,
    #[serde(default)]
    pub discovery_mode: Option<String>,
    #[serde(default)]
    pub existing_recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub feedback: Vec<FeedbackEntry>,
    #[serde(default)]
    pub limits: JobLimits,
    #[serde(default)]
    pub recommendation_run_started_at: Option<String>,
    #[serde(default)]
    pub presets: Vec<PlaylistPreset>,
    #[serde(default)]
    pub global_top: Vec<Recommendation>,
    #[serde(default)]
    pub based_on: Vec<Value>,
    #[serde(default)]
    pub top_genres: Vec<String>,
    #[serde(default)]
    pub top_tags: Vec<String>,
    #[serde(default)]
    pub library_mix_artists: Vec<LibraryMixArtist>,
    #[serde(default)]
    pub release_radar_releases: Vec<ReleaseRadarRelease>,
    #[serde(default)]
    pub release_radar_size: Option<usize>,
    #[serde(default)]
    pub image_hydration: Option<ImageHydrationLimits>,
    #[serde(default)]
    pub skip_playlist_plan: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlowPlanFlow {
    #[serde(default)]
    pub size: Option<usize>,
    #[serde(default)]
    pub mix: Option<Value>,
    #[serde(default)]
    pub deep_dive: Option<bool>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub related_artists: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPlanJob {
    pub flow: FlowPlanFlow,
    #[serde(default)]
    pub discover_preset_id: Option<String>,
    #[serde(default)]
    pub existing_artist_keys: Vec<String>,
    #[serde(default)]
    pub recommendations: Vec<Recommendation>,
    #[serde(default)]
    pub global_top: Vec<Recommendation>,
    #[serde(default)]
    pub library_mix_artists: Vec<LibraryMixArtist>,
    #[serde(default)]
    pub release_radar_releases: Vec<ReleaseRadarRelease>,
    #[serde(default)]
    pub release_radar_size: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub matched_tags: Vec<String>,
    #[serde(default)]
    pub supporting_seeds: Vec<SupportingSeed>,
    #[serde(default)]
    pub seed_count: Option<i32>,
    #[serde(default)]
    pub score: Option<i32>,
    #[serde(default)]
    pub score_total: Option<i32>,
    #[serde(default)]
    pub score_similarity: Option<i32>,
    #[serde(default)]
    pub score_tag_affinity: Option<i32>,
    #[serde(default)]
    pub score_seed_coverage: Option<i32>,
    #[serde(default)]
    pub score_novelty: Option<i32>,
    #[serde(default)]
    pub score_popularity_penalty: Option<i32>,
    #[serde(default)]
    pub score_diversity_penalty: Option<i32>,
    #[serde(default)]
    pub score_freshness_boost: Option<f64>,
    #[serde(default)]
    pub score_aging_penalty: Option<f64>,
    #[serde(default)]
    pub source_artist: Option<String>,
    #[serde(default)]
    pub source_artists: Vec<String>,
    #[serde(default)]
    pub source_type: Option<String>,
    #[serde(default)]
    pub source_types: Vec<String>,
    #[serde(default)]
    pub source_mix: Vec<String>,
    #[serde(default)]
    pub reason_codes: Vec<String>,
    #[serde(default)]
    pub discovery_tier: Option<String>,
    #[serde(default)]
    pub discovery_depth: Option<i32>,
    #[serde(default)]
    pub best_match: Option<f64>,
    #[serde(default)]
    pub confidence: Option<i32>,
    #[serde(default)]
    pub navigate_to: Option<String>,
    #[serde(default)]
    pub recommendation_pool_state: Option<String>,
    #[serde(default)]
    pub recommendation_pool_rank: Option<i32>,
    #[serde(default)]
    pub first_discovered_at: Option<String>,
    #[serde(default)]
    pub discovered_at: Option<String>,
    #[serde(default)]
    pub last_recommended_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SupportingSeed {
    #[serde(default)]
    pub artist_name: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub weight: Option<f64>,
    #[serde(default)]
    pub profile_bucket: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistTrack {
    pub artist_name: Option<String>,
    pub track_name: Option<String>,
    pub album_name: Option<String>,
    pub artist_mbid: Option<String>,
    pub album_mbid: Option<String>,
    pub track_mbid: Option<String>,
    pub release_year: Option<i32>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPreview {
    pub preset_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub mix: Value,
    #[serde(default)]
    pub size: usize,
    #[serde(default)]
    pub deep_dive: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub related_artists: Vec<String>,
    #[serde(default)]
    pub recipe: Value,
    pub tracks: Vec<PlaylistTrack>,
    pub track_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStats {
    pub lastfm_calls: u64,
    pub musicbrainz_calls: u64,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse<T: Serialize> {
    pub ok: bool,
    pub result: T,
    pub stats: WorkerStats,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    pub ok: bool,
    pub error: String,
}

pub fn existing_key_set(keys: &[String]) -> HashSet<String> {
    keys.iter().map(|key| normalize_text(key)).collect()
}

pub fn normalize_text(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn normalize_mbid(value: Option<&str>) -> Option<String> {
    let normalized = normalize_text(value.unwrap_or(""));
    if normalized.len() == 36 && normalized.chars().filter(|c| *c == '-').count() == 4 {
        Some(normalized)
    } else {
        None
    }
}
