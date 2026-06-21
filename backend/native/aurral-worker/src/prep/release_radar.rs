use crate::net::lidarr::{album_statistics, LidarrClient};
use crate::types::ReleaseRadarRelease;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

const RECENT_RELEASE_WINDOW_MS: i64 = 90 * 24 * 60 * 60 * 1000;

pub async fn collect_recent_missing_releases(
    client: Arc<LidarrClient>,
    limit: usize,
    include_future: bool,
) -> Vec<ReleaseRadarRelease> {
    let (artists, albums) = {
        let client_albums = client.clone();
        let (artists_result, albums_result) = tokio::join!(
            client.get_artists(),
            client_albums.get_albums(),
        );
        (
            artists_result.unwrap_or_default(),
            albums_result.unwrap_or_default(),
        )
    };
    if albums.is_empty() {
        return Vec::new();
    }
    let artists_by_id = index_artists(&artists);
    let now = chrono_now_ms();
    let recent_cutoff = now - RECENT_RELEASE_WINDOW_MS;
    let today = resolve_day_ms_from_ms(now);
    let limit = limit.max(1);
    let mut releases: Vec<ReleaseRadarRelease> = albums
        .into_iter()
        .filter_map(|album| {
            map_recent_missing_release(
                &album,
                &artists_by_id,
                recent_cutoff,
                today,
                include_future,
            )
        })
        .collect();
    releases.sort_by(|left, right| right_sort_key(right).cmp(&right_sort_key(left)));
    releases.truncate(limit);
    releases
}

fn index_artists(artists: &[Value]) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    for artist in artists {
        if let Some(id) = artist.get("id") {
            let key = id.to_string().trim_matches('"').to_string();
            if !key.is_empty() {
                map.insert(key, artist.clone());
            }
        }
    }
    map
}

fn map_recent_missing_release(
    album: &Value,
    artists_by_id: &HashMap<String, Value>,
    recent_cutoff: i64,
    today: Option<i64>,
    include_future: bool,
) -> Option<ReleaseRadarRelease> {
    let artist_id = album.get("artistId")?;
    let artist_key = artist_id.to_string().trim_matches('"').to_string();
    let artist = artists_by_id.get(&artist_key)?;
    let release_date = album
        .get("releaseDate")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let release_time = parse_release_time_ms(release_date)?;
    if release_time < recent_cutoff {
        return None;
    }
    if !include_future {
        if let (Some(release_day), Some(today)) = (resolve_day_ms(release_date), today) {
            if release_day > today {
                return None;
            }
        }
    }
    let (percent, size) = album_statistics(album);
    if percent > 0 || size > 0 {
        return None;
    }
    let album_name = album
        .get("title")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let artist_name = artist
        .get("artistName")
        .or_else(|| artist.get("name"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let album_mbid = album
        .get("foreignAlbumId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let artist_mbid = artist
        .get("foreignArtistId")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let release_year = release_date.get(0..4).map(str::to_string);
    Some(ReleaseRadarRelease {
        artist_name,
        album_name,
        album_mbid,
        artist_mbid,
        release_year,
    })
}

fn right_sort_key(release: &ReleaseRadarRelease) -> String {
    release.release_year.clone().unwrap_or_default()
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_release_time_ms(value: &str) -> Option<i64> {
    if let Some((year, month, day)) = parse_date_parts(value) {
        let time = date_utc_ms(year, month, day);
        return Some(time);
    }
    value.parse::<i64>().ok()
}

fn resolve_day_ms(value: &str) -> Option<i64> {
    let (year, month, day) = parse_date_parts(value)?;
    Some(date_utc_ms(year, month, day))
}

fn resolve_day_ms_from_ms(value: i64) -> Option<i64> {
    let seconds = value.div_euclid(1000);
    let days = seconds.div_euclid(86_400);
    Some(days * 86_400 * 1000)
}

fn parse_date_parts(value: &str) -> Option<(i32, u32, u32)> {
    let text = value.trim();
    let parts: Vec<&str> = text.split('T').next()?.split('-').collect();
    if parts.len() < 3 {
        return None;
    }
    let year = parts[0].parse::<i32>().ok()?;
    let month = parts[1].parse::<u32>().ok()?;
    let day = parts[2].parse::<u32>().ok()?;
    Some((year, month, day))
}

fn date_utc_ms(year: i32, month: u32, day: u32) -> i64 {
    let mut year = year as i64;
    let mut month = month as i64;
    let day = day as i64;
    if month <= 2 {
        year -= 1;
        month += 12;
    }
    let era = year / 400;
    let y = year - era * 400;
    let month_index = month - 1;
    let days = era * 146097
        + y * 365
        + y / 4
        - y / 100
        + (153 * month_index + 2) / 5
        + day
        - 719468;
    days * 86_400_000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_missing_recent_releases() {
        let artists = vec![serde_json::json!({
            "id": 1,
            "artistName": "Artist",
            "foreignArtistId": "artist-mbid"
        })];
        let artists_by_id = index_artists(&artists);
        let release_date = "2026-03-01";
        let album = serde_json::json!({
            "artistId": 1,
            "title": "Fresh Album",
            "releaseDate": release_date,
            "foreignAlbumId": "album-mbid",
            "statistics": { "percentOfTracks": 0, "sizeOnDisk": 0 }
        });
        let release = map_recent_missing_release(
            &album,
            &artists_by_id,
            chrono_now_ms() - RECENT_RELEASE_WINDOW_MS,
            resolve_day_ms_from_ms(chrono_now_ms()),
            false,
        );
        assert!(release.is_some());
        let release = release.unwrap();
        assert_eq!(release.album_name, "Fresh Album");
        assert_eq!(release.artist_name, "Artist");
    }

    #[test]
    fn rejects_owned_albums() {
        let artists = vec![serde_json::json!({
            "id": 2,
            "artistName": "Artist",
            "foreignArtistId": "artist-mbid"
        })];
        let artists_by_id = index_artists(&artists);
        let album = serde_json::json!({
            "artistId": 2,
            "title": "Owned Album",
            "releaseDate": "2026-03-01",
            "statistics": { "percentOfTracks": 50, "sizeOnDisk": 0 }
        });
        let release = map_recent_missing_release(
            &album,
            &artists_by_id,
            chrono_now_ms() - RECENT_RELEASE_WINDOW_MS,
            resolve_day_ms_from_ms(chrono_now_ms()),
            false,
        );
        assert!(release.is_none());
    }
}
