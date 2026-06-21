use crate::jobs::discovery_pipeline::run as run_discovery_pipeline;
use crate::jobs::discovery_prep::run as run_discovery_prep;
use crate::jobs::discovery_refresh::run as run_discovery_refresh;
use crate::jobs::discovery_run::run as run_discovery_run;
use crate::jobs::playlist_plan::run as run_playlist_plan;
use crate::jobs::flow_plan::run as run_flow_plan;
use crate::types::{DiscoveryPipelineJob, DiscoveryPrepJob, DiscoveryRefreshJob, DiscoveryRunJob, ErrorResponse, FlowPlanJob, PlaylistPlanJob};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonRequest {
    id: String,
    job: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DaemonResponse {
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<crate::types::WorkerStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn parse_payload<T: DeserializeOwned>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| error.to_string())
}

async fn dispatch_job(job_type: &str, payload: Value) -> Result<(Value, crate::types::WorkerStats), String> {
    match job_type {
        "discovery-refresh" => {
            let job: DiscoveryRefreshJob = parse_payload(payload)?;
            let result = run_discovery_refresh(job).await?;
            let stats = result.stats.clone();
            Ok((serde_json::to_value(result.to_payload()).map_err(|e| e.to_string())?, stats))
        }
        "discovery-run" => {
            let job: DiscoveryRunJob = parse_payload(payload)?;
            let result = run_discovery_run(job).await?;
            let stats = result.stats.clone();
            Ok((serde_json::to_value(result.to_payload()).map_err(|e| e.to_string())?, stats))
        }
        "discovery-pipeline" => {
            let job: DiscoveryPipelineJob = parse_payload(payload)?;
            let result = run_discovery_pipeline(job).await?;
            let stats = result.stats.clone();
            Ok((serde_json::to_value(result.to_payload()).map_err(|e| e.to_string())?, stats))
        }
        "discovery-prep" => {
            let job: DiscoveryPrepJob = parse_payload(payload)?;
            let result = run_discovery_prep(job).await?;
            let stats = result.stats.clone();
            Ok((serde_json::to_value(result.to_payload()).map_err(|e| e.to_string())?, stats))
        }
        "flow-plan" => {
            let job: FlowPlanJob = parse_payload(payload)?;
            let result = run_flow_plan(job).await?;
            let stats = result.stats.clone();
            Ok((
                serde_json::to_value(result.to_payload()).map_err(|e| e.to_string())?,
                stats,
            ))
        }
        "playlist-plan" => {
            let job: PlaylistPlanJob = parse_payload(payload)?;
            let result = run_playlist_plan(job).await?;
            let stats = result.stats.clone();
            Ok((
                serde_json::to_value(result.to_payload()).map_err(|e| e.to_string())?,
                stats,
            ))
        }
        _ => Err(format!("unknown job type: {job_type}")),
    }
}

pub async fn run_daemon() {
    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();

    loop {
        line.clear();
        let bytes = match reader.read_line(&mut line).await {
            Ok(value) => value,
            Err(error) => {
                let response = DaemonResponse {
                    id: String::new(),
                    ok: false,
                    result: None,
                    stats: None,
                    error: Some(error.to_string()),
                };
                let _ = write_response(&mut stdout, &response).await;
                continue;
            }
        };
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: DaemonRequest = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                let response = DaemonResponse {
                    id: String::new(),
                    ok: false,
                    result: None,
                    stats: None,
                    error: Some(error.to_string()),
                };
                let _ = write_response(&mut stdout, &response).await;
                continue;
            }
        };

        let response = match dispatch_job(&request.job, request.payload).await {
            Ok((result, stats)) => DaemonResponse {
                id: request.id,
                ok: true,
                result: Some(result),
                stats: Some(stats),
                error: None,
            },
            Err(error) => DaemonResponse {
                id: request.id,
                ok: false,
                result: None,
                stats: None,
                error: Some(error),
            },
        };
        if write_response(&mut stdout, &response).await.is_err() {
            break;
        }
    }
}

async fn write_response(
    stdout: &mut tokio::io::Stdout,
    response: &DaemonResponse,
) -> std::io::Result<()> {
    let encoded = serde_json::to_string(response).unwrap_or_else(|_| "{}".to_string());
    stdout.write_all(encoded.as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await
}

pub async fn write_error_response(error: String) {
    let response = ErrorResponse { ok: false, error };
    let encoded = serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string());
    let mut stdout = tokio::io::stdout();
    let _ = stdout.write_all(encoded.as_bytes()).await;
    let _ = stdout.write_all(b"\n").await;
    let _ = stdout.flush().await;
}
