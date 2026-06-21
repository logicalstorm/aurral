use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

fn deserialize_truthy<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        None => None,
        Some(Value::Bool(flag)) => Some(flag),
        Some(Value::Number(number)) => Some(number.as_i64().unwrap_or(0) != 0),
        Some(Value::String(text)) => {
            let normalized = text.trim().to_lowercase();
            Some(!normalized.is_empty() && normalized != "0" && normalized != "false")
        }
        Some(_) => Some(true),
    })
}

fn default_string() -> String {
    String::new()
}

fn default_i32_zero() -> i32 {
    0
}

fn default_false() -> bool {
    false
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlowTrackContext {
    #[serde(default)]
    pub artist_name: String,
    #[serde(default)]
    pub track_name: String,
    #[serde(default)]
    pub album_name: Option<String>,
    #[serde(default)]
    pub artist_mbid: Option<String>,
    #[serde(default)]
    pub album_mbid: Option<String>,
    #[serde(default)]
    pub track_mbid: Option<String>,
    #[serde(default)]
    pub release_year: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default)]
    pub track_number: Option<i32>,
    #[serde(default)]
    pub album_track_count: Option<i32>,
    #[serde(default)]
    pub album_track_titles: Vec<String>,
    #[serde(default)]
    pub artist_aliases: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchTier {
    pub tier: i32,
    pub name: String,
    pub queries: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawSearchResult {
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub size: Option<i64>,
    #[serde(default, deserialize_with = "deserialize_truthy")]
    pub slots: Option<bool>,
    #[serde(default)]
    pub speed: Option<i64>,
    #[serde(default, alias = "bitRate")]
    pub bitrate: Option<i64>,
    #[serde(default)]
    pub locked: Option<bool>,
    #[serde(default, alias = "isLocked")]
    pub is_locked: Option<bool>,
    #[serde(default)]
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PeerStatsEntry {
    #[serde(default)]
    pub successes: u32,
    #[serde(default)]
    pub failures: u32,
    #[serde(default)]
    pub validation_failures: u32,
    #[serde(default)]
    pub active: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatcherOptions {
    #[serde(default)]
    pub preferred_format: Option<String>,
    #[serde(default)]
    pub strict_format: bool,
    #[serde(default)]
    pub peer_stats: std::collections::HashMap<String, PeerStatsEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CandidateBreakdown {
    #[serde(default)]
    pub artist_score: i32,
    #[serde(default)]
    pub album_score: i32,
    #[serde(default)]
    pub title_score: i32,
    #[serde(default)]
    pub year_score: i32,
    #[serde(default)]
    pub track_count_score: i32,
    #[serde(default)]
    pub user_queue_penalty_score: i32,
    #[serde(default)]
    pub variant_score: i32,
    #[serde(default)]
    pub variant_hard_mismatch: bool,
    #[serde(default)]
    pub track_number_mismatch: bool,
    #[serde(default)]
    pub track_number_score: i32,
    #[serde(default)]
    pub title_confidence_score: i32,
    #[serde(default)]
    pub sibling_track_penalty: i32,
    #[serde(default)]
    pub format_score: i32,
    #[serde(default)]
    pub speed: i64,
    #[serde(default)]
    pub slots: i64,
    #[serde(default)]
    pub bitrate: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedCandidate {
    pub raw: RawSearchResult,
    #[serde(default = "default_string")]
    pub ext: String,
    #[serde(default = "default_i32_zero")]
    pub score: i32,
    #[serde(default = "default_false")]
    pub pre_download_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pre_download_reject_reason: Option<String>,
    #[serde(default = "default_false")]
    pub is_likely_match: bool,
    #[serde(default)]
    pub breakdown: CandidateBreakdown,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_album_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_folder_fit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_score: Option<i32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ValidationScores {
    #[serde(default)]
    pub title: i32,
    #[serde(default)]
    pub artist: i32,
    #[serde(default)]
    pub album: i32,
    #[serde(default)]
    pub duration_valid: bool,
    #[serde(default)]
    pub variant: i32,
    #[serde(default)]
    pub track_number_mismatch: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_reason: Option<String>,
    #[serde(default)]
    pub pre_download_valid: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub scores: ValidationScores,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_duration_ms: Option<i64>,
    pub remote_filename: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
pub enum SlskdMatcherJob {
    BypassBannedArtistTerm { name: String },
    StripReleaseTypeSuffix { value: String },
    RemoveSearchAccents { value: String },
    BuildTrimmedBypassText { value: String },
    BuildVolumeVariationTexts { value: String },
    BuildHalfAlbumTitle {
        #[serde(alias = "albumName")]
        album_name: String,
    },
    BuildFlowAlbumSearchQueries { context: FlowTrackContext },
    BuildFlowWildcardAlbumSearchQueries { context: FlowTrackContext },
    BuildFlowTrackFallbackSearchQueries { context: FlowTrackContext },
    BuildFlowWildcardTrackFallbackSearchQueries { context: FlowTrackContext },
    BuildFlowArtistOnlySearchQueries { context: FlowTrackContext },
    BuildFlowSearchQueries { context: FlowTrackContext },
    BuildFlowSearchTiers { context: FlowTrackContext },
    RankFlowSearchResults {
        results: Vec<RawSearchResult>,
        context: FlowTrackContext,
        #[serde(default)]
        options: MatcherOptions,
    },
    SelectRankedMatchAttempts {
        matches: Vec<RankedCandidate>,
        #[serde(default)]
        limit: Option<usize>,
    },
    ValidateDownloadedTrack {
        #[serde(alias = "filePath")]
        file_path: String,
        candidate: Value,
        context: FlowTrackContext,
    },
    CountPreDownloadValidCandidates {
        results: Vec<RawSearchResult>,
        context: FlowTrackContext,
        #[serde(default)]
        options: MatcherOptions,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
pub enum SlskdMatcherPayload {
    StringValue { value: String },
    StringList { values: Vec<String> },
    Tiers { tiers: Vec<SearchTier> },
    Candidates { candidates: Vec<RankedCandidate> },
    Validation(ValidationResult),
    Count { count: usize },
}
