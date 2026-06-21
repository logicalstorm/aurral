use crate::net::lidarr::LidarrClient;
use crate::types::{LibraryMixArtist, PrepArtistInput};
use crate::util::concurrency::map_with_concurrency;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;

const ARTIST_CONCURRENCY: usize = 12;
const ALBUM_CONCURRENCY: usize = 8;

pub async fn build_library_mix_context(
    client: Arc<LidarrClient>,
    artists: Vec<PrepArtistInput>,
) -> Vec<LibraryMixArtist> {
    let entries = map_with_concurrency(artists, ARTIST_CONCURRENCY, move |artist| {
        let client = client.clone();
        async move { build_artist_mix_entry(client, artist).await }
    })
    .await;
    entries.into_iter().flatten().collect()
}

async fn build_artist_mix_entry(
    client: Arc<LidarrClient>,
    artist: PrepArtistInput,
) -> Option<LibraryMixArtist> {
    let artist_name = artist.artist_name.trim().to_string();
    if artist_name.is_empty() {
        return None;
    }
    let Some(artist_id) = artist
        .id
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Some(LibraryMixArtist {
            artist_name,
            artist_mbid: artist.artist_mbid,
            owned_titles: Vec::new(),
            owned_albums: Vec::new(),
        });
    };
    let albums = client
        .get_albums_for_artist(&artist_id)
        .await
        .unwrap_or_default();
    let owned_albums = collect_album_names(&albums);
    let owned_titles = collect_track_titles(client, &albums).await;
    Some(LibraryMixArtist {
        artist_name,
        artist_mbid: artist.artist_mbid,
        owned_titles: owned_titles.into_iter().collect(),
        owned_albums: owned_albums.into_iter().collect(),
    })
}

fn collect_album_names(albums: &[Value]) -> HashSet<String> {
    let mut names = HashSet::new();
    for album in albums {
        if let Some(title) = album
            .get("title")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            names.insert(title.to_lowercase());
        }
    }
    names
}

async fn collect_track_titles(client: Arc<LidarrClient>, albums: &[Value]) -> HashSet<String> {
    let album_ids: Vec<String> = albums
        .iter()
        .filter_map(|album| {
            album
                .get("id")
                .map(|value| value.to_string().trim_matches('"').to_string())
                .filter(|value| !value.is_empty())
        })
        .collect();
    let track_lists = map_with_concurrency(album_ids, ALBUM_CONCURRENCY, move |album_id| {
        let client = client.clone();
        async move {
            client
                .get_tracks_for_album(&album_id)
                .await
                .unwrap_or_default()
        }
    })
    .await;
    let mut titles = HashSet::new();
    for tracks in track_lists {
        for track in tracks {
            if let Some(title) = track
                .get("title")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                titles.insert(title.to_lowercase());
            }
        }
    }
    titles
}
