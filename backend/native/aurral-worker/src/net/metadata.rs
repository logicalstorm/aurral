use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::time::Duration;
use tokio::sync::Mutex;

const DEFAULT_METADATA_BASE_URL: &str = "https://lidarrapi.brainzmash.cc";

#[derive(Debug, Clone)]
pub struct MetadataAlbumTrack {
    pub track_name: String,
    pub track_mbid: Option<String>,
    pub rank: i64,
}

pub struct MetadataClient {
    base_url: String,
    http: Client,
    cache: Mutex<HashMap<String, Option<String>>>,
    album_tracks_cache: Mutex<HashMap<String, Option<Vec<MetadataAlbumTrack>>>>,
    pub calls: Mutex<u64>,
}

impl MetadataClient {
    pub fn new() -> Self {
        let base_url = env::var("AURRAL_METADATA_BASE_URL")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_METADATA_BASE_URL.to_string());
        Self {
            base_url,
            http: Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .expect("http client"),
            cache: Mutex::new(HashMap::new()),
            album_tracks_cache: Mutex::new(HashMap::new()),
            calls: Mutex::new(0),
        }
    }

    pub async fn resolve_artist_mbid(&self, artist_name: &str) -> Option<String> {
        let key = artist_name.trim().to_lowercase();
        if key.is_empty() {
            return None;
        }
        if let Some(cached) = self.cache.lock().await.get(&key).cloned() {
            return cached;
        }

        let url = format!("{}/search/artist", self.base_url);
        let response = self
            .http
            .get(url)
            .query(&[("query", artist_name), ("limit", "10")])
            .header("User-Agent", "Aurral/1.0")
            .send()
            .await
            .ok()?;
        *self.calls.lock().await += 1;
        if !response.status().is_success() {
            self.cache.lock().await.insert(key, None);
            return None;
        }
        let data: Value = response.json().await.ok()?;
        let mbid = data
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item.get("id"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .or_else(|| {
                data.pointer("/items/0/id")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            });
        self.cache.lock().await.insert(key, mbid.clone());
        mbid
    }

    pub async fn get_artist_image_url(&self, mbid: &str) -> Option<String> {
        let key = format!("image:{}", mbid.trim().to_lowercase());
        if let Some(cached) = self.cache.lock().await.get(&key).cloned() {
            return cached;
        }

        let url = format!("{}/artist/{}", self.base_url, mbid.trim());
        let response = self
            .http
            .get(url)
            .header("User-Agent", "Aurral/1.0")
            .send()
            .await
            .ok()?;
        *self.calls.lock().await += 1;
        if !response.status().is_success() {
            self.cache.lock().await.insert(key, None);
            return None;
        }
        let data: Value = response.json().await.ok()?;
        let image_url = select_best_artist_image_url(&data);
        self.cache.lock().await.insert(key, image_url.clone());
        image_url
    }

    pub async fn get_album_tracks(&self, album_mbid: &str) -> Vec<MetadataAlbumTrack> {
        let safe_mbid = album_mbid.trim();
        if safe_mbid.is_empty() {
            return Vec::new();
        }
        let key = safe_mbid.to_lowercase();
        if let Some(cached) = self.album_tracks_cache.lock().await.get(&key).cloned() {
            return cached.unwrap_or_default();
        }

        let url = format!("{}/album/{}", self.base_url, safe_mbid);
        let response = match self
            .http
            .get(url)
            .header("User-Agent", "Aurral/1.0")
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => {
                self.album_tracks_cache.lock().await.insert(key, None);
                return Vec::new();
            }
        };
        *self.calls.lock().await += 1;
        if !response.status().is_success() {
            self.album_tracks_cache.lock().await.insert(key, None);
            return Vec::new();
        }
        let data: Value = match response.json().await {
            Ok(data) => data,
            Err(_) => {
                self.album_tracks_cache.lock().await.insert(key, None);
                return Vec::new();
            }
        };
        let tracks = selected_release_tracks(&data)
            .into_iter()
            .filter_map(|track| parse_metadata_album_track(&track))
            .collect::<Vec<_>>();
        self.album_tracks_cache
            .lock()
            .await
            .insert(key, Some(tracks.clone()));
        tracks
    }
}

fn selected_release_tracks(album: &Value) -> Vec<Value> {
    let releases = album
        .get("releases")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let selected = releases
        .iter()
        .find(|release| {
            release
                .get("status")
                .and_then(|value| value.as_str())
                .map(|value| value.eq_ignore_ascii_case("official"))
                .unwrap_or(false)
                && release
                    .get("tracks")
                    .and_then(|value| value.as_array())
                    .map(|tracks| !tracks.is_empty())
                    .unwrap_or(false)
        })
        .or_else(|| {
            releases.iter().find(|release| {
                release
                    .get("tracks")
                    .and_then(|value| value.as_array())
                    .map(|tracks| !tracks.is_empty())
                    .unwrap_or(false)
            })
        })
        .or_else(|| releases.first());
    selected
        .and_then(|release| release.get("tracks"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
}

fn parse_metadata_album_track(track: &Value) -> Option<MetadataAlbumTrack> {
    let track_name = track
        .get("title")
        .or_else(|| track.get("trackname"))
        .or_else(|| track.get("name"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())?;
    let track_mbid = track
        .get("recordingId")
        .or_else(|| track.get("recordingid"))
        .or_else(|| track.get("id"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let rank = track
        .get("trackNumber")
        .or_else(|| track.get("tracknumber"))
        .or_else(|| track.get("trackposition"))
        .or_else(|| track.get("track_position"))
        .and_then(|value| value.as_i64().or_else(|| value.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(i64::MAX);
    Some(MetadataAlbumTrack {
        track_name,
        track_mbid,
        rank,
    })
}

pub fn pick_top_metadata_track(tracks: &[MetadataAlbumTrack]) -> Option<&MetadataAlbumTrack> {
    tracks.iter().min_by_key(|track| track.rank)
}

fn artist_image_kind_rank(kind: &str) -> i32 {
    match kind.trim().to_lowercase().as_str() {
        "poster" => 0,
        "artist" => 1,
        "thumb" => 2,
        "fanart" => 3,
        "background" => 4,
        "banner" => 8,
        "logo" => 9,
        "clearlogo" => 9,
        _ => 5,
    }
}

fn select_best_artist_image_url(data: &Value) -> Option<String> {
    let images = data.get("images")?.as_array()?;
    let mut ranked: Vec<(i32, usize, String)> = images
        .iter()
        .enumerate()
        .filter_map(|(index, image)| {
            let url = image
                .get("url")
                .or_else(|| image.get("Url"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())?;
            let kind = image
                .get("kind")
                .or_else(|| image.get("CoverType"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            Some((artist_image_kind_rank(kind), index, url))
        })
        .collect();
    ranked.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    ranked.first().map(|entry| entry.2.clone())
}
