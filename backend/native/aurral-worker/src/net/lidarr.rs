use crate::types::LidarrConfig;
use reqwest::Client;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const DEFAULT_API_PATH: &str = "/api/v1";

pub struct LidarrClient {
    base_url: String,
    api_path: String,
    api_key: String,
    http: Client,
    semaphore: Arc<Semaphore>,
    calls: AtomicU64,
}

impl LidarrClient {
    pub fn new(config: &LidarrConfig, concurrency: usize) -> Result<Self, String> {
        let api_key = config.api_key.trim().to_string();
        if api_key.is_empty() {
            return Err("Lidarr API key not configured".to_string());
        }
        let mut builder = Client::builder().timeout(Duration::from_secs(30));
        if config.insecure {
            builder = builder.danger_accept_invalid_certs(true);
        }
        let http = builder.build().map_err(|error| error.to_string())?;
        let base_url = config.url.trim().trim_end_matches('/').to_string();
        let api_path = config
            .api_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(DEFAULT_API_PATH)
            .trim()
            .to_string();
        Ok(Self {
            base_url,
            api_path,
            api_key,
            http,
            semaphore: Arc::new(Semaphore::new(concurrency.max(1))),
            calls: AtomicU64::new(0),
        })
    }

    pub fn call_count(&self) -> u64 {
        self.calls.load(Ordering::Relaxed)
    }

    pub async fn get_artists(&self) -> Result<Vec<Value>, String> {
        let payload = self.request("/artist").await?;
        Ok(value_to_array(payload))
    }

    pub async fn get_albums(&self) -> Result<Vec<Value>, String> {
        let payload = self.request("/album").await?;
        Ok(value_to_array(payload))
    }

    pub async fn get_albums_for_artist(&self, artist_id: &str) -> Result<Vec<Value>, String> {
        let endpoint = format!("/album?artistId={}", urlencoding_encode(artist_id));
        let payload = self.request(&endpoint).await?;
        let artist_id_num = artist_id.parse::<i64>().ok();
        Ok(value_to_array(payload)
            .into_iter()
            .filter(|album| album_matches_artist(album, artist_id, artist_id_num))
            .collect())
    }

    pub async fn get_tracks_for_album(&self, album_id: &str) -> Result<Vec<Value>, String> {
        let endpoint = format!("/track?albumId={}", urlencoding_encode(album_id));
        let payload = self.request(&endpoint).await?;
        Ok(value_to_array(payload))
    }

    async fn request(&self, endpoint: &str) -> Result<Value, String> {
        let _permit = self
            .semaphore
            .acquire()
            .await
            .map_err(|error| error.to_string())?;
        let url = format!("{}{}{}", self.base_url, self.api_path, endpoint);
        let response = self
            .http
            .get(&url)
            .header("X-Api-Key", &self.api_key)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|error| error.to_string())?;
        self.calls.fetch_add(1, Ordering::Relaxed);
        if !response.status().is_success() {
            return Err(format!(
                "Lidarr request failed ({}): {}",
                response.status(),
                endpoint
            ));
        }
        response.json::<Value>().await.map_err(|error| error.to_string())
    }
}

fn value_to_array(value: Value) -> Vec<Value> {
    match value {
        Value::Array(items) => items,
        other => vec![other],
    }
}

fn album_matches_artist(album: &Value, artist_id: &str, artist_id_num: Option<i64>) -> bool {
    let Some(raw_id) = album.get("artistId") else {
        return false;
    };
    if let Some(num) = artist_id_num {
        if raw_id.as_i64() == Some(num) {
            return true;
        }
    }
    raw_id.to_string().trim_matches('"') == artist_id
}

fn urlencoding_encode(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => ch.to_string(),
            _ => format!("%{:02X}", ch as u8),
        })
        .collect()
}

pub fn normalize_percent_of_tracks(raw: Option<f64>) -> u32 {
    let Some(mut percent) = raw else {
        return 0;
    };
    if percent > 1.0 && percent <= 100.0 {
        percent = percent.round();
    } else if percent <= 1.0 && percent >= 0.0 {
        percent = (percent * 100.0).round();
    } else if percent > 100.0 {
        percent = (percent / 10.0).round().min(100.0);
    }
    percent.max(0.0) as u32
}

pub fn album_statistics(album: &Value) -> (u32, u64) {
    let stats = album.get("statistics");
    let percent = normalize_percent_of_tracks(
        stats
            .and_then(|value| value.get("percentOfTracks"))
            .and_then(|value| value.as_f64()),
    );
    let size = stats
        .and_then(|value| value.get("sizeOnDisk"))
        .and_then(|value| value.as_u64())
        .or_else(|| {
            stats
                .and_then(|value| value.get("sizeOnDisk"))
                .and_then(|value| value.as_i64())
                .map(|value| value.max(0) as u64)
        })
        .unwrap_or(0);
    (percent, size)
}
