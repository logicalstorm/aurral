use crate::slskd::normalize::{
    bypass_banned_artist_term, get_distinctive_album_phrase, get_year, join_search_parts,
    normalize_text, normalize_title, read_comparable_album_name, score_text_match,
    strip_parenthetical, unique_artist_terms, unique_queries,
};
use crate::slskd::types::{FlowTrackContext, SearchTier};

#[derive(Debug, Clone)]
pub struct FlowSearchContext {
    pub artist_name: String,
    pub track_name: String,
    pub album_name: String,
    pub release_year: Option<String>,
    pub aliases: Vec<String>,
    pub normalized_album: String,
    pub distinctive_album: String,
    pub track_variants: Vec<String>,
    pub is_self_titled: bool,
}

pub fn read_flow_search_context(context: &FlowTrackContext) -> FlowSearchContext {
    let artist_name = context.artist_name.trim().to_string();
    let track_name = context.track_name.trim().to_string();
    let album_name = read_comparable_album_name(context.album_name.as_deref());
    let release_year = context
        .release_year
        .as_deref()
        .and_then(|value| get_year(value));
    let aliases: Vec<String> = context
        .artist_aliases
        .iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .take(2)
        .collect();
    let normalized_album = normalize_title(&album_name);
    let distinctive_album = get_distinctive_album_phrase(&album_name);
    let track_variants = build_track_query_variants(&track_name);
    let is_self_titled = if !artist_name.is_empty() && !album_name.is_empty() {
        score_text_match(&artist_name, &album_name) >= 92
    } else {
        false
    };
    FlowSearchContext {
        artist_name,
        track_name,
        album_name,
        release_year,
        aliases,
        normalized_album,
        distinctive_album,
        track_variants,
        is_self_titled,
    }
}

fn build_track_query_variants(track_name: &str) -> Vec<String> {
    let raw = track_name.trim();
    if raw.is_empty() {
        return Vec::new();
    }
    let mut variants = vec![raw.to_string()];
    let stripped = strip_parenthetical(raw);
    if !stripped.is_empty() && stripped.to_lowercase() != raw.to_lowercase() {
        variants.push(stripped);
    }
    let normalized = normalize_title(raw);
    if !normalized.is_empty() && normalized.to_lowercase() != raw.to_lowercase() {
        variants.push(normalized);
    }
    if raw.contains('/') {
        for part in raw.split('/') {
            let part = strip_parenthetical(part);
            if !part.is_empty() {
                variants.push(part);
            }
        }
    }
    unique_queries(&variants, 12)
}

fn read_flow_artist_terms(ctx: &FlowSearchContext, wildcard: bool) -> Vec<String> {
    let mut terms = vec![ctx.artist_name.clone()];
    terms.extend(ctx.aliases.clone());
    let terms = if wildcard {
        terms
            .into_iter()
            .map(|term| bypass_banned_artist_term(&term))
            .collect()
    } else {
        terms
    };
    unique_artist_terms(&terms)
}

fn build_flow_album_search_queries_for_artist_terms(
    ctx: &FlowSearchContext,
    artist_terms: &[String],
) -> Vec<String> {
    let mut queries = Vec::new();
    for artist in artist_terms {
        if artist.is_empty() || ctx.album_name.is_empty() {
            continue;
        }
        if ctx.is_self_titled {
            if let Some(year) = &ctx.release_year {
                queries.push(format!("{artist} {year}"));
            }
        }
        queries.push(format!("{artist} {}", ctx.album_name));
        if let Some(year) = &ctx.release_year {
            queries.push(format!("{artist} {} {year}", ctx.album_name));
        }
        let normalized_album_title = normalize_title(&ctx.album_name);
        if !ctx.normalized_album.is_empty()
            && ctx.normalized_album != normalized_album_title
        {
            queries.push(format!("{artist} {}", ctx.normalized_album));
        }
        if !ctx.distinctive_album.is_empty()
            && normalize_text(&ctx.distinctive_album) != normalize_text(&ctx.album_name)
        {
            queries.push(format!("{artist} {}", ctx.distinctive_album));
        }
    }
    unique_queries(&queries, 12)
}

fn build_flow_track_fallback_search_queries_for_artist_terms(
    ctx: &FlowSearchContext,
    artist_terms: &[String],
) -> Vec<String> {
    let mut queries = Vec::new();
    for artist in artist_terms {
        if artist.is_empty() {
            continue;
        }
        for track_variant in &ctx.track_variants {
            queries.push(format!("{artist} {track_variant}"));
        }
    }
    if !ctx.album_name.is_empty() && !ctx.track_variants.is_empty() {
        for track_variant in ctx.track_variants.iter().take(2) {
            queries.push(format!("{track_variant} {}", ctx.album_name));
            if let Some(year) = &ctx.release_year {
                queries.push(format!("{track_variant} {} {year}", ctx.album_name));
            }
            let normalized_album_title = normalize_title(&ctx.album_name);
            if !ctx.normalized_album.is_empty()
                && ctx.normalized_album != normalized_album_title
            {
                queries.push(format!("{track_variant} {}", ctx.normalized_album));
            }
        }
    }
    for alias in &ctx.aliases {
        if artist_terms
            .iter()
            .any(|term| term.eq_ignore_ascii_case(alias))
        {
            continue;
        }
        for track_variant in &ctx.track_variants {
            queries.push(format!("{alias} {track_variant}"));
        }
    }
    unique_queries(&queries, 12)
}

pub fn build_flow_album_search_queries(context: &FlowTrackContext) -> Vec<String> {
    let ctx = read_flow_search_context(context);
    build_flow_album_search_queries_for_artist_terms(
        &ctx,
        &read_flow_artist_terms(&ctx, false),
    )
}

pub fn build_flow_wildcard_album_search_queries(context: &FlowTrackContext) -> Vec<String> {
    let ctx = read_flow_search_context(context);
    build_flow_album_search_queries_for_artist_terms(
        &ctx,
        &read_flow_artist_terms(&ctx, true),
    )
}

pub fn build_flow_track_fallback_search_queries(context: &FlowTrackContext) -> Vec<String> {
    let ctx = read_flow_search_context(context);
    build_flow_track_fallback_search_queries_for_artist_terms(
        &ctx,
        &read_flow_artist_terms(&ctx, false),
    )
}

pub fn build_flow_wildcard_track_fallback_search_queries(
    context: &FlowTrackContext,
) -> Vec<String> {
    let ctx = read_flow_search_context(context);
    build_flow_track_fallback_search_queries_for_artist_terms(
        &ctx,
        &read_flow_artist_terms(&ctx, true),
    )
}

pub fn build_flow_artist_only_search_queries(context: &FlowTrackContext) -> Vec<String> {
    let ctx = read_flow_search_context(context);
    unique_queries(&read_flow_artist_terms(&ctx, true), 6)
}

fn build_primary_track_tier_queries(ctx: &FlowSearchContext) -> Vec<String> {
    let mut queries = Vec::new();
    let primary_track = ctx
        .track_variants
        .first()
        .cloned()
        .unwrap_or_else(|| ctx.track_name.clone());
    if ctx.artist_name.is_empty() || primary_track.is_empty() {
        return queries;
    }
    queries.push(join_search_parts(&[&ctx.artist_name, &primary_track]));
    if let Some(year) = &ctx.release_year {
        queries.push(join_search_parts(&[
            &ctx.artist_name,
            &primary_track,
            year,
        ]));
    }
    unique_queries(&queries, 4)
}

fn build_base_album_tier_queries(ctx: &FlowSearchContext) -> Vec<String> {
    let mut queries = Vec::new();
    if ctx.artist_name.is_empty() || ctx.album_name.is_empty() {
        return queries;
    }
    if let Some(year) = &ctx.release_year {
        queries.push(join_search_parts(&[
            &ctx.artist_name,
            &ctx.album_name,
            year,
        ]));
    }
    queries.push(join_search_parts(&[&ctx.artist_name, &ctx.album_name]));
    unique_queries(&queries, 4)
}

fn build_wildcard_album_tier_queries(ctx: &FlowSearchContext) -> Vec<String> {
    let mut queries = Vec::new();
    if ctx.artist_name.is_empty() || ctx.album_name.is_empty() {
        return queries;
    }
    let wildcard_artist = bypass_banned_artist_term(&ctx.artist_name);
    if wildcard_artist.is_empty() || wildcard_artist == ctx.artist_name {
        return queries;
    }
    if let Some(year) = &ctx.release_year {
        queries.push(join_search_parts(&[
            &wildcard_artist,
            &ctx.album_name,
            year,
        ]));
    }
    queries.push(join_search_parts(&[&wildcard_artist, &ctx.album_name]));
    unique_queries(&queries, 3)
}

fn build_album_track_tier_queries(ctx: &FlowSearchContext) -> Vec<String> {
    let mut queries = Vec::new();
    let primary_track = ctx
        .track_variants
        .first()
        .cloned()
        .unwrap_or_else(|| ctx.track_name.clone());
    if !ctx.album_name.is_empty() && !primary_track.is_empty() {
        queries.push(join_search_parts(&[&ctx.album_name, &primary_track]));
    }
    if ctx.album_name.is_empty() && !ctx.artist_name.is_empty() && !primary_track.is_empty() {
        queries.push(join_search_parts(&[&ctx.artist_name, &primary_track]));
        let wildcard_artist = bypass_banned_artist_term(&ctx.artist_name);
        if !wildcard_artist.is_empty() && wildcard_artist != ctx.artist_name {
            queries.push(join_search_parts(&[&wildcard_artist, &primary_track]));
        }
    }
    unique_queries(&queries, 3)
}

pub fn build_flow_search_tiers(context: &FlowTrackContext) -> Vec<SearchTier> {
    let ctx = read_flow_search_context(context);
    let mut tiers = Vec::new();
    let base_album = build_base_album_tier_queries(&ctx);
    if !base_album.is_empty() {
        tiers.push(SearchTier {
            tier: 0,
            name: "base_album".to_string(),
            queries: base_album,
        });
    }
    let wildcard_album = build_wildcard_album_tier_queries(&ctx);
    if !wildcard_album.is_empty() {
        tiers.push(SearchTier {
            tier: 1,
            name: "wildcard_album".to_string(),
            queries: wildcard_album,
        });
    }
    let album_track = build_album_track_tier_queries(&ctx);
    if !album_track.is_empty() {
        tiers.push(SearchTier {
            tier: 2,
            name: "album_track".to_string(),
            queries: album_track,
        });
    }
    if tiers.is_empty() {
        let primary_track = build_primary_track_tier_queries(&ctx);
        if !primary_track.is_empty() {
            tiers.push(SearchTier {
                tier: 0,
                name: "primary_track".to_string(),
                queries: primary_track,
            });
        }
    }
    tiers
}

pub fn build_flow_search_queries(context: &FlowTrackContext) -> Vec<String> {
    let queries: Vec<String> = build_flow_search_tiers(context)
        .into_iter()
        .flat_map(|tier| tier.queries)
        .collect();
    unique_queries(&queries, 32)
}
