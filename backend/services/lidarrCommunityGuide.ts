export async function applyLidarrCommunityGuide(lidarrClient: Record<string, unknown>) {
  const results: {
    qualityDefinitions: Record<string, unknown>[];
    customFormats: Record<string, unknown>[];
    releaseProfile: Record<string, unknown> | null;
    metadataProfile: Record<string, unknown> | null;
    namingConfig: Record<string, unknown> | null;
    qualityProfile: Record<string, unknown> | null;
    errors: string[];
  } = {
    qualityDefinitions: [],
    customFormats: [],
    releaseProfile: null,
    metadataProfile: null,
    namingConfig: null,
    qualityProfile: null,
    errors: [],
  };

  const qualityDefs = (lidarrClient.getQualityDefinitions as () => Promise<Record<string, unknown>[]>)();
  const awaitedQualityDefs = await qualityDefs;

  const flacDef = awaitedQualityDefs.find((q: Record<string, unknown>) => (q.quality as Record<string, unknown>)?.name === 'FLAC' || q.title === 'FLAC');
  const flac24Def = awaitedQualityDefs.find(
    (q: Record<string, unknown>) => (q.quality as Record<string, unknown>)?.name === 'FLAC 24bit' || q.title === 'FLAC 24bit',
  );

  if (flacDef) {
    await (lidarrClient.updateQualityDefinition as (id: unknown, data: Record<string, unknown>) => Promise<void>)(flacDef.id, {
      ...flacDef,
      minSize: 0,
      maxSize: 1400,
      preferredSize: 895,
    });
    results.qualityDefinitions.push({
      name: 'FLAC',
      updated: { min: 0, max: 1400, preferred: 895 },
    });
  }

  if (flac24Def) {
    await (lidarrClient.updateQualityDefinition as (id: unknown, data: Record<string, unknown>) => Promise<void>)(flac24Def.id, {
      ...flac24Def,
      minSize: 0,
      maxSize: 1495,
      preferredSize: 895,
    });
    results.qualityDefinitions.push({
      name: 'FLAC 24bit',
      updated: { min: 0, max: 1495, preferred: 895 },
    });
  }

  const customFormats = [
    {
      name: 'Preferred Groups',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'DeVOiD',
          implementation: 'ReleaseGroupSpecification',
          negate: false,
          required: false,
          fields: { value: '\\bDeVOiD\\b' },
        },
        {
          name: 'PERFECT',
          implementation: 'ReleaseGroupSpecification',
          negate: false,
          required: false,
          fields: { value: '\\bPERFECT\\b' },
        },
        {
          name: 'ENRiCH',
          implementation: 'ReleaseGroupSpecification',
          negate: false,
          required: false,
          fields: { value: '\\bENRiCH\\b' },
        },
      ],
    },
    {
      name: 'CD',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'CD',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: false,
          fields: { value: '\\bCD\\b' },
        },
      ],
    },
    {
      name: 'WEB',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'WEB',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: false,
          fields: { value: '\\bWEB\\b' },
        },
      ],
    },
    {
      name: 'Lossless',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'Flac',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: false,
          fields: { value: '\\blossless\\b' },
        },
      ],
    },
    {
      name: 'Vinyl',
      includeCustomFormatWhenRenaming: false,
      specifications: [
        {
          name: 'Vinyl',
          implementation: 'ReleaseTitleSpecification',
          negate: false,
          required: false,
          fields: { value: '\\bVinyl\\b' },
        },
      ],
    },
  ];

  const toFieldArray = (fields: Record<string, unknown> | unknown[] | null | undefined) => {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return fields;
    }
    return Object.entries(fields)
      .filter(([, value]: [string, unknown]) => value !== undefined && value !== null)
      .map(([name, value]: [string, unknown]) => ({ name, value }));
  };

  const flattenFields = (fields: Record<string, unknown> | unknown[] | null | undefined) => {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(fields).filter(([, value]: [string, unknown]) => value !== undefined && value !== null),
    );
  };

  const buildCustomFormatPayloadVariants = (format: Record<string, unknown>) => {
    const base = JSON.parse(JSON.stringify(format)) as Record<string, unknown>;
    const variants: Record<string, unknown>[] = [base];

    const withFieldArray: Record<string, unknown> = {
      ...base,
      specifications: Array.isArray(base.specifications)
        ? (base.specifications as Record<string, unknown>[]).map((spec: Record<string, unknown>) => ({
            ...spec,
            fields: toFieldArray(spec?.fields as Record<string, unknown>),
          }))
        : base.specifications,
    };
    variants.push(withFieldArray);

    const withFlattenedFields: Record<string, unknown> = {
      ...base,
      specifications: Array.isArray(base.specifications)
        ? (base.specifications as Record<string, unknown>[]).map((spec: Record<string, unknown>) => {
            const fields = flattenFields(spec?.fields as Record<string, unknown>);
            const normalizedSpec = { ...spec, ...fields } as Record<string, unknown>;
            delete normalizedSpec.fields;
            return normalizedSpec;
          })
        : base.specifications,
    };
    variants.push(withFlattenedFields);

    const seen = new Set<string>();
    return variants.filter((variant: Record<string, unknown>) => {
      const key = JSON.stringify(variant);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const createCustomFormatWithFallback = async (format: Record<string, unknown>) => {
    const payloads = buildCustomFormatPayloadVariants(format);
    let lastError: Error | null = null;

    for (const payload of payloads) {
      try {
        return await (lidarrClient.createCustomFormat as (data: Record<string, unknown>) => Promise<Record<string, unknown>>)(payload);
      } catch (err: unknown) {
        lastError = err as Error;
        const message = String((err as Error)?.message || '');
        const isBadRequest =
          message.includes('400 Bad Request') || message.includes('Lidarr API error: 400');
        if (!isBadRequest) {
          throw err;
        }
      }
    }

    throw lastError || new Error('Failed to create custom format');
  };

  const existingFormats = await (lidarrClient.getCustomFormats as () => Promise<Record<string, unknown>[]>)();
  for (const format of customFormats) {
    const existing = existingFormats.find((f: Record<string, unknown>) => f.name === format.name);
    if (!existing) {
      try {
        const created = await createCustomFormatWithFallback(format);
        results.customFormats.push(created);
      } catch (err: unknown) {
        results.errors.push(`Failed to create custom format "${format.name}": ${(err as Error).message}`);
      }
    } else {
      results.customFormats.push(existing);
    }
  }

  const releaseProfilePayload = {
    name: 'Aurral - Single Track Rip Filter',
    enabled: true,
    required: [],
    ignored: ['CUE', 'FLAC/CUE'],
    preferred: [],
    tags: [],
  };

  const existingReleaseProfiles = await (lidarrClient.getReleaseProfiles as () => Promise<Record<string, unknown>[]>)();
  const normalizeReleaseName = (value: unknown) =>
    String(value || '')
      .trim()
      .toLowerCase();
  const hasIgnoredMatch = (profile: Record<string, unknown> | null, value: unknown) =>
    Array.isArray(profile?.ignored) &&
    (profile.ignored as string[])
      .map((item: unknown) => String(item || '').toLowerCase())
      .includes(String(value || '').toLowerCase());
  const existingReleaseProfile = existingReleaseProfiles.find((profile: Record<string, unknown>) => {
    if (!profile) return false;
    if (normalizeReleaseName(profile.name) === normalizeReleaseName(releaseProfilePayload.name)) {
      return true;
    }
    return hasIgnoredMatch(profile, 'CUE') && hasIgnoredMatch(profile, 'FLAC/CUE');
  });

  if (existingReleaseProfile) {
    const updatedReleaseProfile = await (lidarrClient.updateReleaseProfile as (id: unknown, data: Record<string, unknown>) => Promise<Record<string, unknown>>)(
      existingReleaseProfile.id,
      {
        ...releaseProfilePayload,
        id: existingReleaseProfile.id,
      },
    );
    results.releaseProfile = {
      id: updatedReleaseProfile.id,
      name: updatedReleaseProfile.name,
      updated: true,
    };
  } else {
    const createdReleaseProfile = await (lidarrClient.createReleaseProfile as (data: Record<string, unknown>) => Promise<Record<string, unknown>>)(releaseProfilePayload);
    results.releaseProfile = {
      id: createdReleaseProfile.id,
      name: createdReleaseProfile.name,
    };
  }

  const metadataProfiles = await (lidarrClient.getMetadataProfiles as () => Promise<Record<string, unknown>[]>)();
  const aurralMetadataProfile = metadataProfiles.find(
    (profile: Record<string, unknown>) => profile.name === 'Aurral - Standard',
  );
  const standardProfile = metadataProfiles.find((profile: Record<string, unknown>) => profile.name === 'Standard');
  const baseMetadataProfile = aurralMetadataProfile || standardProfile || metadataProfiles[0];

  if (!baseMetadataProfile) {
    throw new Error('No metadata profiles available in Lidarr');
  }

  const desiredPrimaryTypes = ['Album', 'EP', 'Single'];
  const desiredSecondaryTypes = ['Studio', 'Soundtrack', 'Remix', 'DJ-mix', 'Compilation'];

  const normalizeTypeName = (value: unknown) =>
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const getTypeName = (item: Record<string, unknown> | string | null | undefined) => {
    if (!item) return '';
    if (typeof item === 'string') return item;
    if (typeof (item as Record<string, unknown>).name === 'string') return (item as Record<string, unknown>).name as string;
    if (typeof (item as Record<string, unknown>).value === 'string') return (item as Record<string, unknown>).value as string;
    if (typeof ((item as Record<string, unknown>).albumType as Record<string, unknown>)?.name === 'string') return ((item as Record<string, unknown>).albumType as Record<string, unknown>).name as string;
    return '';
  };

  const applyTypeSelection = (available: Record<string, unknown>[], desired: string[]) => {
    if (!Array.isArray(available) || available.length === 0) {
      return desired.map((name: string) => ({ name, allowed: true }));
    }
    const desiredSet = new Set(desired.map((name: string) => normalizeTypeName(name)));
    return available.map((item: Record<string, unknown>) => {
      const itemName = getTypeName(item);
      const allowed = desiredSet.has(normalizeTypeName(itemName));
      if (typeof item === 'string') {
        return { name: item, allowed };
      }
      return { ...item, allowed };
    });
  };

  const metadataProfilePayload = {
    ...baseMetadataProfile,
    name: 'Aurral - Standard',
    primaryAlbumTypes: applyTypeSelection(
      baseMetadataProfile.primaryAlbumTypes as Record<string, unknown>[],
      desiredPrimaryTypes,
    ),
    secondaryAlbumTypes: applyTypeSelection(
      baseMetadataProfile.secondaryAlbumTypes as Record<string, unknown>[],
      desiredSecondaryTypes,
    ),
  };

  if (aurralMetadataProfile) {
    const updatedMetadataProfile = await (lidarrClient.updateMetadataProfile as (id: unknown, data: Record<string, unknown>) => Promise<Record<string, unknown>>)(
      aurralMetadataProfile.id,
      metadataProfilePayload,
    );
    results.metadataProfile = {
      id: updatedMetadataProfile.id,
      name: updatedMetadataProfile.name,
      updated: true,
    };
  } else {
    const { ...createPayload } = metadataProfilePayload;
    const createdMetadataProfile = await (lidarrClient.createMetadataProfile as (data: Record<string, unknown>) => Promise<Record<string, unknown>>)(createPayload);
    results.metadataProfile = {
      id: createdMetadataProfile.id,
      name: createdMetadataProfile.name,
    };
  }

  const namingConfig = await (lidarrClient.getNamingConfig as () => Promise<Record<string, unknown>>)();
  const updatedNamingConfig = {
    ...namingConfig,
    renameTracks: true,
    replaceIllegalCharacters: true,
    standardTrackFormat:
      '{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}',
    multiDiscTrackFormat:
      '{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}',
    artistFolderFormat: '{Artist Name}',
  };

  await (lidarrClient.updateNamingConfig as (data: Record<string, unknown>) => Promise<void>)(updatedNamingConfig);
  results.namingConfig = updatedNamingConfig;

  const existingProfiles = await (lidarrClient.getQualityProfiles as () => Promise<Record<string, unknown>[]>)();
  let aurralProfile = existingProfiles.find((profile: Record<string, unknown>) => profile.name === 'Aurral - HQ') || null;
  const baseProfile = aurralProfile || existingProfiles[0];

  if (!baseProfile) {
    throw new Error('No quality profiles available in Lidarr');
  }

  const selectedQualityNames = ['MP3-320', 'FLAC'];
  const baseItems = JSON.parse(JSON.stringify(baseProfile.items || [])) as Record<string, unknown>[];
  const qualityItemMap = new Map<string, Record<string, unknown>>();

  const collectQualityItems = (items: Record<string, unknown>[]) => {
    for (const item of items) {
      if ((item.quality as Record<string, unknown>)?.name) {
        qualityItemMap.set((item.quality as Record<string, unknown>).name as string, item);
      }
      if (Array.isArray(item.items)) {
        collectQualityItems(item.items as Record<string, unknown>[]);
      }
    }
  };

  collectQualityItems(baseItems);

  const qualityDefItems = (awaitedQualityDefs || []).map((definition: Record<string, unknown>) => ({
    id: definition.id,
    name: definition.title || (definition.quality as Record<string, unknown>)?.name,
    quality: {
      id: (definition.quality as Record<string, unknown>)?.id,
      name: (definition.quality as Record<string, unknown>)?.name || definition.title,
    },
    allowed: false,
    items: [],
  }));

  for (const defItem of qualityDefItems) {
    if (defItem.quality?.name && !qualityItemMap.has((defItem.quality as Record<string, unknown>).name as string)) {
      qualityItemMap.set((defItem.quality as Record<string, unknown>).name as string, defItem);
    }
  }

  const normalizeQualityItem = (item: Record<string, unknown>, allowed: boolean) => ({
    ...item,
    allowed,
    items: [],
  });

  const selectedItems = selectedQualityNames
    .map((name: string) => qualityItemMap.get(name))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item: Record<string, unknown>) => normalizeQualityItem(item, true));

  const otherItems = Array.from(qualityItemMap.entries())
    .filter(([name]: [string, Record<string, unknown>]) => !selectedQualityNames.includes(name))
    .map(([, item]: [string, Record<string, unknown>]) => normalizeQualityItem(item, false));

  const profileItems = [...otherItems, ...selectedItems];
  const flacQualityItem = qualityItemMap.get('FLAC');
  const flacQualityId = flacQualityItem ? (flacQualityItem.quality as Record<string, unknown>)?.id : undefined;

  const scores: Record<string, number> = {
    'Preferred Groups': 10,
    CD: 2,
    WEB: 1,
    Lossless: 1,
    Vinyl: -5,
  };

  const formatItems = results.customFormats.map((cf: Record<string, unknown>) => {
    return {
      format: cf.id,
      name: cf.name,
      score: scores[cf.name as string] || 0,
    };
  });

  if (formatItems.length === 0) {
    results.errors.push('No custom formats were created; quality profile minFormatScore set to 0.');
  }

  const profileData = {
    ...baseProfile,
    name: 'Aurral - HQ',
    upgradeAllowed: true,
    cutoff: flacQualityId ?? baseProfile.cutoff,
    items: profileItems,
    minFormatScore: formatItems.length > 0 ? 1 : 0,
    cutoffFormatScore: 0,
    formatItems,
  };

  if (!aurralProfile) {
    const { ...createPayload } = profileData;
    aurralProfile = await (lidarrClient.createQualityProfile as (data: Record<string, unknown>) => Promise<Record<string, unknown>>)(createPayload);
    results.qualityProfile = {
      id: aurralProfile.id,
      name: aurralProfile.name,
    };
  } else {
    const updatedProfile = await (lidarrClient.updateQualityProfile as (id: unknown, data: Record<string, unknown>) => Promise<Record<string, unknown>>)(aurralProfile.id, profileData);
    results.qualityProfile = {
      id: updatedProfile.id,
      name: updatedProfile.name,
      updated: true,
    };
  }

  return results;
}
