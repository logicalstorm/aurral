import { shouldReplaceExistingImage } from './artistImageHydration.js';
import { GENRE_KEYWORDS } from '../config/constants.js';

interface SeedRef {
  artistName: string;
  source: string;
  weight: number;
  profileBucket?: string | null;
}

interface SeedEntry {
  mbid: string | null;
  artistName: string;
  source: string;
  identityKeys: string[];
  playcount: number;
  weight: number;
  affinityWeight: number;
  profileBucket: string | null;
  similarityMultiplier?: number;
  tagAffinityMultiplier?: number;
  discoveryDepth?: number;
  match?: number;
}

interface AccumulatorEntry {
  id: string | null;
  name: string;
  type: string;
  image: string | null;
  bestMatch: number;
  rawContribution: number;
  scoreSimilarity: number;
  scoreTagAffinity: number;
  tagOverlapCount: number;
  tags: Set<string>;
  seedWeights: number[];
  matchedTagWeights: Map<string, number>;
  discoveryDepth: number;
  sourceTypes: Set<string>;
  supportingSeeds: Map<string, SeedRef>;
}

interface ArtistDescriptor {
  id?: string | null;
  mbid?: string | null;
  foreignArtistId?: string | null;
  name?: string | null;
  artistName?: string | null;
  source?: string | null;
  playcount?: number | null;
  affinityWeight?: number | null;
  profileBucket?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  listeners?: number | null;
  popularityLabel?: string | null;
  popularityRank?: string | null;
  score?: number | null;
  scoreTotal?: number | null;
  scoreSimilarity?: number | null;
  scoreTagAffinity?: number | null;
  scoreSeedCoverage?: number | null;
  scoreNovelty?: number | null;
  scorePopularityPenalty?: number | null;
  seedCount?: number | null;
  confidence?: number | null;
  discoveryTier?: string | null;
  discoveryDepth?: number | null;
  navigateTo?: string | null;
  sourceArtist?: string | null;
  sourceArtists?: string[] | null;
  sourceType?: string | null;
  sourceTypes?: string[] | null;
  sourceMix?: string[] | null;
  reasonCodes?: string[] | null;
  tags?: string[] | null;
  matchedTags?: string[] | null;
  supportingSeeds?: SeedRef[] | null;
  match?: number | null;
  similarityMultiplier?: number | null;
  tagAffinityMultiplier?: number | null;
  firstDiscoveredAt?: string | null;
  discoveredAt?: string | null;
  lastRecommendedAt?: string | null;
  recommendationPoolState?: string | null;
  scoreFreshnessBoost?: number | null;
  scoreAgingPenalty?: number | null;
  scoreDiversityPenalty?: number | null;
  recommendationPoolRank?: number | null;
  hiddenByFeedback?: boolean | null;
  candidateTagsHydrated?: boolean | null;
  tagSource?: string | null;
  __rerankBaseScore?: number;
  __rerankFeedbackAdjustment?: number;
  __rerankHidden?: boolean;
  __rerankTags?: string[];
  __rerankSeeds?: string[];
}

interface FeedbackEntry {
  action?: string | null;
  artistId?: string | null;
  artistName?: string | null;
  tagContext?: string[] | null;
  seedContext?: string[] | null;
  expiresAt?: string | null;
}

interface ReasonParams {
  tagOverlapCount: number;
  seedCoverage: number;
  sourceTypes: string[];
  scoreNovelty: number;
  scorePopularityPenalty: number;
  discoveryMode: string;
  discoveryDepth: number;
}

interface CandidateParams {
  candidate?: ArtistDescriptor | null;
  seed?: SeedEntry | null;
  sourceTags?: string[];
  profileTagWeights?: Map<string, number>;
  existingArtistKeys?: Set<string>;
}

interface PoolMetadata {
  firstDiscoveredAt: string | null;
  lastRecommendedAt: string | null;
}

interface PoolMetaOptions {
  fresh?: boolean;
  index?: number;
  metadata?: PoolMetadata | null;
  runStartedAt?: string;
  runStartedMs?: number;
}

interface MergeRetainedParams {
  freshRecommendations?: ArtistDescriptor[];
  existingRecommendations?: ArtistDescriptor[];
  existingArtistKeys?: Set<string>;
  limit?: number;
  runStartedAt?: string;
  discoveryMode?: string;
  feedback?: FeedbackEntry[];
}

interface RerankOptions {
  discoveryMode?: string;
  feedback?: FeedbackEntry[];
}

interface FinalizedRecommendation {
  id: string | null;
  name: string;
  type: string;
  image: string | null;
  tags: string[];
  matchedTags: string[];
  supportingSeeds: SeedRef[];
  seedCount: number;
  score: number;
  scoreTotal: number;
  scoreSimilarity: number;
  scoreTagAffinity: number;
  scoreSeedCoverage: number;
  scoreNovelty: number;
  scoreDiversityPenalty: number;
  scorePopularityPenalty: number;
  sourceArtist: string | null;
  sourceArtists: string[];
  sourceType: string;
  sourceTypes: string[];
  sourceMix: string[];
  discoveryDepth: number;
  bestMatch: number;
  reasonCodes: string[];
  discoveryTier: string;
  confidence: number;
}

interface DiscoveryTagsOptions {
  limit?: number;
  minArtists?: number;
}

const MBID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE_BASE_WEIGHTS: Record<string, number> = {
  library: 1,
  lastfm: 1.2,
  listenbrainz: 1.3,
  koito: 1.3,
};

const DISCOVERY_MODE_MULTIPLIERS: Record<string, Record<string, number>> = {
  safer: {
    similarity: 1.2,
    tagAffinity: 0.9,
    seedCoverage: 1.1,
    novelty: 0.6,
    popularityPenalty: 0.7,
    diversityPenalty: 0.8,
  },
  balanced: {
    similarity: 1,
    tagAffinity: 1,
    seedCoverage: 1,
    novelty: 1,
    popularityPenalty: 1,
    diversityPenalty: 1,
  },
  deeper: {
    similarity: 0.7,
    tagAffinity: 1.15,
    seedCoverage: 0.95,
    novelty: 2,
    popularityPenalty: 1.4,
    diversityPenalty: 1.2,
  },
};

const normalizeText = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeMbid = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return MBID_REGEX.test(normalized) ? normalized : null;
};

const buildSeedIdentityKeys = (mbid: string | null, artistName: string): string[] => {
  const keys: string[] = [];
  if (mbid) keys.push(`mbid:${mbid}`);
  const normalizedName = normalizeText(artistName);
  if (normalizedName) keys.push(`name:${normalizedName}`);
  return keys;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const normalizeDiscoveryMode = (value: unknown): string => {
  const mode = normalizeText(value);
  return DISCOVERY_MODE_MULTIPLIERS[mode] ? mode : 'balanced';
};

const sortByValueThenName = (
  entries: Iterable<[string, number]>,
): [string, number][] =>
  [...entries].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return String(left[0] || '').localeCompare(String(right[0] || ''));
  });

const topKeysFromMap = (
  map: Map<string, number>,
  limit: number = 4,
): string[] =>
  sortByValueThenName(map.entries())
    .slice(0, limit)
    .map(([key]) => key);

const summarizeSourceArtists = (sourceArtists: Iterable<string>): string | null => {
  const artists = [...sourceArtists].filter(Boolean);
  if (artists.length === 0) return null;
  if (artists.length === 1) return artists[0];
  if (artists.length === 2) return `${artists[0]}, ${artists[1]}`;
  return `${artists[0]}, ${artists[1]} +${artists.length - 2} more`;
};

const mergeTags = (target: Set<string>, sourceTags: string[] = []): void => {
  for (const tag of sourceTags) {
    const normalized = normalizeText(tag);
    if (!normalized) continue;
    if (target.size >= 16 && target.has(normalized) === false) continue;
    target.add(normalized);
  }
};

const normalizeTagList = (tags: unknown = []): string[] =>
  (Array.isArray(tags) ? tags : []).map(normalizeText).filter(Boolean);

export const normalizeArtistIdentityKeys = (
  artist: ArtistDescriptor | null | undefined,
): string[] => {
  const keys: string[] = [];
  const mbids = [artist?.id, artist?.mbid, artist?.foreignArtistId]
    .map(normalizeMbid)
    .filter(Boolean);
  for (const mbid of mbids) {
    if (mbid) keys.push(`mbid:${mbid}`);
  }
  const names = [artist?.name, artist?.artistName].map(normalizeText).filter(Boolean);
  for (const name of names) {
    keys.push(`name:${name}`);
  }
  return [...new Set(keys)];
};

export const buildExistingArtistKeySet = (
  artists: ArtistDescriptor[] = [],
): Set<string> => {
  const keys = new Set<string>();
  for (const artist of Array.isArray(artists) ? artists : []) {
    for (const key of normalizeArtistIdentityKeys(artist)) {
      keys.add(key);
    }
  }
  return keys;
};

export const applyHydratedCandidateTags = (
  recommendation: ArtistDescriptor | null,
  candidateTags: string[] = [],
  profileTagWeights: Map<string, number> = new Map(),
  options: { tagAffinityMultiplier?: number } = {},
): ArtistDescriptor | null => {
  const normalizedTags = normalizeTagList(candidateTags);
  if (!recommendation || normalizedTags.length === 0) return recommendation;

  if (!(profileTagWeights instanceof Map) || profileTagWeights.size === 0) {
    return {
      ...recommendation,
      tags: normalizedTags,
      candidateTagsHydrated: true,
      tagSource: 'lastfm_artist',
    };
  }

  const matchedTagWeights = new Map<string, number>();
  for (const tag of normalizedTags) {
    if (!profileTagWeights.has(tag)) continue;
    matchedTagWeights.set(tag, Number(profileTagWeights.get(tag) || 0));
  }
  const matchedTags = topKeysFromMap(matchedTagWeights, 4);
  const tagWeightSum = matchedTags.reduce(
    (sum: number, tag: string) => sum + Number(profileTagWeights.get(tag) || 0),
    0,
  );
  const tagAffinityMultiplier = clamp(
    Number(
      options.tagAffinityMultiplier ?? (Number(recommendation.discoveryDepth || 1) >= 2 ? 0.55 : 1),
    ),
    0,
    1,
  );
  const scoreTagAffinity =
    Math.min(45, tagWeightSum * 6 + matchedTags.length * 3) * tagAffinityMultiplier;
  const previousScoreTagAffinity = Number(recommendation.scoreTagAffinity || 0);
  const previousTotal = Number(recommendation.scoreTotal || recommendation.score || 0);
  const scoreTotal = Math.round(previousTotal - previousScoreTagAffinity + scoreTagAffinity);

  return {
    ...recommendation,
    tags: normalizedTags,
    matchedTags,
    scoreTagAffinity: Math.round(scoreTagAffinity),
    scoreTotal,
    score: scoreTotal,
    candidateTagsHydrated: true,
    tagSource: 'lastfm_artist',
  };
};

const calculateSeedWeight = (
  seed: Record<string, unknown> | null | undefined,
  index: number,
): number => {
  const source = normalizeText(seed?.source) || 'library';
  const baseWeight = SOURCE_BASE_WEIGHTS[source] || 1;

  if (source === 'library') {
    const recencyBoost = Math.max(0, 0.5 - Math.max(index, 0) * 0.02);
    return Number((baseWeight + recencyBoost).toFixed(4));
  }

  const playcount = Math.max(0, Number(seed?.playcount || 0));
  const playcountBoost = playcount > 0 ? Math.min(1.4, Math.log10(playcount + 1) * 0.4) : 0.15;
  return Number((baseWeight + playcountBoost).toFixed(4));
};

export const buildDiscoverySeedList = ({
  libraryArtists = [] as ArtistDescriptor[],
  historyArtists = [] as ArtistDescriptor[],
}: {
  libraryArtists?: ArtistDescriptor[];
  historyArtists?: ArtistDescriptor[];
} = {}): SeedEntry[] => {
  const combined: ArtistDescriptor[] = [
    ...(Array.isArray(historyArtists) ? historyArtists : []),
    ...(Array.isArray(libraryArtists) ? libraryArtists : []),
  ];
  const seen = new Set<string>();
  const seeds: SeedEntry[] = [];

  for (let index = 0; index < combined.length; index += 1) {
    const artist: ArtistDescriptor = combined[index];
    const mbid = normalizeMbid(artist?.mbid || artist?.id || artist?.foreignArtistId);
    const artistName = String(artist?.artistName || artist?.name || '').trim();
    if (!artistName) continue;

    const identityKeys = buildSeedIdentityKeys(mbid, artistName);
    if (identityKeys.length === 0) continue;
    const source = normalizeText(artist?.source) || 'library';
    const nextWeight = calculateSeedWeight(
      {
        source,
        playcount: artist?.playcount,
      },
      source === 'library' ? index : 0,
    );
    const profileBucket = normalizeText(artist?.profileBucket) || null;

    const existingKey = identityKeys.find((key) => seen.has(key));
    if (existingKey) {
      const existing = seeds.find((entry: SeedEntry) =>
        Array.isArray(entry.identityKeys)
          ? entry.identityKeys.some((key: string) => identityKeys.includes(key))
          : entry.mbid === mbid,
      );
      if (existing) {
        existing.weight = Math.max(existing.weight, nextWeight);
        existing.playcount = Math.max(
          Number(existing.playcount || 0),
          Number(artist?.playcount || 0),
        );
        existing.affinityWeight = Math.max(
          Number(existing.affinityWeight || 0),
          Number(artist?.affinityWeight || 0),
        );
        if (existing.source === 'library' && source !== 'library') {
          existing.source = source;
        }
        if (!existing.profileBucket && profileBucket) {
          existing.profileBucket = profileBucket;
        }
        for (const key of identityKeys) {
          if (!existing.identityKeys.includes(key)) {
            existing.identityKeys.push(key);
          }
          seen.add(key);
        }
        if (!existing.mbid && mbid) {
          existing.mbid = mbid;
        }
      }
      continue;
    }

    identityKeys.forEach((key) => seen.add(key));
    seeds.push({
      mbid,
      artistName,
      source,
      identityKeys,
      playcount: Math.max(0, Number(artist?.playcount || 0)),
      weight: nextWeight,
      affinityWeight: Math.max(nextWeight, Number(artist?.affinityWeight || 0) || nextWeight),
      profileBucket,
    });
  }

  return seeds.sort((left, right) => {
    if (right.affinityWeight !== left.affinityWeight) {
      return right.affinityWeight - left.affinityWeight;
    }
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }
    if (right.playcount !== left.playcount) {
      return right.playcount - left.playcount;
    }
    return left.artistName.localeCompare(right.artistName);
  });
};

const buildReasonCodes = ({
  tagOverlapCount,
  seedCoverage,
  sourceTypes,
  scoreNovelty,
  scorePopularityPenalty,
  discoveryMode,
  discoveryDepth,
}: ReasonParams): string[] => {
  const codes: string[] = [];
  if (tagOverlapCount >= 2) codes.push('tag_affinity_strong');
  else if (tagOverlapCount >= 1) codes.push('tag_affinity');
  if (seedCoverage >= 3) codes.push('multi_seed');
  else if (seedCoverage >= 2) codes.push('seed_consensus');
  if (discoveryDepth >= 2) codes.push('two_hop');
  if ((sourceTypes || []).some((entry: string) => entry !== 'library')) {
    codes.push('history_aligned');
  }
  if (scoreNovelty >= 18) codes.push('deeper_pick');
  if (scorePopularityPenalty >= 8) codes.push('mainstream_overlap');
  if (discoveryMode === 'deeper') codes.push('mode_deeper');
  if (discoveryMode === 'safer') codes.push('mode_safer');
  return [...new Set(codes)];
};

export const addRecommendationCandidate = (
  accumulator: Map<string, AccumulatorEntry>,
  {
    candidate = null,
    seed = null,
    sourceTags = [] as string[],
    profileTagWeights = new Map<string, number>(),
    existingArtistKeys = new Set<string>(),
  }: CandidateParams = {},
): void => {
  if (!accumulator || !candidate || !seed) return;

  const name = String(candidate?.name || '').trim();
  const mbid = normalizeMbid(candidate?.mbid);
  if (!name && !mbid) return;

  const candidateKeys = normalizeArtistIdentityKeys({
    id: mbid,
    name,
  });
  if (candidateKeys.some((key: string) => existingArtistKeys.has(key))) return;

  const candidateKey = mbid || `name:${normalizeText(name)}`;
  if (!candidateKey) return;

  const seedWeight = Number(seed?.weight || 1);
  const affinityWeight = Math.max(seedWeight, Number(seed?.affinityWeight || 0));
  const matchScore = clamp(Number(candidate?.match || 0), 0, 1);
  const similarityMultiplier = clamp(
    Number(candidate?.similarityMultiplier ?? seed?.similarityMultiplier ?? 1),
    0,
    1,
  );
  const tagAffinityMultiplier = clamp(
    Number(candidate?.tagAffinityMultiplier ?? seed?.tagAffinityMultiplier ?? 1),
    0,
    1,
  );
  const discoveryDepth = Math.max(
    1,
    Math.round(Number(candidate?.discoveryDepth ?? seed?.discoveryDepth ?? 1) || 1),
  );
  const normalizedTags = (Array.isArray(sourceTags) ? sourceTags : [])
    .map(normalizeText)
    .filter(Boolean);
  const matchedTags = normalizedTags.filter((tag: string) => profileTagWeights.has(tag));
  const tagWeightSum = matchedTags.reduce(
    (sum: number, tag: string) => sum + Number(profileTagWeights.get(tag) || 0),
    0,
  );
  const scoreSimilarity = Math.max(0, matchScore * 100 * seedWeight * similarityMultiplier);
  const scoreTagAffinity =
    Math.min(45, tagWeightSum * 6 + matchedTags.length * 3) * tagAffinityMultiplier;
  const perSeedContribution = scoreSimilarity + scoreTagAffinity + affinityWeight * 4;

  const existing = accumulator.get(candidateKey);
  if (existing) {
    existing.scoreSimilarity += scoreSimilarity;
    existing.scoreTagAffinity += scoreTagAffinity;
    existing.rawContribution += perSeedContribution;
    existing.bestMatch = Math.max(existing.bestMatch, matchScore);
    existing.tagOverlapCount += matchedTags.length;
    existing.seedWeights.push(seedWeight);
    existing.supportingSeeds.set(seed.artistName, {
      artistName: seed.artistName,
      source: seed.source || 'library',
      weight: seedWeight,
      profileBucket: seed.profileBucket || null,
    });
    existing.sourceTypes.add(seed.source || 'library');
    matchedTags.forEach((tag: string) => {
      existing.matchedTagWeights.set(
        tag,
        Math.max(
          Number(existing.matchedTagWeights.get(tag) || 0),
          Number(profileTagWeights.get(tag) || 0),
        ),
      );
    });
    if (!existing.image && candidate?.image) {
      existing.image = candidate.image;
    }
    mergeTags(existing.tags, normalizedTags);
    if (mbid && !existing.id) {
      existing.id = mbid;
    }
    existing.discoveryDepth = Math.min(
      Number(existing.discoveryDepth || discoveryDepth),
      discoveryDepth,
    );
    return;
  }

  const tags = new Set<string>();
  mergeTags(tags, normalizedTags);
  const matchedTagWeights = new Map<string, number>();
  matchedTags.forEach((tag: string) => {
    matchedTagWeights.set(tag, Number(profileTagWeights.get(tag) || 0));
  });
  accumulator.set(candidateKey, {
    id: mbid,
    name,
    type: 'Artist',
    image: candidate?.image || null,
    bestMatch: matchScore,
    rawContribution: perSeedContribution,
    scoreSimilarity,
    scoreTagAffinity,
    tagOverlapCount: matchedTags.length,
    tags,
    seedWeights: [seedWeight],
    matchedTagWeights,
    discoveryDepth,
    sourceTypes: new Set([seed.source || 'library']),
    supportingSeeds: new Map([
      [
        seed.artistName,
        {
          artistName: seed.artistName,
          source: seed.source || 'library',
          weight: seedWeight,
          profileBucket: seed.profileBucket || null,
        },
      ],
    ]),
  });
};

const finalizeRecommendationEntry = (
  entry: AccumulatorEntry,
  discoveryMode: string = 'balanced',
): FinalizedRecommendation => {
  const supportCount = entry.supportingSeeds.size;
  const matchedTags = topKeysFromMap(entry.matchedTagWeights, 4);
  const averageSeedWeight =
    entry.seedWeights.length > 0
      ? entry.seedWeights.reduce((sum: number, value: number) => sum + value, 0) / entry.seedWeights.length
      : 0;
  const scoreSeedCoverage = Math.min(
    28,
    Math.max(0, (supportCount - 1) * 8 + averageSeedWeight * 4),
  );
  const scoreNovelty = clamp(
    28 - supportCount * 3 - entry.bestMatch * 10 + matchedTags.length * 2,
    0,
    30,
  );
  const scorePopularityPenalty = clamp(
    supportCount * 2 + entry.bestMatch * 8 - scoreNovelty * 0.15,
    0,
    18,
  );
  const scoreDiversityPenalty = 0;
  const reasonCodes = buildReasonCodes({
    tagOverlapCount: entry.tagOverlapCount,
    seedCoverage: supportCount,
    sourceTypes: [...entry.sourceTypes],
    scoreNovelty,
    scorePopularityPenalty,
    discoveryMode,
    discoveryDepth: Number(entry.discoveryDepth || 1),
  });
  const confidence = clamp(
    Math.round(
      35 +
        Math.min(25, entry.bestMatch * 28) +
        Math.min(18, supportCount * 5) +
        Math.min(12, matchedTags.length * 3),
    ),
    20,
    98,
  );
  const discoveryTier =
    scoreNovelty >= 18 ? 'deeper' : entry.bestMatch >= 0.72 ? 'safer' : 'balanced';

  const baseTotal =
    entry.scoreSimilarity +
    entry.scoreTagAffinity +
    scoreSeedCoverage +
    scoreNovelty -
    scorePopularityPenalty;

  return {
    id: entry.id || null,
    name: entry.name,
    type: 'Artist',
    image: entry.image || null,
    tags: [...entry.tags],
    matchedTags,
    supportingSeeds: [...entry.supportingSeeds.values()]
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 4),
    seedCount: supportCount,
    score: Math.round(baseTotal),
    scoreTotal: Math.round(baseTotal),
    scoreSimilarity: Math.round(entry.scoreSimilarity),
    scoreTagAffinity: Math.round(entry.scoreTagAffinity),
    scoreSeedCoverage: Math.round(scoreSeedCoverage),
    scoreNovelty: Math.round(scoreNovelty),
    scoreDiversityPenalty,
    scorePopularityPenalty: Math.round(scorePopularityPenalty),
    sourceArtist: summarizeSourceArtists(entry.supportingSeeds.keys()),
    sourceArtists: [...entry.supportingSeeds.keys()],
    sourceType: entry.sourceTypes.size === 1 ? [...entry.sourceTypes][0] : 'blended',
    sourceTypes: [...entry.sourceTypes],
    sourceMix: [...entry.sourceTypes],
    discoveryDepth: Number(entry.discoveryDepth || 1),
    bestMatch: entry.bestMatch,
    reasonCodes,
    discoveryTier,
    confidence,
  };
};

export const finalizeRecommendationAccumulator = (
  accumulator: Map<string, AccumulatorEntry>,
  limit: number = 100,
  options: { discoveryMode?: string } = {},
): FinalizedRecommendation[] => {
  const discoveryMode = normalizeDiscoveryMode(options?.discoveryMode);
  return [...accumulator.values()]
    .map((entry: AccumulatorEntry) => finalizeRecommendationEntry(entry, discoveryMode))
    .filter((entry: FinalizedRecommendation) => entry.name)
    .sort((left: FinalizedRecommendation, right: FinalizedRecommendation) => {
      if (right.scoreTotal !== left.scoreTotal) {
        return right.scoreTotal - left.scoreTotal;
      }
      if (right.seedCount !== left.seedCount) {
        return right.seedCount - left.seedCount;
      }
      if (right.bestMatch !== left.bestMatch) {
        return right.bestMatch - left.bestMatch;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(1, Number(limit) || 100));
};

const normalizeFeedbackList = (value: unknown): FeedbackEntry[] =>
  (Array.isArray(value) ? value as FeedbackEntry[] : [])
    .filter((entry: FeedbackEntry) => entry && typeof entry === 'object')
    .filter((entry: FeedbackEntry) => {
      if (!entry.expiresAt) return true;
      const time = new Date(entry.expiresAt).getTime();
      return Number.isFinite(time) ? time > Date.now() : true;
    });

const feedbackBoostForCandidate = (
  candidate: ArtistDescriptor,
  feedbackList: FeedbackEntry[] = [],
): { adjustment: number; hidden: boolean } => {
  let adjustment = 0;
  let hidden = false;
  const candidateKeys = new Set(normalizeArtistIdentityKeys(candidate));
  const candidateTagSet = new Set(
    (Array.isArray(candidate.matchedTags) ? candidate.matchedTags : [])
      .map(normalizeText)
      .filter(Boolean),
  );

  for (const feedback of normalizeFeedbackList(feedbackList)) {
    const feedbackKeys = normalizeArtistIdentityKeys({
      id: feedback.artistId,
      mbid: feedback.artistId,
      name: feedback.artistName,
    });
    const exactMatch = feedbackKeys.some((key: string) => candidateKeys.has(key));
    const tagContext = (Array.isArray(feedback.tagContext) ? feedback.tagContext : [])
      .map(normalizeText)
      .filter(Boolean);
    const tagOverlap = tagContext.filter((tag: string) => candidateTagSet.has(tag)).length;
    const seedContext = (Array.isArray(feedback.seedContext) ? feedback.seedContext : [])
      .map(normalizeText)
      .filter(Boolean);
    const seedOverlap = (candidate.supportingSeeds || []).filter(
      (seed: SeedRef) => seedContext.includes(normalizeText(seed.artistName)),
    ).length;
    const contextualMatch = tagOverlap > 0 || seedOverlap > 0;

    switch (feedback.action) {
      case 'more_like_this':
        if (exactMatch) adjustment += 16;
        else if (contextualMatch) adjustment += 10 + tagOverlap * 2;
        break;
      case 'less_like_this':
        if (exactMatch) {
          hidden = true;
          adjustment -= 100000;
        } else if (contextualMatch) {
          adjustment -= 10 + tagOverlap * 2;
        }
        break;
      default:
        break;
    }
  }

  return { adjustment, hidden };
};

interface InternalCandidate extends ArtistDescriptor {
  __rerankBaseScore: number;
  __rerankFeedbackAdjustment: number;
  __rerankHidden: boolean;
  __rerankTags: string[];
  __rerankSeeds: string[];
}

export const rerankRecommendations = (
  recommendations: ArtistDescriptor[] = [],
  limit: number = 100,
  options: RerankOptions = {},
): ArtistDescriptor[] => {
  const mode = normalizeDiscoveryMode(options.discoveryMode);
  const multipliers = DISCOVERY_MODE_MULTIPLIERS[mode] || DISCOVERY_MODE_MULTIPLIERS.balanced;
  const input: InternalCandidate[] = (Array.isArray(recommendations) ? recommendations : [])
    .map((entry: ArtistDescriptor) => ({
      ...entry,
      matchedTags: Array.isArray(entry?.matchedTags)
        ? [...entry.matchedTags]
        : Array.isArray(entry?.tags)
          ? [...entry.tags].slice(0, 4)
          : [],
      supportingSeeds: Array.isArray(entry?.supportingSeeds)
        ? [...entry.supportingSeeds]
        : Array.isArray(entry?.sourceArtists)
          ? entry.sourceArtists.map((artistName: string) => ({
              artistName,
              source: entry?.sourceType || 'library',
              weight: 1,
            }))
          : [],
      sourceTypes: Array.isArray(entry?.sourceTypes)
        ? [...entry.sourceTypes]
        : entry?.sourceType
          ? [entry.sourceType]
          : [],
      sourceMix: Array.isArray(entry?.sourceMix)
        ? [...entry.sourceMix]
        : Array.isArray(entry?.sourceTypes)
          ? [...entry.sourceTypes]
          : entry?.sourceType
            ? [entry.sourceType]
            : [],
      reasonCodes: Array.isArray(entry?.reasonCodes) ? [...entry.reasonCodes] : [],
      discoveryTier: entry?.discoveryTier || mode,
      discoveryDepth: Number(entry?.discoveryDepth || 1) || 1,
      confidence: Number(entry?.confidence || 0) || 0,
      __rerankBaseScore: 0,
      __rerankFeedbackAdjustment: 0,
      __rerankHidden: false,
      __rerankTags: [],
      __rerankSeeds: [],
    } as InternalCandidate))
    .map((entry: InternalCandidate): InternalCandidate => {
      const candidateTags = [
        ...new Set(
          (Array.isArray(entry.matchedTags) ? entry.matchedTags : entry.tags || [])
            .map(normalizeText)
            .filter(Boolean),
        ),
      ];
      const candidateSeeds = [
        ...new Set(
          (Array.isArray(entry.supportingSeeds) ? entry.supportingSeeds : [])
            .map((seed: SeedRef) => normalizeText(seed?.artistName))
            .filter(Boolean),
        ),
      ];
      const { adjustment, hidden } = feedbackBoostForCandidate(entry, options.feedback || []);
      const baseScore =
        Number(entry.scoreSimilarity || 0) * multipliers.similarity +
        Number(entry.scoreTagAffinity || 0) * multipliers.tagAffinity +
        Number(entry.scoreSeedCoverage || 0) * multipliers.seedCoverage +
        Number(entry.scoreNovelty || 0) * multipliers.novelty -
        Number(entry.scorePopularityPenalty || 0) * multipliers.popularityPenalty +
        Number(entry.scoreFreshnessBoost || 0) -
        Number(entry.scoreAgingPenalty || 0);
      return {
        ...entry,
        __rerankBaseScore: baseScore,
        __rerankFeedbackAdjustment: adjustment,
        __rerankHidden: hidden,
        __rerankTags: candidateTags,
        __rerankSeeds: candidateSeeds,
      };
    })
    .filter((entry: InternalCandidate) => !entry.__rerankHidden)
    .sort((left: InternalCandidate, right: InternalCandidate) => {
      const leftScore = Number(left.scoreTotal || left.score || 0);
      const rightScore = Number(right.scoreTotal || right.score || 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      if ((right.seedCount || 0) !== (left.seedCount || 0)) {
        return (right.seedCount || 0) - (left.seedCount || 0);
      }
      return String(left.name || '').localeCompare(String(right.name || ''));
    });

  const selected: InternalCandidate[] = [];
  const pool: InternalCandidate[] = [...input];
  const selectedTagCounts = new Map<string, number>();
  const selectedSeedCounts = new Map<string, number>();
  const scoreCandidate = (candidate: InternalCandidate): InternalCandidate => {
    let diversityPenalty = 0;
    for (const tag of candidate.__rerankTags) {
      diversityPenalty += (selectedTagCounts.get(tag) || 0) * 1.8;
    }
    for (const seed of candidate.__rerankSeeds) {
      diversityPenalty += (selectedSeedCounts.get(seed) || 0) * 2.6;
    }
    const scoreTotal = Math.round(
      candidate.__rerankBaseScore -
        diversityPenalty * (multipliers.diversityPenalty || 1) +
        candidate.__rerankFeedbackAdjustment,
    );
    return {
      ...candidate,
      scoreDiversityPenalty: Math.round(diversityPenalty),
      scoreTotal,
      score: scoreTotal,
      hiddenByFeedback: false,
    };
  };
  const stripRerankMetadata = (candidate: InternalCandidate): ArtistDescriptor => {
    const {
      __rerankBaseScore: _base,
      __rerankFeedbackAdjustment: _adj,
      __rerankHidden: _hidden,
      __rerankTags: _tags,
      __rerankSeeds: _seeds,
      ...clean
    } = candidate;
    return clean;
  };
  const addSelectedSignals = (candidate: InternalCandidate): void => {
    for (const tag of candidate.__rerankTags) {
      selectedTagCounts.set(tag, (selectedTagCounts.get(tag) || 0) + 1);
    }
    for (const seed of candidate.__rerankSeeds) {
      selectedSeedCounts.set(seed, (selectedSeedCounts.get(seed) || 0) + 1);
    }
  };

  while (pool.length > 0 && selected.length < Math.max(1, Number(limit) || 100)) {
    let bestIndex = 0;
    let bestCandidate: InternalCandidate = scoreCandidate(pool[0]);

    for (let index = 1; index < pool.length; index += 1) {
      const candidate = scoreCandidate(pool[index]);
      if (bestCandidate.hiddenByFeedback || (candidate.scoreTotal != null && bestCandidate.scoreTotal != null && candidate.scoreTotal > bestCandidate.scoreTotal)) {
        bestCandidate = candidate;
        bestIndex = index;
      }
    }

    pool.splice(bestIndex, 1);
    addSelectedSignals(bestCandidate);
    selected.push(bestCandidate);
  }

  return selected.map(stripRerankMetadata);
};

export const filterRecommendationsForServe = (
  recommendations: ArtistDescriptor[] = [],
  feedback: FeedbackEntry[] = [],
): ArtistDescriptor[] =>
  (Array.isArray(recommendations) ? recommendations : []).filter(
    (recommendation: ArtistDescriptor) =>
      !feedbackBoostForCandidate(recommendation, feedback).hidden,
  );

const DAY_MS = 24 * 60 * 60 * 1000;

const parseTimeMs = (value: unknown, fallback: number = Date.now()): number => {
  const time = new Date(value as string || '').getTime();
  return Number.isFinite(time) ? time : fallback;
};

const getRecommendationPoolKeys = (recommendation: ArtistDescriptor): string[] => {
  const keys = normalizeArtistIdentityKeys(recommendation);
  if (keys.length > 0) return keys;
  const name = normalizeText(recommendation?.name);
  return name ? [`name:${name}`] : [];
};

export const syncRecommendationImages = (
  target: ArtistDescriptor[] = [],
  sources: ArtistDescriptor[] = [],
): ArtistDescriptor[] => {
  const imageByKey = new Map<string, string>();
  for (const recommendation of Array.isArray(sources) ? sources : []) {
    const image = recommendation?.image || recommendation?.imageUrl;
    if (!image) continue;
    if (shouldReplaceExistingImage(image)) continue;
    for (const key of getRecommendationPoolKeys(recommendation)) {
      imageByKey.set(key, image);
    }
  }
  for (const recommendation of Array.isArray(target) ? target : []) {
    if (recommendation?.image || recommendation?.imageUrl) continue;
    for (const key of getRecommendationPoolKeys(recommendation)) {
      const image = imageByKey.get(key);
      if (!image) continue;
      recommendation.image = image;
      recommendation.imageUrl = image;
      break;
    }
  }
  return target;
};

const buildRecommendationPoolMetadataMap = (
  recommendations: ArtistDescriptor[] = [],
): Map<string, PoolMetadata> => {
  const metadata = new Map<string, PoolMetadata>();
  for (const recommendation of Array.isArray(recommendations) ? recommendations : []) {
    const keys = getRecommendationPoolKeys(recommendation);
    if (keys.length === 0) continue;
    const entry: PoolMetadata = {
      firstDiscoveredAt:
        recommendation.firstDiscoveredAt ||
        recommendation.discoveredAt ||
        recommendation.lastRecommendedAt ||
        null,
      lastRecommendedAt:
        recommendation.lastRecommendedAt ||
        recommendation.discoveredAt ||
        recommendation.firstDiscoveredAt ||
        null,
    };
    for (const key of keys) {
      metadata.set(key, entry);
    }
  }
  return metadata;
};

const findRecommendationPoolMetadata = (
  recommendation: ArtistDescriptor,
  metadataMap: Map<string, PoolMetadata>,
): PoolMetadata | null => {
  for (const key of getRecommendationPoolKeys(recommendation)) {
    const metadata = metadataMap.get(key);
    if (metadata) return metadata;
  }
  return null;
};

const applyRecommendationPoolMetadata = (
  recommendation: ArtistDescriptor,
  { fresh = false, index = 0, metadata = null, runStartedAt, runStartedMs = Date.now() }: PoolMetaOptions = {},
): ArtistDescriptor => {
  const firstDiscoveredAt =
    metadata?.firstDiscoveredAt ||
    recommendation.firstDiscoveredAt ||
    recommendation.discoveredAt ||
    runStartedAt;
  const firstDiscoveredMs = parseTimeMs(firstDiscoveredAt, runStartedMs);
  const ageDays = Math.max(0, (runStartedMs - firstDiscoveredMs) / DAY_MS);
  const agingPenalty = fresh ? 0 : Math.min(80, Math.round(ageDays * 0.45));
  const freshnessBoost = fresh ? Math.max(8, 18 - index * 0.04) : 0;

  return {
    ...recommendation,
    firstDiscoveredAt,
    discoveredAt: recommendation.discoveredAt || firstDiscoveredAt,
    lastRecommendedAt: fresh
      ? runStartedAt
      : metadata?.lastRecommendedAt || recommendation.lastRecommendedAt || firstDiscoveredAt,
    recommendationPoolState: fresh ? 'fresh' : 'retained',
    scoreFreshnessBoost: Number(freshnessBoost.toFixed(2)),
    scoreAgingPenalty: Number(agingPenalty.toFixed(2)),
  };
};

export const mergeRetainedRecommendationPool = ({
  freshRecommendations = [] as ArtistDescriptor[],
  existingRecommendations = [] as ArtistDescriptor[],
  existingArtistKeys = new Set<string>(),
  limit = 500,
  runStartedAt = new Date().toISOString(),
  discoveryMode = 'balanced',
  feedback = [] as FeedbackEntry[],
}: MergeRetainedParams = {}): ArtistDescriptor[] => {
  const normalizedLimit = Math.max(1, Number(limit) || 500);
  const runStartedMs = parseTimeMs(runStartedAt);
  const existingMetadata = buildRecommendationPoolMetadataMap(existingRecommendations);
  const fresh = (Array.isArray(freshRecommendations) ? freshRecommendations : []).map(
    (recommendation: ArtistDescriptor, index: number) =>
      applyRecommendationPoolMetadata(recommendation, {
        fresh: true,
        index,
        metadata: findRecommendationPoolMetadata(recommendation, existingMetadata),
        runStartedAt,
        runStartedMs,
      }),
  );
  const retained = (Array.isArray(existingRecommendations) ? existingRecommendations : []).map(
    (recommendation: ArtistDescriptor, index: number) =>
      applyRecommendationPoolMetadata(recommendation, {
        fresh: false,
        index,
        runStartedAt,
        runStartedMs,
      }),
  );
  const merged: ArtistDescriptor[] = mergeResolvedRecommendations(
    [...fresh, ...retained],
    existingArtistKeys,
  );

  return rerankRecommendations(merged, normalizedLimit, {
    discoveryMode,
    feedback,
  }).map((recommendation: ArtistDescriptor, index: number) => ({
    ...recommendation,
    recommendationPoolRank: index + 1,
  }));
};

export const mergeResolvedRecommendations = (
  recommendations: ArtistDescriptor[] = [],
  existingArtistKeys: Set<string> = new Set(),
): ArtistDescriptor[] => {
  const merged = new Map<string, ArtistDescriptor>();
  const aliases = new Map<string, string>();

  for (const recommendation of Array.isArray(recommendations) ? recommendations : []) {
    const keys = normalizeArtistIdentityKeys(recommendation);
    if (keys.some((key: string) => existingArtistKeys.has(key))) continue;

    const identityKeys: string[] = [
      normalizeMbid(recommendation?.id),
      `name:${normalizeText(recommendation?.name)}`,
    ].filter((val: string | null): val is string => typeof val === 'string');
    if (identityKeys.length === 0) continue;
    const existingIdentity = identityKeys.find((key) => aliases.has(key));
    const identity: string = existingIdentity || identityKeys[0]!;

    const existing = merged.get(identity);
    if (!existing) {
      const entry: ArtistDescriptor = {
        ...recommendation,
        tags: Array.isArray(recommendation?.tags) ? [...recommendation.tags] : [],
        matchedTags: Array.isArray(recommendation?.matchedTags)
          ? [...recommendation.matchedTags]
          : [],
        sourceArtists: Array.isArray(recommendation?.sourceArtists)
          ? [...recommendation.sourceArtists]
          : [],
        sourceTypes: Array.isArray(recommendation?.sourceTypes)
          ? [...recommendation.sourceTypes]
          : recommendation?.sourceType
            ? [recommendation.sourceType]
            : [],
        supportingSeeds: Array.isArray(recommendation?.supportingSeeds)
          ? [...recommendation.supportingSeeds]
          : [],
        sourceMix: Array.isArray(recommendation?.sourceMix) ? [...recommendation.sourceMix] : [],
        reasonCodes: Array.isArray(recommendation?.reasonCodes)
          ? [...recommendation.reasonCodes]
          : [],
        popularityLabel: recommendation?.popularityLabel || null,
        popularityRank: recommendation?.popularityRank || null,
        listeners: Number(recommendation?.listeners || 0) || 0,
        playcount: Number(recommendation?.playcount || 0) || 0,
        discoveryDepth: Number(recommendation?.discoveryDepth || 1) || 1,
      };
      merged.set(identity, entry);
      for (const key of identityKeys) {
        aliases.set(key, identity);
      }
      continue;
    }

    existing.id = existing.id || recommendation.id || null;
    existing.navigateTo =
      existing.navigateTo || recommendation.navigateTo || recommendation.id || null;
    existing.image = existing.image || recommendation.image || null;
    existing.popularityLabel = existing.popularityLabel || recommendation.popularityLabel || null;
    existing.popularityRank = existing.popularityRank || recommendation.popularityRank || null;
    existing.listeners = Math.max(
      Number(existing.listeners || 0),
      Number(recommendation.listeners || 0),
    );
    existing.playcount = Math.max(
      Number(existing.playcount || 0),
      Number(recommendation.playcount || 0),
    );
    existing.score = Math.max(Number(existing.score || 0), Number(recommendation.score || 0));
    existing.scoreTotal = Math.max(
      Number(existing.scoreTotal || 0),
      Number(recommendation.scoreTotal || recommendation.score || 0),
    );
    existing.scoreSimilarity = Math.max(
      Number(existing.scoreSimilarity || 0),
      Number(recommendation.scoreSimilarity || 0),
    );
    existing.scoreTagAffinity = Math.max(
      Number(existing.scoreTagAffinity || 0),
      Number(recommendation.scoreTagAffinity || 0),
    );
    existing.scoreSeedCoverage = Math.max(
      Number(existing.scoreSeedCoverage || 0),
      Number(recommendation.scoreSeedCoverage || 0),
    );
    existing.scoreNovelty = Math.max(
      Number(existing.scoreNovelty || 0),
      Number(recommendation.scoreNovelty || 0),
    );
    existing.scorePopularityPenalty = Math.max(
      Number(existing.scorePopularityPenalty || 0),
      Number(recommendation.scorePopularityPenalty || 0),
    );
    existing.seedCount = Math.max(
      Number(existing.seedCount || 0),
      Number(recommendation.seedCount || 0),
    );
    existing.confidence = Math.max(
      Number(existing.confidence || 0),
      Number(recommendation.confidence || 0),
    );
    existing.discoveryTier = existing.discoveryTier || recommendation.discoveryTier || 'balanced';
    existing.discoveryDepth = Math.min(
      Number(existing.discoveryDepth || recommendation.discoveryDepth || 1) || 1,
      Number(recommendation.discoveryDepth || 1) || 1,
    );
    existing.sourceArtists = [
      ...new Set([
        ...(existing.sourceArtists || []),
        ...(Array.isArray(recommendation?.sourceArtists)
          ? recommendation.sourceArtists
          : recommendation?.sourceArtist
            ? [recommendation.sourceArtist]
            : []),
      ]),
    ];
    existing.sourceTypes = [
      ...new Set([
        ...(existing.sourceTypes || []),
        ...(Array.isArray(recommendation?.sourceTypes)
          ? recommendation.sourceTypes
          : recommendation?.sourceType
            ? [recommendation.sourceType]
            : []),
      ]),
    ];
    existing.sourceMix = [
      ...new Set([
        ...(existing.sourceMix || []),
        ...(Array.isArray(recommendation?.sourceMix) ? recommendation.sourceMix : []),
      ]),
    ];
    existing.reasonCodes = [
      ...new Set([
        ...(existing.reasonCodes || []),
        ...(Array.isArray(recommendation?.reasonCodes) ? recommendation.reasonCodes : []),
      ]),
    ];
    existing.tags = [
      ...new Set([
        ...(existing.tags || []),
        ...(Array.isArray(recommendation?.tags) ? recommendation.tags : []),
      ]),
    ];
    existing.matchedTags = [
      ...new Set([
        ...(existing.matchedTags || []),
        ...(Array.isArray(recommendation?.matchedTags) ? recommendation.matchedTags : []),
      ]),
    ];
    existing.supportingSeeds = [
      ...new Map(
        [...(existing.supportingSeeds || []), ...(recommendation.supportingSeeds || [])]
          .filter((seed: SeedRef) => seed?.artistName)
          .map((seed: SeedRef) => [normalizeText(seed.artistName), seed]),
      ).values(),
    ];
    for (const key of identityKeys) {
      aliases.set(key, identity);
    }
  }

  return [...merged.values()].map((entry: ArtistDescriptor) => ({
    ...entry,
    sourceArtist: summarizeSourceArtists(entry.sourceArtists || []),
    sourceType:
      Array.isArray(entry.sourceTypes) && entry.sourceTypes.length === 1
        ? entry.sourceTypes[0]
        : 'blended',
    sourceMix:
      Array.isArray(entry.sourceMix) && entry.sourceMix.length > 0
        ? entry.sourceMix
        : Array.isArray(entry.sourceTypes)
          ? entry.sourceTypes
          : [],
    matchedTags:
      Array.isArray(entry.matchedTags) && entry.matchedTags.length > 0
        ? entry.matchedTags.slice(0, 4)
        : Array.isArray(entry.tags)
          ? entry.tags.slice(0, 4)
          : [],
    supportingSeeds: Array.isArray(entry.supportingSeeds)
      ? entry.supportingSeeds
          .sort((left: SeedRef, right: SeedRef) => Number(right.weight || 0) - Number(left.weight || 0))
          .slice(0, 4)
      : [],
  }));
};

const collectRecommendationTags = (recommendation: ArtistDescriptor): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const tag of [
    ...(Array.isArray(recommendation?.matchedTags) ? recommendation.matchedTags : []),
    ...(Array.isArray(recommendation?.tags) ? recommendation.tags : []),
  ]) {
    const normalized = normalizeText(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
};

const recommendationArtistKey = (recommendation: ArtistDescriptor): string | null =>
  normalizeMbid(recommendation?.id || recommendation?.mbid) ||
  normalizeText(recommendation?.name || recommendation?.artistName);

const isGenreLikeTag = (tag: string): boolean => {
  const normalized = normalizeText(tag);
  if (!normalized) return false;
  return GENRE_KEYWORDS.some((keyword: string) => normalized.includes(keyword));
};

const deriveTagArtistCounts = (
  recommendations: ArtistDescriptor[] = [],
): Map<string, Set<string>> => {
  const counts = new Map<string, Set<string>>();
  for (const recommendation of recommendations) {
    const artistKey = recommendationArtistKey(recommendation);
    if (!artistKey) continue;
    for (const tag of collectRecommendationTags(recommendation)) {
      if (!counts.has(tag)) counts.set(tag, new Set<string>());
      counts.get(tag)!.add(artistKey);
    }
  }
  return counts;
};

export const deriveDiscoveryTagsFromPool = (
  recommendations: ArtistDescriptor[] = [],
  { limit = 30, minArtists = 2 }: DiscoveryTagsOptions = {},
): string[] =>
  sortByValueThenName(
    [...deriveTagArtistCounts(recommendations).entries()].map(([tag, artists]) => [
      tag,
      artists.size,
    ]),
  )
    .filter(([, count]) => count >= minArtists)
    .slice(0, limit)
    .map(([tag]) => tag);

export const deriveDiscoveryGenresFromPool = (
  recommendations: ArtistDescriptor[] = [],
  { limit = 32, minArtists = 4 }: DiscoveryTagsOptions = {},
): string[] =>
  sortByValueThenName(
    [...deriveTagArtistCounts(recommendations).entries()]
      .filter(([tag]) => isGenreLikeTag(tag))
      .map(([tag, artists]) => [tag, artists.size]),
  )
    .filter(([, count]) => count >= minArtists)
    .slice(0, limit)
    .map(([tag]) => tag);
