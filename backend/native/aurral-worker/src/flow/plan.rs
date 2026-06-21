use crate::flow::candidate::{select_candidates, sort_candidates, FlowCandidate};
use crate::flow::harvest::{harvest_flow_sources, FlowHarvestContext, HarvestedSources};
use crate::flow::mix::FlowMix;
use crate::flow::targets::build_source_targets;
use crate::net::lastfm::LastfmClient;
use crate::types::{LibraryMixArtist, PlaylistTrack, Recommendation};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub struct FlowConfig {
    pub size: usize,
    pub mix: FlowMix,
    pub deep_dive: bool,
    pub tags: Vec<String>,
    pub related_artists: Vec<String>,
}

pub struct FlowPlan {
    pub primary_tracks: Vec<PlaylistTrack>,
    pub diagnostics_targets: HashMap<String, usize>,
}

fn assemble_flow_plan(
    harvested: HarvestedSources,
    exclude_artist_keys: &HashSet<String>,
    target_size: usize,
    source_targets: &HashMap<&str, usize>,
) -> FlowPlan {
    let ordered_sources = ["focus", "mix", "discover", "trending"];
    let mut candidate_map: HashMap<&str, Vec<FlowCandidate>> = HashMap::from([
        ("discover", harvested.discover),
        ("mix", harvested.mix),
        ("trending", harvested.trending),
        ("focus", harvested.focus),
    ]);
    for candidates in candidate_map.values_mut() {
        sort_candidates(candidates);
    }
    let mut used_artist_keys = exclude_artist_keys.clone();
    let mut primary_tracks = Vec::new();
    for source in ordered_sources {
        let count = source_targets.get(source).copied().unwrap_or(0);
        let candidates = candidate_map.get(source).cloned().unwrap_or_default();
        primary_tracks.extend(select_candidates(
            &candidates,
            count,
            &mut used_artist_keys,
        ));
    }
    let remaining = target_size.saturating_sub(primary_tracks.len());
    if remaining > 0 {
        let mut pooled = Vec::new();
        for source in ordered_sources {
            if let Some(candidates) = candidate_map.get(source) {
                pooled.extend(candidates.iter().cloned());
            }
        }
        sort_candidates(&mut pooled);
        primary_tracks.extend(select_candidates(&pooled, remaining, &mut used_artist_keys));
    }
    let diagnostics_targets = source_targets
        .iter()
        .map(|(key, value)| (key.to_string(), *value))
        .collect();
    FlowPlan {
        primary_tracks: primary_tracks.into_iter().take(target_size).collect(),
        diagnostics_targets,
    }
}

pub async fn build_flow_run_plan(
    lastfm: &LastfmClient,
    flow: &FlowConfig,
    recommendations: &[Recommendation],
    global_top: &[Recommendation],
    library_mix_artists: &[LibraryMixArtist],
    library_artist_keys: &HashSet<String>,
    exclude_artist_keys: &HashSet<String>,
) -> FlowPlan {
    let target_size = flow.size.max(1);
    let mix = if flow.mix.discover + flow.mix.mix + flow.mix.trending + flow.mix.focus > 0 {
        flow.mix
    } else {
        FlowMix::default_blend()
    };
    let source_targets = build_source_targets(target_size, mix);
    let ctx = FlowHarvestContext {
        recommendations,
        global_top,
        library_mix_artists,
        library_artist_keys,
        exclude_artist_keys: exclude_artist_keys.clone(),
    };
    let harvested = harvest_flow_sources(
        lastfm,
        &ctx,
        &flow.tags,
        &flow.related_artists,
        flow.deep_dive,
        &source_targets,
    )
    .await;
    assemble_flow_plan(harvested, exclude_artist_keys, target_size, &source_targets)
}

pub fn mix_from_preset(value: &Value) -> FlowMix {
    if value.is_object() {
        FlowMix::from_value(value)
    } else {
        FlowMix::default_blend()
    }
}
