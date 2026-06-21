use crate::slskd::{dispatch, types::SlskdMatcherJob};
use crate::types::WorkerStats;
use std::time::Instant;

pub async fn run(job: SlskdMatcherJob) -> Result<(serde_json::Value, WorkerStats), String> {
    let started = Instant::now();
    let payload = dispatch(job)?;
    let duration_ms = started.elapsed().as_millis() as u64;
    Ok((
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
        WorkerStats {
            lastfm_calls: 0,
            musicbrainz_calls: 0,
            duration_ms,
        },
    ))
}

pub fn run_sync(job: SlskdMatcherJob) -> Result<(serde_json::Value, WorkerStats), String> {
    let started = Instant::now();
    let payload = dispatch(job)?;
    let duration_ms = started.elapsed().as_millis() as u64;
    Ok((
        serde_json::to_value(payload).map_err(|error| error.to_string())?,
        WorkerStats {
            lastfm_calls: 0,
            musicbrainz_calls: 0,
            duration_ms,
        },
    ))
}
