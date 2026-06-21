use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::{sleep, Instant};

const LASTFM_API: &str = "https://ws.audioscrobbler.com/2.0/";

pub struct LastfmHealth {
    pub success: u64,
    pub failure: u64,
}

impl LastfmHealth {
    pub fn failure_ratio(&self) -> f64 {
        let total = self.success + self.failure;
        if total == 0 {
            0.0
        } else {
            self.failure as f64 / total as f64
        }
    }

    pub fn record(&mut self, payload: &Option<Value>) {
        if payload
            .as_ref()
            .and_then(|value| value.get("error"))
            .is_some()
        {
            self.failure += 1;
        } else if payload.is_some() {
            self.success += 1;
        } else {
            self.failure += 1;
        }
    }
}

struct RateSchedule {
    spacing: Duration,
    next_slot: tokio::sync::Mutex<Instant>,
}

impl RateSchedule {
    fn new(spacing: Duration) -> Self {
        Self {
            spacing,
            next_slot: tokio::sync::Mutex::new(Instant::now()),
        }
    }

    async fn acquire(&self) {
        let wait = {
            let mut next = self.next_slot.lock().await;
            let now = Instant::now();
            let slot = if now < *next { *next } else { now };
            *next = slot + self.spacing;
            if slot > now { Some(slot - now) } else { None }
        };
        if let Some(duration) = wait {
            sleep(duration).await;
        }
    }
}

fn tag_cache_key(artist: &str, mbid: Option<&str>) -> String {
    if let Some(mbid) = mbid {
        let trimmed = mbid.trim();
        if !trimmed.is_empty() {
            return format!("mbid:{}", trimmed.to_lowercase());
        }
    }
    format!("name:{}", artist.trim().to_lowercase())
}

pub struct LastfmClient {
    http: Client,
    api_key: String,
    semaphore: Arc<Semaphore>,
    rate_schedule: RateSchedule,
    tag_cache: tokio::sync::Mutex<HashMap<String, Vec<String>>>,
    pub calls: tokio::sync::Mutex<u64>,
}

impl LastfmClient {
    pub fn new(api_key: String, concurrency: usize) -> Self {
        let spacing_ms = std::env::var("AURRAL_LASTFM_REQUEST_SPACING_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(100)
            .clamp(50, 500);
        Self {
            http: Client::builder()
                .timeout(Duration::from_secs(20))
                .build()
                .expect("http client"),
            api_key,
            semaphore: Arc::new(Semaphore::new(concurrency.max(1))),
            rate_schedule: RateSchedule::new(Duration::from_millis(spacing_ms)),
            tag_cache: tokio::sync::Mutex::new(HashMap::new()),
            calls: tokio::sync::Mutex::new(0),
        }
    }

    pub async fn request(&self, method: &str, params: &[(&str, String)]) -> Option<Value> {
        let _permit = self.semaphore.acquire().await.ok()?;
        self.rate_schedule.acquire().await;

        let mut query: Vec<(&str, String)> = vec![
            ("method", method.to_string()),
            ("api_key", self.api_key.clone()),
            ("format", "json".to_string()),
        ];
        query.extend_from_slice(params);

        let response = self.http.get(LASTFM_API).query(&query).send().await.ok()?;
        *self.calls.lock().await += 1;
        if !response.status().is_success() {
            return None;
        }
        response.json::<Value>().await.ok()
    }

    pub async fn artist_top_tags(
        &self,
        artist: &str,
        mbid: Option<&str>,
    ) -> Vec<String> {
        let key = tag_cache_key(artist, mbid);
        if let Some(cached) = self.tag_cache.lock().await.get(&key) {
            return cached.clone();
        }
        let tags = self.fetch_artist_top_tags(artist, mbid).await;
        if !tags.is_empty() {
            self.tag_cache.lock().await.insert(key, tags.clone());
        }
        tags
    }

    async fn fetch_artist_top_tags(&self, artist: &str, mbid: Option<&str>) -> Vec<String> {
        let params = if let Some(mbid) = mbid {
            vec![("mbid", mbid.to_string())]
        } else {
            vec![("artist", artist.to_string())]
        };
        let data = match self.request("artist.getTopTags", &params).await {
            Some(data) => data,
            None => return Vec::new(),
        };
        let tags = data
            .pointer("/toptags/tag")
            .and_then(|value| {
                if value.is_array() {
                    Some(value.clone())
                } else {
                    Some(Value::Array(vec![value.clone()]))
                }
            })
            .unwrap_or_default();
        tags.as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|tag| tag.get("name").and_then(|v| v.as_str()))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .take(15)
            .collect()
    }

    pub async fn artist_similar(
        &self,
        artist: &str,
        mbid: Option<&str>,
        limit: usize,
    ) -> Vec<(String, Option<String>, Option<String>, f64)> {
        let mut params = vec![("limit", limit.to_string())];
        if let Some(mbid) = mbid {
            params.push(("mbid", mbid.to_string()));
        } else {
            params.push(("artist", artist.to_string()));
        }
        let data = match self.request("artist.getSimilar", &params).await {
            Some(data) => data,
            None => return Vec::new(),
        };
        let artists = data
            .pointer("/similarartists/artist")
            .and_then(|value| {
                if value.is_array() {
                    Some(value.clone())
                } else {
                    Some(Value::Array(vec![value.clone()]))
                }
            })
            .unwrap_or_default();
        artists
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|artist| {
                let name = artist.get("name")?.as_str()?.trim().to_string();
                if name.is_empty() {
                    return None;
                }
                let mbid = artist
                    .get("mbid")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty());
                let image = artist
                    .pointer("/image")
                    .and_then(|images| {
                        if images.is_array() {
                            images
                                .as_array()
                                .and_then(|arr| arr.last())
                                .and_then(|entry| entry.get("#text").or_else(|| entry.get("url")))
                        } else {
                            images.get("#text").or_else(|| images.get("url"))
                        }
                    })
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty());
                let match_score = artist
                    .get("match")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok())
                    .unwrap_or(0.0);
                Some((name, mbid, image, match_score))
            })
            .collect()
    }

    pub async fn artist_top_tracks(
        &self,
        artist: &str,
        limit: usize,
    ) -> Vec<(String, String, Option<String>)> {
        let params = vec![
            ("artist", artist.to_string()),
            ("limit", limit.to_string()),
        ];
        let data = match self.request("artist.getTopTracks", &params).await {
            Some(data) => data,
            None => return Vec::new(),
        };
        let tracks = data
            .pointer("/toptracks/track")
            .and_then(|value| {
                if value.is_array() {
                    Some(value.clone())
                } else {
                    Some(Value::Array(vec![value.clone()]))
                }
            })
            .unwrap_or_default();
        tracks
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|track| {
                let track_name = track.get("name")?.as_str()?.trim().to_string();
                let artist_name = track
                    .pointer("/artist/name")
                    .or_else(|| track.get("artist"))
                    .and_then(|v| {
                        if v.is_string() {
                            v.as_str()
                        } else {
                            v.get("name").and_then(|n| n.as_str())
                        }
                    })
                    .unwrap_or(artist)
                    .trim()
                    .to_string();
                let album_name = track
                    .pointer("/album/title")
                    .or_else(|| track.get("album"))
                    .and_then(|v| {
                        if v.is_string() {
                            v.as_str().map(|s| s.to_string())
                        } else {
                            v.get("title")
                                .or_else(|| v.get("#text"))
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        }
                    });
                if track_name.is_empty() {
                    return None;
                }
                Some((artist_name, track_name, album_name))
            })
            .collect()
    }

    pub async fn tag_top_artists(&self, tag: &str, limit: usize) -> Vec<String> {
        let params = vec![
            ("tag", tag.to_string()),
            ("limit", limit.to_string()),
        ];
        let data = match self.request("tag.getTopArtists", &params).await {
            Some(data) => data,
            None => return Vec::new(),
        };
        let artists = data
            .pointer("/topartists/artist")
            .and_then(|value| {
                if value.is_array() {
                    Some(value.clone())
                } else {
                    Some(Value::Array(vec![value.clone()]))
                }
            })
            .unwrap_or_default();
        artists
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|artist| {
                artist
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .collect()
    }

    pub async fn album_tracks_from_info(
        &self,
        artist: &str,
        album: &str,
    ) -> Vec<(String, Option<i64>)> {
        let params = vec![
            ("artist", artist.to_string()),
            ("album", album.to_string()),
        ];
        let data = match self.request("album.getInfo", &params).await {
            Some(data) => data,
            None => return Vec::new(),
        };
        let tracks = data
            .pointer("/album/tracks/track")
            .and_then(|value| {
                if value.is_array() {
                    Some(value.clone())
                } else {
                    Some(Value::Array(vec![value.clone()]))
                }
            })
            .unwrap_or_default();
        tracks
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|track| {
                let name = track.get("name")?.as_str()?.trim().to_string();
                if name.is_empty() {
                    return None;
                }
                let rank = track
                    .pointer("/@attr/rank")
                    .or_else(|| track.get("attr"))
                    .and_then(|v| {
                        if v.is_object() {
                            v.get("rank").and_then(|r| r.as_str())
                        } else {
                            v.as_str()
                        }
                    })
                    .and_then(|s| s.parse::<i64>().ok());
                Some((name, rank))
            })
            .collect()
    }

    pub async fn track_album_title(&self, artist: &str, track: &str) -> Option<String> {
        let params = vec![
            ("artist", artist.to_string()),
            ("track", track.to_string()),
            ("autocorrect", "1".to_string()),
        ];
        let data = self.request("track.getInfo", &params).await?;
        data.pointer("/track/album/title")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    pub async fn artist_top_track_values(
        &self,
        artist: &str,
        limit: usize,
    ) -> Vec<Value> {
        let params = vec![
            ("artist", artist.to_string()),
            ("limit", limit.to_string()),
        ];
        let data = match self.request("artist.getTopTracks", &params).await {
            Some(data) => data,
            None => return Vec::new(),
        };
        let tracks = data
            .pointer("/toptracks/track")
            .and_then(|value| {
                if value.is_array() {
                    Some(value.clone())
                } else {
                    Some(Value::Array(vec![value.clone()]))
                }
            })
            .unwrap_or_default();
        tracks.as_array().cloned().unwrap_or_default()
    }

    pub async fn chart_get_top_tracks(
        &self,
        limit: usize,
        health: &mut LastfmHealth,
    ) -> Option<Value> {
        let params = vec![("limit", limit.to_string())];
        let data = self.request("chart.getTopTracks", &params).await;
        health.record(&data);
        data
    }

    pub async fn chart_get_top_artists(
        &self,
        limit: usize,
        health: &mut LastfmHealth,
    ) -> Option<Value> {
        let params = vec![("limit", limit.to_string())];
        let data = self.request("chart.getTopArtists", &params).await;
        health.record(&data);
        data
    }
}
