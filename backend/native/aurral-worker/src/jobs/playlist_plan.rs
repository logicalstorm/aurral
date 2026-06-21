use crate::flow::{build_flow_run_plan, build_release_radar_tracks, mix_from_preset, FlowConfig, FlowMix};
use crate::net::lastfm::LastfmClient;
use crate::net::metadata::MetadataClient;
use crate::types::{
    existing_key_set, PlaylistPlanJob, PlaylistPreview, PlaylistPreset, PlaylistTrack,
};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::env;
use std::time::Instant;

use serde::Serialize;

pub struct PlaylistPlanResult {
    pub playlists: Vec<PlaylistPreview>,
    pub stats: crate::types::WorkerStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistPlanPayload {
    pub playlists: Vec<PlaylistPreview>,
}

impl PlaylistPlanResult {
    pub fn to_payload(&self) -> PlaylistPlanPayload {
        PlaylistPlanPayload {
            playlists: self.playlists.clone(),
        }
    }
}

fn preset_type_for(preset: &PlaylistPreset) -> &'static str {
    if preset.id == "release-radar" {
        "release_radar"
    } else if preset.deep_dive.unwrap_or(false) || !preset.tags.is_empty() || !preset.related_artists.is_empty() {
        "focus"
    } else {
        "flow"
    }
}

fn build_playlist_preview(
    preset: &PlaylistPreset,
    tracks: Vec<PlaylistTrack>,
    recipe: Value,
) -> PlaylistPreview {
    let size = preset.size.unwrap_or(30).max(1);
    let mix = preset
        .mix
        .clone()
        .unwrap_or_else(|| json!({ "discover": 34, "mix": 33, "trending": 33, "focus": 0 }));
    PlaylistPreview {
        preset_id: preset.id.clone(),
        name: preset.name.clone(),
        description: preset.description.clone(),
        r#type: Some(preset_type_for(preset).to_string()),
        mix,
        size,
        deep_dive: preset.deep_dive.unwrap_or(false),
        tags: preset.tags.clone(),
        related_artists: preset.related_artists.clone(),
        recipe,
        track_count: tracks.len(),
        tracks,
    }
}

pub async fn run(job: PlaylistPlanJob) -> Result<PlaylistPlanResult, String> {
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
    let library_artist_keys: HashSet<String> = job
        .library_mix_artists
        .iter()
        .map(|artist| crate::types::normalize_text(&artist.artist_name))
        .filter(|key| !key.is_empty())
        .collect();
    let mut playlists = Vec::new();

    for preset in &job.presets {
        if preset.id == "release-radar" {
            continue;
        }
        let size = preset.size.unwrap_or(30).max(1);
        let mix_value = preset.mix.clone().unwrap_or_else(|| {
            if preset.tags.is_empty() && preset.related_artists.is_empty() {
                json!({ "discover": 34, "mix": 33, "trending": 33, "focus": 0 })
            } else {
                json!({ "discover": 0, "mix": 0, "trending": 0, "focus": 100 })
            }
        });
        let flow = FlowConfig {
            size,
            mix: if preset.tags.is_empty() && preset.related_artists.is_empty() {
                mix_from_preset(&mix_value)
            } else {
                FlowMix {
                    discover: 0,
                    mix: 0,
                    trending: 0,
                    focus: 100,
                }
            },
            deep_dive: preset.deep_dive.unwrap_or(false),
            tags: preset.tags.clone(),
            related_artists: preset.related_artists.clone(),
        };
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
        if plan.primary_tracks.is_empty() {
            continue;
        }
        let recipe = json!({
            "discover": plan.diagnostics_targets.get("discover").copied().unwrap_or(0),
            "mix": plan.diagnostics_targets.get("mix").copied().unwrap_or(0),
            "trending": plan.diagnostics_targets.get("trending").copied().unwrap_or(0),
            "focus": plan.diagnostics_targets.get("focus").copied().unwrap_or(0),
        });
        playlists.push(build_playlist_preview(
            preset,
            plan.primary_tracks,
            recipe,
        ));
    }

    let release_radar_size = job.release_radar_size.unwrap_or(30).max(1);
    if !job.release_radar_releases.is_empty() {
        let tracks = build_release_radar_tracks(
            &metadata,
            &lastfm,
            &job.release_radar_releases,
            release_radar_size,
        )
        .await;
        if !tracks.is_empty() {
            let track_count = tracks.len();
            let preset = PlaylistPreset {
                id: "release-radar".to_string(),
                name: "Release Radar".to_string(),
                description: Some(
                    "Up to one track from each recent album missing in your library".to_string(),
                ),
                size: Some(release_radar_size),
                tags: Vec::new(),
                related_artists: Vec::new(),
                mix: Some(json!({ "discover": 100, "mix": 0, "trending": 0, "focus": 0 })),
                deep_dive: Some(false),
            };
            playlists.push(build_playlist_preview(
                &preset,
                tracks,
                json!({ "releaseRadar": track_count }),
            ));
        }
    }

    let stats = crate::types::WorkerStats {
        lastfm_calls: *lastfm.calls.lock().await,
        musicbrainz_calls: *metadata.calls.lock().await,
        duration_ms: started.elapsed().as_millis() as u64,
    };

    Ok(PlaylistPlanResult { playlists, stats })
}
