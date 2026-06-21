use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

static RE_PAREN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(.*?\)|\[.*?\]").unwrap());
static RE_DELUXE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(deluxe|expanded|anniversary|remaster(?:ed)?|bonus|edition|live|mono|stereo|explicit|clean)\b").unwrap());
static RE_NON_ALNUM: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^\p{L}\p{N}\s]").unwrap());
static RE_WS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").unwrap());
static RE_YEAR: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b(19\d{2}|20\d{2})\b").unwrap());
static RE_RELEASE_SUFFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s+(?:-|–|—)\s+(?:single|ep|album)\s*$").unwrap());
static RE_RELEASE_SUFFIX_BRACKET: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s+[\[(](?:single|ep|album)[\])]\s*$").unwrap());
static RE_SINGLE_EP_SUFFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s+(?:-|–|—)\s+(?:single|ep)\s*$").unwrap());
static RE_SINGLE_EP_BRACKET: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\s+[\[(](?:single|ep)[\])]\s*$").unwrap());
static RE_LIVE_VARIANT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\((?:live\b|live at[^)]*)\)|\[(?:live\b|live at[^\]]*)\]|\b(?:live at|live from|live version|live recording)\b|(?: - | – )\s*live\b").unwrap()
});
static RE_TRACK_NUMBER: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\s*(\d{1,3})(?:\s*[-._)\]]|\s+)").unwrap());
static RE_VOLUME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(?:vol\.?|volume)\s*([ivx\d]+)\b").unwrap());

pub static AUDIO_EXTENSIONS: &[&str] = &[
    ".flac", ".mp3", ".m4a", ".ogg", ".wav", ".aac", ".opus", ".alac", ".ape", ".wma",
];

static TITLE_STOP_WORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    [
        "the", "a", "an", "and", "or", "feat", "featuring", "ft", "with",
    ]
    .into_iter()
    .collect()
});

#[derive(Debug, Clone, Default)]
pub struct VariantProfile {
    pub live: bool,
    pub acoustic: bool,
    pub demo: bool,
    pub instrumental: bool,
    pub karaoke: bool,
    pub mix_variant: Option<String>,
    pub mono_stereo: Option<String>,
    pub content_rating: Option<String>,
}

pub fn normalize_text(value: &str) -> String {
    let mut text = value.to_lowercase();
    text = text.replace('&', " and ");
    text = RE_PAREN.replace_all(&text, " ").to_string();
    text = RE_DELUXE.replace_all(&text, " ").to_string();
    text = RE_NON_ALNUM.replace_all(&text, " ").to_string();
    text = RE_WS.replace_all(text.trim(), " ").to_string();
    text
}

pub fn normalize_variant_text(value: &str) -> String {
    let mut text = value.to_lowercase();
    text = text.replace('&', " and ");
    text = RE_NON_ALNUM.replace_all(&text, " ").to_string();
    RE_WS.replace_all(text.trim(), " ").to_string()
}

pub fn normalize_title(value: &str) -> String {
    normalize_text(value)
        .split_whitespace()
        .filter(|word| !word.is_empty() && !TITLE_STOP_WORDS.contains(word))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn extract_variant_profile(value: &str) -> VariantProfile {
    let raw_text = value.to_lowercase();
    let text = normalize_variant_text(value);
    let mix_variant = if regex::Regex::new(r"(?i)\bradio\s+edit\b").unwrap().is_match(&text) {
        Some("radio_edit".to_string())
    } else if regex::Regex::new(r"(?i)\b(?:extended|full length|club mix|long version)\b")
        .unwrap()
        .is_match(&text)
    {
        Some("extended".to_string())
    } else if regex::Regex::new(r"(?i)\b(?:remix|mix|rework|bootleg|vip|mashup)\b")
        .unwrap()
        .is_match(&text)
    {
        Some("remix".to_string())
    } else {
        None
    };
    VariantProfile {
        live: RE_LIVE_VARIANT.is_match(&raw_text),
        acoustic: text.contains("acoustic"),
        demo: text.contains("demo"),
        instrumental: text.contains("instrumental"),
        karaoke: text.contains("karaoke"),
        mix_variant,
        mono_stereo: if text.contains("mono") {
            Some("mono".to_string())
        } else if text.contains("stereo") {
            Some("stereo".to_string())
        } else {
            None
        },
        content_rating: if text.contains("clean") {
            Some("clean".to_string())
        } else if text.contains("explicit") {
            Some("explicit".to_string())
        } else {
            None
        },
    }
}

pub fn get_year(value: &str) -> Option<String> {
    RE_YEAR
        .find(value)
        .map(|m| m.as_str().to_string())
}

pub fn get_years(value: &str) -> Vec<String> {
    RE_YEAR
        .find_iter(value)
        .map(|m| m.as_str().to_string())
        .collect()
}

pub fn split_words(value: &str) -> Vec<String> {
    normalize_text(value)
        .split_whitespace()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn score_text_match(left: &str, right: &str) -> i32 {
    let a = normalize_text(left);
    let b = normalize_text(right);
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    if a == b {
        return 100;
    }
    if a.contains(&b) || b.contains(&a) {
        return 92;
    }
    let left_words: HashSet<&str> = a.split_whitespace().collect();
    let right_words: HashSet<&str> = b.split_whitespace().collect();
    if left_words.is_empty() || right_words.is_empty() {
        return 0;
    }
    let overlap = left_words.intersection(&right_words).count();
    let ratio = (2.0 * overlap as f64) / (left_words.len() + right_words.len()).max(1) as f64;
    (ratio * 100.0).round() as i32
}

pub fn bypass_banned_artist_term(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.len() < 2 {
        return trimmed.to_string();
    }
    trimmed
        .split_whitespace()
        .map(|word| {
            if word.is_empty() || word.starts_with('*') || word.len() < 2 {
                word.to_string()
            } else {
                format!("*{}", &word[1..])
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn strip_release_type_suffix(value: &str) -> String {
    let text = value.trim();
    if text.is_empty() {
        return String::new();
    }
    let stripped = RE_RELEASE_SUFFIX.replace_all(text, "");
    let stripped = RE_RELEASE_SUFFIX_BRACKET.replace_all(&stripped, "");
    let stripped = RE_WS.replace_all(stripped.trim(), " ").to_string();
    if stripped.is_empty() {
        text.to_string()
    } else {
        stripped
    }
}

pub fn strip_parenthetical(value: &str) -> String {
    RE_WS
        .replace_all(RE_PAREN.replace_all(value, " ").trim(), " ")
        .to_string()
}

pub fn remove_search_accents(value: &str) -> String {
    value.nfd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect()
}

pub fn strip_search_punctuation(value: &str) -> String {
    RE_WS
        .replace_all(RE_NON_ALNUM.replace_all(value, " ").trim(), " ")
        .to_string()
}

pub fn build_trimmed_bypass_text(value: &str) -> String {
    value
        .trim()
        .split_whitespace()
        .map(|word| {
            if word.len() >= 4 {
                &word[..word.len() - 1]
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn to_volume_digit(token: &str) -> String {
    let raw = token.trim();
    if raw.chars().all(|c| c.is_ascii_digit()) {
        return raw.to_string();
    }
    let lower = raw.to_lowercase();
    let mapped = match lower.as_str() {
        "i" => 1,
        "ii" => 2,
        "iii" => 3,
        "iv" => 4,
        "v" => 5,
        "vi" => 6,
        "vii" => 7,
        "viii" => 8,
        "ix" => 9,
        "x" => 10,
        _ => return raw.to_string(),
    };
    mapped.to_string()
}

pub fn build_volume_variation_texts(value: &str) -> Vec<String> {
    let text = value.trim();
    if text.is_empty() {
        return Vec::new();
    }
    let Some(caps) = RE_VOLUME.captures(text) else {
        return Vec::new();
    };
    let digit = to_volume_digit(caps.get(1).map(|m| m.as_str()).unwrap_or(""));
    let prefix = text[..caps.get(0).unwrap().start()].trim();
    let suffix = text[caps.get(0).unwrap().end()..].trim();
    let roman = caps.get(1).map(|m| m.as_str().to_uppercase()).unwrap_or_default();
    let forms = [
        format!("Vol. {digit}"),
        format!("Vol {digit}"),
        format!("Volume {digit}"),
        format!("Volume {roman}"),
    ];
    forms
        .iter()
        .map(|form| {
            [prefix, form.as_str(), suffix]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

pub fn build_half_album_title(album_name: &str) -> String {
    let words: Vec<&str> = album_name.trim().split_whitespace().filter(|w| !w.is_empty()).collect();
    if words.len() < 5 {
        return String::new();
    }
    words[..words.len().div_ceil(2)].join(" ")
}

pub fn unique_queries(values: &[String], limit: usize) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut queries = Vec::new();
    for value in values {
        let query = RE_WS.replace_all(value.trim(), " ").to_string();
        if query.is_empty() {
            continue;
        }
        let key = query.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        queries.push(query);
        if queries.len() >= limit {
            break;
        }
    }
    queries
}

pub fn unique_artist_terms(values: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut terms = Vec::new();
    for value in values {
        let term = value.trim().to_string();
        if term.is_empty() {
            continue;
        }
        let key = term.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        terms.push(term);
    }
    terms
}

pub fn get_distinctive_album_phrase(album_name: &str) -> String {
    let words: Vec<String> = split_words(album_name)
        .into_iter()
        .filter(|word| word.len() > 2 && !TITLE_STOP_WORDS.contains(word.as_str()))
        .collect();
    if words.len() <= 2 {
        return words.join(" ");
    }
    let mut picked: Vec<String> = words
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    picked.sort_by_key(|b| std::cmp::Reverse(b.len()));
    picked.truncate(3);
    let album_lower = album_name.to_lowercase();
    picked.sort_by_key(|word| album_lower.find(word).unwrap_or(usize::MAX));
    picked.join(" ")
}

pub fn get_path_parts(file_path: &str) -> Vec<String> {
    file_path
        .split(['\\', '/'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn get_file_name(file_path: &str) -> String {
    get_path_parts(file_path)
        .last()
        .cloned()
        .unwrap_or_default()
}

pub fn get_file_extension(file_path: &str) -> String {
    let file_name = get_file_name(file_path);
    if let Some(dot) = file_name.rfind('.') {
        if dot > 0 {
            return file_name[dot..].to_lowercase();
        }
    }
    String::new()
}

pub fn get_file_base_name(file_path: &str) -> String {
    let file_name = get_file_name(file_path);
    let ext = get_file_extension(file_path);
    if ext.is_empty() {
        file_name
    } else {
        file_name[..file_name.len().saturating_sub(ext.len())].to_string()
    }
}

pub fn extract_track_number(value: &str) -> Option<i32> {
    let caps = RE_TRACK_NUMBER.captures(value)?;
    let parsed: i32 = caps.get(1)?.as_str().parse().ok()?;
    if parsed > 0 { Some(parsed) } else { None }
}

pub fn read_comparable_album_name(album_name: Option<&str>) -> String {
    strip_release_type_suffix(album_name.unwrap_or(""))
}

pub fn has_single_release_type_suffix(album_name: &str) -> bool {
    RE_SINGLE_EP_SUFFIX.is_match(album_name) || RE_SINGLE_EP_BRACKET.is_match(album_name)
}

pub fn is_ambiguous_title_album_context(
    album_name: Option<&str>,
    track_name: &str,
) -> bool {
    let album_title = normalize_title(&read_comparable_album_name(album_name));
    let track_title = normalize_title(track_name);
    has_single_release_type_suffix(album_name.unwrap_or(""))
        && !album_title.is_empty()
        && !track_title.is_empty()
        && album_title == track_title
}

pub fn is_self_titled_album_context(artist_name: &str, album_name: Option<&str>) -> bool {
    let album = read_comparable_album_name(album_name);
    if artist_name.is_empty() || album.is_empty() {
        return false;
    }
    score_text_match(artist_name, &album) >= 92
}

pub fn join_search_parts(parts: &[&str]) -> String {
    parts
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}
