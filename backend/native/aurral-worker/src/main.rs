use aurral_worker::daemon;
use aurral_worker::jobs::discovery_refresh::run as run_discovery_refresh;
use aurral_worker::jobs::discovery_run::run as run_discovery_run;
use aurral_worker::jobs::flow_plan::run as run_flow_plan;
use aurral_worker::types::{
    DiscoveryRefreshJob, DiscoveryRunJob, ErrorResponse, FlowPlanJob, SuccessResponse,
};
use serde::de::DeserializeOwned;
use std::io::{self, Read};
use std::process;

fn read_stdin_json<T: DeserializeOwned>() -> Result<T, String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&input).map_err(|error| error.to_string())
}

fn write_json<T: serde::Serialize>(value: &T) {
    println!(
        "{}",
        serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
    );
}

async fn run_job(job_type: &str) {
    match job_type {
        "discovery-refresh" => {
            let job: DiscoveryRefreshJob = match read_stdin_json() {
                Ok(job) => job,
                Err(error) => {
                    write_json(&ErrorResponse { ok: false, error });
                    process::exit(1);
                }
            };
            match run_discovery_refresh(job).await {
                Ok(result) => {
                    write_json(&SuccessResponse {
                        ok: true,
                        result: result.to_payload(),
                        stats: result.stats,
                    });
                }
                Err(error) => {
                    write_json(&ErrorResponse { ok: false, error });
                    process::exit(1);
                }
            }
        }
        "discovery-run" => {
            let job: DiscoveryRunJob = match read_stdin_json() {
                Ok(job) => job,
                Err(error) => {
                    write_json(&ErrorResponse { ok: false, error });
                    process::exit(1);
                }
            };
            match run_discovery_run(job).await {
                Ok(result) => {
                    write_json(&SuccessResponse {
                        ok: true,
                        result: result.to_payload(),
                        stats: result.stats,
                    });
                }
                Err(error) => {
                    write_json(&ErrorResponse { ok: false, error });
                    process::exit(1);
                }
            }
        }
        "flow-plan" => {
            let job: FlowPlanJob = match read_stdin_json() {
                Ok(job) => job,
                Err(error) => {
                    write_json(&ErrorResponse { ok: false, error });
                    process::exit(1);
                }
            };
            match run_flow_plan(job).await {
                Ok(result) => {
                    write_json(&SuccessResponse {
                        ok: true,
                        result: result.to_payload(),
                        stats: result.stats,
                    });
                }
                Err(error) => {
                    write_json(&ErrorResponse { ok: false, error });
                    process::exit(1);
                }
            }
        }
        _ => {
            write_json(&ErrorResponse {
                ok: false,
                error: format!("unknown job type: {job_type}"),
            });
            process::exit(1);
        }
    }
}

#[tokio::main]
async fn main() {
    let job_type = std::env::args().nth(1).unwrap_or_default();
    if job_type == "daemon" {
        daemon::run_daemon().await;
        return;
    }
    if job_type.is_empty() {
        write_json(&ErrorResponse {
            ok: false,
            error: "usage: aurral-worker <daemon|discovery-refresh|discovery-run|flow-plan>".to_string(),
        });
        process::exit(1);
    }
    run_job(&job_type).await;
}
