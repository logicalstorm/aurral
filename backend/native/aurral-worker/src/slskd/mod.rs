pub mod normalize;
pub mod queries;
pub mod scoring;
pub mod types;
pub mod validate;

use crate::slskd::types::{SlskdMatcherJob, SlskdMatcherPayload};

pub fn dispatch(job: SlskdMatcherJob) -> Result<SlskdMatcherPayload, String> {
    match job {
        SlskdMatcherJob::BypassBannedArtistTerm { name } => Ok(SlskdMatcherPayload::StringValue {
            value: normalize::bypass_banned_artist_term(&name),
        }),
        SlskdMatcherJob::StripReleaseTypeSuffix { value } => Ok(SlskdMatcherPayload::StringValue {
            value: normalize::strip_release_type_suffix(&value),
        }),
        SlskdMatcherJob::RemoveSearchAccents { value } => Ok(SlskdMatcherPayload::StringValue {
            value: normalize::remove_search_accents(&value),
        }),
        SlskdMatcherJob::BuildTrimmedBypassText { value } => Ok(SlskdMatcherPayload::StringValue {
            value: normalize::build_trimmed_bypass_text(&value),
        }),
        SlskdMatcherJob::BuildVolumeVariationTexts { value } => {
            Ok(SlskdMatcherPayload::StringList {
                values: normalize::build_volume_variation_texts(&value),
            })
        }
        SlskdMatcherJob::BuildHalfAlbumTitle { album_name } => {
            Ok(SlskdMatcherPayload::StringValue {
                value: normalize::build_half_album_title(&album_name),
            })
        }
        SlskdMatcherJob::BuildFlowAlbumSearchQueries { context } => {
            Ok(SlskdMatcherPayload::StringList {
                values: queries::build_flow_album_search_queries(&context),
            })
        }
        SlskdMatcherJob::BuildFlowWildcardAlbumSearchQueries { context } => {
            Ok(SlskdMatcherPayload::StringList {
                values: queries::build_flow_wildcard_album_search_queries(&context),
            })
        }
        SlskdMatcherJob::BuildFlowTrackFallbackSearchQueries { context } => {
            Ok(SlskdMatcherPayload::StringList {
                values: queries::build_flow_track_fallback_search_queries(&context),
            })
        }
        SlskdMatcherJob::BuildFlowWildcardTrackFallbackSearchQueries { context } => {
            Ok(SlskdMatcherPayload::StringList {
                values: queries::build_flow_wildcard_track_fallback_search_queries(&context),
            })
        }
        SlskdMatcherJob::BuildFlowArtistOnlySearchQueries { context } => {
            Ok(SlskdMatcherPayload::StringList {
                values: queries::build_flow_artist_only_search_queries(&context),
            })
        }
        SlskdMatcherJob::BuildFlowSearchQueries { context } => Ok(SlskdMatcherPayload::StringList {
            values: queries::build_flow_search_queries(&context),
        }),
        SlskdMatcherJob::BuildFlowSearchTiers { context } => Ok(SlskdMatcherPayload::Tiers {
            tiers: queries::build_flow_search_tiers(&context),
        }),
        SlskdMatcherJob::RankFlowSearchResults {
            results,
            context,
            options,
        } => Ok(SlskdMatcherPayload::Candidates {
            candidates: scoring::rank_flow_search_results(&results, &context, &options),
        }),
        SlskdMatcherJob::SelectRankedMatchAttempts { matches, limit } => {
            Ok(SlskdMatcherPayload::Candidates {
                candidates: scoring::select_ranked_match_attempts(
                    &matches,
                    limit.unwrap_or(5),
                ),
            })
        }
        SlskdMatcherJob::ValidateDownloadedTrack {
            file_path,
            candidate,
            context,
        } => Ok(SlskdMatcherPayload::Validation(validate::validate_downloaded_track(
            &file_path,
            &candidate,
            &context,
        ))),
        SlskdMatcherJob::CountPreDownloadValidCandidates {
            results,
            context,
            options,
        } => Ok(SlskdMatcherPayload::Count {
            count: scoring::count_pre_download_valid_candidates(&results, &context, &options),
        }),
    }
}

pub use queries::{
    build_flow_album_search_queries, build_flow_artist_only_search_queries,
    build_flow_search_queries, build_flow_search_tiers,
    build_flow_track_fallback_search_queries, build_flow_wildcard_album_search_queries,
    build_flow_wildcard_track_fallback_search_queries,
};
pub use scoring::{
    count_pre_download_valid_candidates, rank_flow_search_results, select_ranked_match_attempts,
};
pub use validate::validate_downloaded_track;
