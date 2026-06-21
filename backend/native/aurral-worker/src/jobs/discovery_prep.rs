use crate::net::lidarr::LidarrClient;
use crate::prep::{library_mix, release_radar};
use crate::types::{
    DiscoveryPrepJob, LibraryMixArtist, ReleaseRadarRelease, WorkerStats,
};
use serde::Serialize;
use std::sync::Arc;
use std::time::Instant;

pub struct DiscoveryPrepResult {
    pub library_mix_artists: Vec<LibraryMixArtist>,
    pub release_radar_releases: Vec<ReleaseRadarRelease>,
    pub lidarr_calls: u64,
    pub stats: WorkerStats,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryPrepPayload {
    pub library_mix_artists: Vec<LibraryMixArtist>,
    pub release_radar_releases: Vec<ReleaseRadarRelease>,
    pub lidarr_calls: u64,
}

impl DiscoveryPrepResult {
    pub fn to_payload(&self) -> DiscoveryPrepPayload {
        DiscoveryPrepPayload {
            library_mix_artists: self.library_mix_artists.clone(),
            release_radar_releases: self.release_radar_releases.clone(),
            lidarr_calls: self.lidarr_calls,
        }
    }
}

pub async fn run(job: DiscoveryPrepJob) -> Result<DiscoveryPrepResult, String> {
    let started = Instant::now();
    let release_limit = job.release_radar_limit.unwrap_or(30).max(1);
    let Some(lidarr_config) = job.lidarr else {
        return Ok(empty_result(started));
    };
    let client = Arc::new(LidarrClient::new(
        &lidarr_config,
        crate::util::network_concurrency(),
    )?);
    let (library_mix_artists, release_radar_releases) = tokio::join!(
        library_mix::build_library_mix_context(client.clone(), job.artists),
        release_radar::collect_recent_missing_releases(
            client.clone(),
            release_limit,
            job.include_future
        )
    );
    let lidarr_calls = client.call_count();
    let duration_ms = started.elapsed().as_millis() as u64;
    Ok(DiscoveryPrepResult {
        library_mix_artists,
        release_radar_releases,
        lidarr_calls,
        stats: WorkerStats {
            lastfm_calls: 0,
            musicbrainz_calls: lidarr_calls,
            duration_ms,
        },
    })
}

fn empty_result(started: Instant) -> DiscoveryPrepResult {
    DiscoveryPrepResult {
        library_mix_artists: Vec::new(),
        release_radar_releases: Vec::new(),
        lidarr_calls: 0,
        stats: WorkerStats {
            lastfm_calls: 0,
            musicbrainz_calls: 0,
            duration_ms: started.elapsed().as_millis() as u64,
        },
    }
}
