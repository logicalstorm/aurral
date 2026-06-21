pub mod concurrency;

pub fn network_concurrency() -> usize {
    std::env::var("AURRAL_LASTFM_CONCURRENCY")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(12)
        .clamp(1, 16)
}

pub fn metadata_concurrency() -> usize {
    std::env::var("AURRAL_METADATA_CONCURRENCY")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(12)
        .clamp(1, 24)
}
