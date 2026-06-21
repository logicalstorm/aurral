use crate::flow::candidate::{candidate_track_artist_key, FlowCandidate};
use crate::flow::focus::harvest_focus_candidates;
use crate::flow::targets::harvest_limit_for;
use crate::flow::track::{
    artist_key, build_track_entry, deep_dive_ranges, pick_track_from_ranges, shuffle,
    track_from_value, TrackRange,
};
use crate::net::lastfm::LastfmClient;
use crate::types::{LibraryMixArtist, PlaylistTrack, Recommendation};
use serde_json::Value;
use std::collections::HashSet;

pub struct FlowHarvestContext<'a> {
    pub recommendations: &'a [Recommendation],
    pub global_top: &'a [Recommendation],
    pub library_mix_artists: &'a [LibraryMixArtist],
    pub library_artist_keys: &'a HashSet<String>,
    pub exclude_artist_keys: HashSet<String>,
}

fn recommendation_name(rec: &Recommendation) -> String {
    rec.name.clone().unwrap_or_default().trim().to_string()
}

fn recommendation_mbid(rec: &Recommendation) -> Option<String> {
    rec.id.clone().filter(|s| !s.trim().is_empty())
}

fn artist_keys_from_recommendation(rec: &Recommendation) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(id) = rec.id.as_ref() {
        let key = artist_key(id);
        if !key.is_empty() {
            keys.push(key);
        }
    }
    let name = recommendation_name(rec);
    if !name.is_empty() {
        keys.push(artist_key(&name));
    }
    keys
}

fn filter_recommendations<'a>(
    items: &'a [Recommendation],
    exclude: &HashSet<String>,
) -> Vec<&'a Recommendation> {
    items
        .iter()
        .filter(|rec| {
            !artist_keys_from_recommendation(rec)
                .iter()
                .any(|key| exclude.contains(key))
        })
        .collect()
}

pub async fn harvest_top_tracks_from_artists(
    lastfm: &LastfmClient,
    artists: &[Recommendation],
    limit: usize,
    deep_dive: bool,
    exclude: &HashSet<String>,
    reason: &str,
) -> Vec<PlaylistTrack> {
    if limit == 0 || artists.is_empty() {
        return Vec::new();
    }
    let ranges = deep_dive_ranges(deep_dive);
    let mut entries: Vec<(&Recommendation, String)> = artists
        .iter()
        .filter_map(|artist| {
            let name = recommendation_name(artist);
            if name.is_empty() {
                return None;
            }
            let keys = artist_keys_from_recommendation(artist);
            if keys.iter().any(|key| exclude.contains(key)) {
                return None;
            }
            Some((artist, name))
        })
        .collect();
    shuffle(&mut entries);
    let mut tracks = Vec::new();
    let mut seen_artists = HashSet::new();
    for (artist, artist_name) in entries {
        if tracks.len() >= limit {
            break;
        }
        let key = artist_key(&artist_name);
        if key.is_empty() || seen_artists.contains(&key) {
            continue;
        }
        let track_list = lastfm.artist_top_track_values(&artist_name, 25).await;
        if track_list.is_empty() {
            continue;
        }
        let pick = pick_track_from_ranges(&track_list, &ranges);
        let Some(pick) = pick else { continue };
        let Some(track) = track_from_value(
            pick,
            &artist_name,
            recommendation_mbid(artist),
            reason,
        ) else {
            continue;
        };
        seen_artists.insert(key);
        tracks.push(track);
    }
    tracks
}

async fn pick_mix_track(
    lastfm: &LastfmClient,
    artist_name: &str,
    artist_mbid: Option<String>,
    owned_titles: &HashSet<String>,
    owned_albums: &HashSet<String>,
    ranges: &[TrackRange],
    reason: &str,
) -> Option<PlaylistTrack> {
    let track_list = lastfm.artist_top_track_values(artist_name, 25).await;
    if track_list.is_empty() {
        return None;
    }
    for range in ranges {
        let start = range.start.min(track_list.len().saturating_sub(1));
        let end = range.end.min(track_list.len().saturating_sub(1));
        if start > end {
            continue;
        }
        let mut candidates: Vec<&Value> = track_list[start..=end]
            .iter()
            .filter(|track| {
                let name = track
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_lowercase();
                !name.is_empty() && !owned_titles.contains(&name)
            })
            .collect();
        shuffle(&mut candidates);
        for candidate in candidates {
            let track_name = candidate
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if track_name.is_empty() {
                continue;
            }
            let album_title = candidate
                .pointer("/album/title")
                .or_else(|| candidate.get("album"))
                .and_then(|v| {
                    if v.is_string() {
                        v.as_str().map(|s| s.to_string())
                    } else {
                        v.get("title")
                            .or_else(|| v.get("#text"))
                            .and_then(|n| n.as_str())
                            .map(|s| s.to_string())
                    }
                })
                .unwrap_or_default()
                .trim()
                .to_lowercase();
            if !album_title.is_empty() && !owned_albums.contains(&album_title) {
                return build_track_entry(
                    artist_name,
                    &track_name,
                    Some(album_title),
                    artist_mbid.clone(),
                    None,
                    None,
                    None,
                    reason,
                );
            }
            if let Some(album) = lastfm.track_album_title(artist_name, &track_name).await {
                let album_key = album.trim().to_lowercase();
                if !album_key.is_empty() && !owned_albums.contains(&album_key) {
                    return build_track_entry(
                        artist_name,
                        &track_name,
                        Some(album),
                        artist_mbid.clone(),
                        None,
                        None,
                        None,
                        reason,
                    );
                }
            }
        }
    }
    None
}

pub async fn harvest_mix_tracks(
    lastfm: &LastfmClient,
    artists: &[LibraryMixArtist],
    limit: usize,
    deep_dive: bool,
    reason: &str,
) -> Vec<PlaylistTrack> {
    if limit == 0 || artists.is_empty() {
        return Vec::new();
    }
    let ranges = deep_dive_ranges(deep_dive);
    let mut candidates = artists.to_vec();
    shuffle(&mut candidates);
    let max_artists = 45.min(candidates.len().max(limit.saturating_mul(2).max(30)));
    candidates.truncate(max_artists);
    let mut tracks = Vec::new();
    let mut seen = HashSet::new();
    for artist in candidates {
        if tracks.len() >= limit {
            break;
        }
        let artist_name = artist.artist_name.trim().to_string();
        if artist_name.is_empty() {
            continue;
        }
        let key = artist_key(&artist_name);
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        let owned_titles: HashSet<String> = artist
            .owned_titles
            .iter()
            .map(|title| title.trim().to_lowercase())
            .filter(|title| !title.is_empty())
            .collect();
        let owned_albums: HashSet<String> = artist
            .owned_albums
            .iter()
            .map(|album| album.trim().to_lowercase())
            .filter(|album| !album.is_empty())
            .collect();
        let Some(track) = pick_mix_track(
            lastfm,
            &artist_name,
            artist.artist_mbid.clone(),
            &owned_titles,
            &owned_albums,
            &ranges,
            reason,
        )
        .await
        else {
            continue;
        };
        seen.insert(key);
        tracks.push(track);
    }
    tracks
}

pub struct HarvestedSources {
    pub discover: Vec<FlowCandidate>,
    pub mix: Vec<FlowCandidate>,
    pub trending: Vec<FlowCandidate>,
    pub focus: Vec<FlowCandidate>,
}

pub async fn harvest_flow_sources(
    lastfm: &LastfmClient,
    ctx: &FlowHarvestContext<'_>,
    tags: &[String],
    related_artists: &[String],
    deep_dive: bool,
    harvest_targets: &std::collections::HashMap<&str, usize>,
) -> HarvestedSources {
    let mut non_library_exclude = ctx.exclude_artist_keys.clone();
    for key in ctx.library_artist_keys {
        non_library_exclude.insert(key.clone());
    }
    let discover_limit = harvest_targets.get("discover").copied().unwrap_or(0);
    let mix_limit = harvest_targets.get("mix").copied().unwrap_or(0);
    let trending_limit = harvest_targets.get("trending").copied().unwrap_or(0);
    let focus_limit = harvest_targets.get("focus").copied().unwrap_or(0);

    let discover_recs = filter_recommendations(ctx.recommendations, &non_library_exclude);
    let trending_recs = filter_recommendations(ctx.global_top, &non_library_exclude);

    let discover_tracks = if discover_limit > 0 {
        harvest_top_tracks_from_artists(
            lastfm,
            &discover_recs
                .into_iter()
                .cloned()
                .collect::<Vec<_>>(),
            harvest_limit_for(discover_limit),
            deep_dive,
            &non_library_exclude,
            "From discovery recommendations",
        )
        .await
    } else {
        Vec::new()
    };

    let mix_tracks = if mix_limit > 0 {
        harvest_mix_tracks(
            lastfm,
            ctx.library_mix_artists,
            harvest_limit_for(mix_limit),
            deep_dive,
            "From your library mix",
        )
        .await
    } else {
        Vec::new()
    };

    let trending_tracks = if trending_limit > 0 {
        harvest_top_tracks_from_artists(
            lastfm,
            &trending_recs
                .into_iter()
                .cloned()
                .collect::<Vec<_>>(),
            harvest_limit_for(trending_limit),
            deep_dive,
            &non_library_exclude,
            "From trending artists",
        )
        .await
    } else {
        Vec::new()
    };

    let focus_candidates = if focus_limit > 0 {
        harvest_focus_candidates(
            lastfm,
            tags,
            related_artists,
            harvest_limit_for(focus_limit),
            deep_dive,
            &non_library_exclude,
        )
        .await
    } else {
        Vec::new()
    };

    let discover = discover_tracks
        .into_iter()
        .enumerate()
        .filter_map(|(index, track)| {
            let key = candidate_track_artist_key(&track);
            if key.is_empty() || non_library_exclude.contains(&key) {
                return None;
            }
            FlowCandidate::from_track(track, "discover", index)
        })
        .collect::<Vec<_>>();
    let mix = mix_tracks
        .into_iter()
        .enumerate()
        .filter_map(|(index, track)| {
            let key = candidate_track_artist_key(&track);
            if key.is_empty() || ctx.exclude_artist_keys.contains(&key) {
                return None;
            }
            FlowCandidate::from_track(track, "mix", index)
        })
        .collect::<Vec<_>>();
    let trending = trending_tracks
        .into_iter()
        .enumerate()
        .filter_map(|(index, track)| {
            let key = candidate_track_artist_key(&track);
            if key.is_empty() || non_library_exclude.contains(&key) {
                return None;
            }
            FlowCandidate::from_track(track, "trending", index)
        })
        .collect::<Vec<_>>();

    HarvestedSources {
        discover,
        mix,
        trending,
        focus: focus_candidates,
    }
}
