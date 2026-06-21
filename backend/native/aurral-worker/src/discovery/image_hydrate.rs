use crate::net::metadata::MetadataClient;
use crate::types::{normalize_mbid, Recommendation};
use crate::util::concurrency::map_with_concurrency;
use crate::util::metadata_concurrency;
use std::sync::Arc;

const LASTFM_IMAGE_PATTERN: [&str; 2] = ["lastfm", "audioscrobbler"];

fn should_replace_existing_image(image_url: Option<&str>) -> bool {
    let image = image_url.unwrap_or("").trim();
    if image.is_empty() {
        return false;
    }
    let lower = image.to_lowercase();
    if LASTFM_IMAGE_PATTERN.iter().any(|pattern| lower.contains(pattern)) {
        return true;
    }
    lower.contains("/api/image-proxy/") && lower.contains("?src=")
}

fn recommendation_mbid(recommendation: &Recommendation) -> Option<String> {
    normalize_mbid(recommendation.id.as_deref())
        .or_else(|| normalize_mbid(recommendation.navigate_to.as_deref()))
}

pub async fn hydrate_recommendation_images(
    metadata: Arc<MetadataClient>,
    recommendations: &mut [Recommendation],
    limit: usize,
) -> u64 {
    if limit == 0 || recommendations.is_empty() {
        return 0;
    }

    let mut jobs: Vec<(usize, String)> = Vec::new();
    for (index, recommendation) in recommendations.iter().enumerate() {
        if jobs.len() >= limit {
            break;
        }
        if recommendation
            .image
            .as_deref()
            .is_some_and(|image| !should_replace_existing_image(Some(image)))
        {
            continue;
        }
        let Some(mbid) = recommendation_mbid(recommendation) else {
            continue;
        };
        jobs.push((index, mbid));
    }

    if jobs.is_empty() {
        return 0;
    }

    let images = map_with_concurrency(
        jobs,
        metadata_concurrency(),
        move |(index, mbid)| {
            let metadata = metadata.clone();
            async move {
                let image = metadata.get_artist_image_url(&mbid).await;
                (index, image)
            }
        },
    )
    .await;

    let mut hydrated = 0u64;
    for (index, image) in images {
        if let Some(image) = image {
            recommendations[index].image = Some(image);
            hydrated += 1;
        }
    }
    hydrated
}
