use crate::flow::{build_flow_run_plan, build_release_radar_tracks, mix_from_preset, FlowConfig};
use crate::net::lastfm::LastfmClient;
use crate::net::metadata::MetadataClient;
use crate::types::{
    existing_key_set, FlowPlanJob, PlaylistTrack, WorkerStats,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::env;
use std::time::Instant;

pub struct FlowPlanResult {
    pub primary_tracks: Vec<PlaylistTrack>,
    pub reserve_tracks: Vec<PlaylistTrack>,
    pub diagnostics: Value,
    pub stats: WorkerStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowPlanPayload {
    primary_tracks: Vec<PlaylistTrack>,
    reserve_tracks: Vec<PlaylistTrack>,
    diagnostics: Value,
}

pub async fn run(job: FlowPlanJob) -> Result<FlowPlanResult, String> {
    let api_key = env::var("LASTFM_API_KEY")
        .or_else(|_| env::var("AURRAL_LASTFM_API_KEY"))
        .map_err(|_| "LASTFM_API_KEY is not configured".to_string())?;
    let concurrency = env::var("AURRAL_LASTFM_CONCURRENCY")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(12)
        .clamp(1, 16);
    let started = Instant::now();
    let lastfm = LastfmClient::new(api_key, concurrency);
    let metadata = MetadataClient::new();
    let existing_keys = existing_key_set(&job.existing_artist_keys);
    let target_size = job.flow.size.unwrap_or(30).max(1);

    if job.discover_preset_id.as_deref() == Some("release-radar") {
        let release_radar_size = job.release_radar_size.unwrap_or(target_size).max(1);
        let primary_tracks = if job.release_radar_releases.is_empty() {
            Vec::new()
        } else {
            build_release_radar_tracks(
                &metadata,
                &lastfm,
                &job.release_radar_releases,
                release_radar_size,
            )
            .await
        };
        let lastfm_calls = *lastfm.calls.lock().await;
        let metadata_calls = *metadata.calls.lock().await;
        return Ok(FlowPlanResult {
            primary_tracks: primary_tracks.clone(),
            reserve_tracks: Vec::new(),
            diagnostics: json!({
                "targets": { "releaseRadar": release_radar_size, "maxSize": release_radar_size },
                "achieved": { "primary": primary_tracks.len(), "reserve": 0 },
            }),
            stats: WorkerStats {
                lastfm_calls,
                musicbrainz_calls: metadata_calls,
                duration_ms: started.elapsed().as_millis() as u64,
            },
        });
    }

    let mix_value = job.flow.mix.clone().unwrap_or_else(|| {
        json!({ "discover": 34, "mix": 33, "trending": 33, "focus": 0 })
    });
    let flow = FlowConfig {
        size: target_size,
        mix: {
            let has_focus = !job.flow.tags.is_empty() || !job.flow.related_artists.is_empty();
            let configured_mix = mix_from_preset(&mix_value);
            if has_focus && configured_mix.focus == 0 {
                crate::flow::FlowMix {
                    discover: 0,
                    mix: 0,
                    trending: 0,
                    focus: 100,
                }
            } else {
                configured_mix
            }
        },
        deep_dive: job.flow.deep_dive.unwrap_or(false),
        tags: job.flow.tags.clone(),
        related_artists: job.flow.related_artists.clone(),
    };
    let library_artist_keys: HashSet<String> = job
        .library_mix_artists
        .iter()
        .map(|artist| crate::types::normalize_text(&artist.artist_name))
        .filter(|key| !key.is_empty())
        .collect();
    let plan = build_flow_run_plan(
        &lastfm,
        &flow,
        &job.recommendations,
        &job.global_top,
        &job.library_mix_artists,
        &library_artist_keys,
        &existing_keys,
    )
    .await;
    let achieved = json!({
        "primary": plan.primary_tracks.len(),
        "reserve": 0,
    });
    let targets = plan
        .diagnostics_targets
        .iter()
        .map(|(key, value)| (key.clone(), Value::from(*value)))
        .collect::<serde_json::Map<_, _>>();
    let lastfm_calls = *lastfm.calls.lock().await;
    Ok(FlowPlanResult {
        primary_tracks: plan.primary_tracks.clone(),
        reserve_tracks: Vec::new(),
        diagnostics: json!({
            "targets": Value::Object(targets),
            "achieved": achieved,
        }),
        stats: WorkerStats {
            lastfm_calls,
            musicbrainz_calls: 0,
            duration_ms: started.elapsed().as_millis() as u64,
        },
    })
}

impl FlowPlanResult {
    pub fn to_payload(&self) -> FlowPlanPayload {
        FlowPlanPayload {
            primary_tracks: self.primary_tracks.clone(),
            reserve_tracks: self.reserve_tracks.clone(),
            diagnostics: self.diagnostics.clone(),
        }
    }
}
