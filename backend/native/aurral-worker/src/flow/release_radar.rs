use crate::flow::track::build_track_entry;
use crate::net::lastfm::LastfmClient;
use crate::net::metadata::{pick_top_metadata_track, MetadataClient};
use crate::types::{PlaylistTrack, ReleaseRadarRelease};
use std::collections::HashSet;

pub async fn build_release_radar_tracks(
    metadata: &MetadataClient,
    lastfm: &LastfmClient,
    releases: &[ReleaseRadarRelease],
    limit: usize,
) -> Vec<PlaylistTrack> {
    if limit == 0 || releases.is_empty() {
        return Vec::new();
    }
    let mut tracks = Vec::new();
    let mut seen_albums = HashSet::new();
    for release in releases {
        if tracks.len() >= limit {
            break;
        }
        let album_key = release
            .album_mbid
            .clone()
            .unwrap_or_default()
            .trim()
            .to_lowercase();
        if !album_key.is_empty() && seen_albums.contains(&album_key) {
            continue;
        }
        let Some(track) = pick_track_from_release(metadata, lastfm, release).await else {
            continue;
        };
        if !album_key.is_empty() {
            seen_albums.insert(album_key);
        }
        tracks.push(track);
    }
    tracks
}

async fn pick_track_from_release(
    metadata: &MetadataClient,
    lastfm: &LastfmClient,
    release: &ReleaseRadarRelease,
) -> Option<PlaylistTrack> {
    let artist_name = release.artist_name.trim();
    let album_name = release.album_name.trim();
    if artist_name.is_empty() || album_name.is_empty() {
        return None;
    }

    if let Some(album_mbid) = release
        .album_mbid
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let metadata_tracks = metadata.get_album_tracks(album_mbid).await;
        if let Some(pick) = pick_top_metadata_track(&metadata_tracks) {
            return build_track_entry(
                artist_name,
                &pick.track_name,
                Some(album_name.to_string()),
                release.artist_mbid.clone(),
                release.album_mbid.clone(),
                pick.track_mbid.clone(),
                release.release_year.clone(),
                "New release from an artist in your library",
            );
        }
    }

    let album_tracks = lastfm
        .album_tracks_from_info(artist_name, album_name)
        .await;
    if let Some((track_name, _)) = album_tracks
        .into_iter()
        .min_by_key(|(_, rank)| rank.unwrap_or(i64::MAX))
    {
        return build_track_entry(
            artist_name,
            &track_name,
            Some(album_name.to_string()),
            release.artist_mbid.clone(),
            release.album_mbid.clone(),
            None,
            release.release_year.clone(),
            "New release from an artist in your library",
        );
    }

    let track_list = lastfm.artist_top_track_values(artist_name, 25).await;
    let album_key = release_title_key(album_name);
    for track in track_list {
        let candidate_album = track
            .pointer("/album/title")
            .or_else(|| track.get("album"))
            .and_then(|value| {
                if value.is_string() {
                    value.as_str().map(|value| value.to_string())
                } else {
                    value
                        .get("title")
                        .or_else(|| value.get("#text"))
                        .and_then(|entry| entry.as_str())
                        .map(|value| value.to_string())
                }
            })
            .unwrap_or_default();
        if release_title_key(&candidate_album) != album_key {
            continue;
        }
        let track_name = track
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if track_name.is_empty() {
            continue;
        }
        return build_track_entry(
            artist_name,
            &track_name,
            Some(album_name.to_string()),
            release.artist_mbid.clone(),
            release.album_mbid.clone(),
            None,
            release.release_year.clone(),
            "New release from an artist in your library",
        );
    }
    None
}

pub fn release_title_key(value: &str) -> String {
    value
        .to_lowercase()
        .replace('’', "'")
        .replace('‘', "'")
        .replace('`', "'")
        .replace('&', " and ")
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || ch.is_whitespace() {
                ch
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::release_title_key;

    #[test]
    fn release_title_key_normalizes_punctuation() {
        assert_eq!(
            release_title_key("Teen of Denial (Joe's Story)"),
            "teen of denial joe s story"
        );
    }
}
