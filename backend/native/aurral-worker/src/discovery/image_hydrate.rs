use crate::net::metadata::MetadataClient;
use crate::types::{normalize_mbid, Recommendation};

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
    metadata: &MetadataClient,
    recommendations: &mut [Recommendation],
    limit: usize,
) -> u64 {
    if limit == 0 || recommendations.is_empty() {
        return 0;
    }

    let mut hydrated = 0u64;
    let mut resolved = 0usize;
    for recommendation in recommendations.iter_mut() {
        if resolved >= limit {
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
        resolved += 1;
        if let Some(image) = metadata.get_artist_image_url(&mbid).await {
            recommendation.image = Some(image);
            hydrated += 1;
        }
    }
    hydrated
}
