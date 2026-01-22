import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const applyOptimalLidarrSettings = async (lidarrRequest, options = {}) => {
  try {
    console.log("Starting Lidarr optimization process...", options);

    // --- 1. Custom Formats ---
    const customFormats = [
      {
        name: "Preferred Groups",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "DeVOiD",
            implementation: "ReleaseGroupSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\bDeVOiD\\b" }],
          },
          {
            name: "PERFECT",
            implementation: "ReleaseGroupSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\bPERFECT\\b" }],
          },
          {
            name: "ENRiCH",
            implementation: "ReleaseGroupSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\bENRiCH\\b" }],
          },
        ],
      },
      {
        name: "CD",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "CD",
            implementation: "ReleaseTitleSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\bCD\\b" }],
          },
        ],
      },
      {
        name: "WEB",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "WEB",
            implementation: "ReleaseTitleSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\bWEB\\b" }],
          },
        ],
      },
      {
        name: "Lossless",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "Flac",
            implementation: "ReleaseTitleSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\blossless\\b" }],
          },
        ],
      },
      {
        name: "Vinyl",
        includeCustomFormatWhenRenaming: false,
        specifications: [
          {
            name: "Vinyl",
            implementation: "ReleaseTitleSpecification",
            negate: false,
            required: false,
            fields: [{ name: "value", value: "\\bVinyl\\b" }],
          },
        ],
      },

    ];

    const existingCFs = await lidarrRequest("/customformat");
    const cfMap = {};

    for (const cf of customFormats) {
      const existing = existingCFs.find((e) => e.name === cf.name);
      let cfId;
      if (existing) {
        console.log(`Custom Format "${cf.name}" already exists, updating...`);
        const updated = await lidarrRequest(
          `/customformat/${existing.id}`,
          "PUT",
          { ...cf, id: existing.id },
        );
        cfId = updated.id;
      } else {
        console.log(`Creating Custom Format "${cf.name}"...`);
        const created = await lidarrRequest("/customformat", "POST", cf);
        cfId = created.id;
      }

      cfMap[cf.name] = cfId;
    }

    // --- 2. Quality Profile "Aurral - HQ" ---
    console.log("Configuring 'Aurral - HQ' Profile...");
    const qualityProfiles = await lidarrRequest("/qualityprofile");
    let profile = qualityProfiles.find((p) => p.name === "Aurral - HQ") || qualityProfiles.find((p) => p.name === "High Quality");
    
    // We need to fetch the schema to understand the structure of a new profile
    const profileSchema = await lidarrRequest("/qualityprofile/schema");
    
    // Map required formats to scores as per guide
    const formatScores = [
      { formatId: cfMap["Preferred Groups"], score: 100 },
      { formatId: cfMap["Lossless"], score: 1 },
      { formatId: cfMap["CD"], score: 1 },
      { formatId: cfMap["WEB"], score: 1 },
      { formatId: cfMap["Vinyl"], score: -10000 },

    ];

    // Helper to find quality and return the top-level item and the quality ID
    const findAndEnableQuality = (items, name) => {
        for (const item of items) {
            // Check standalone
            if (item.quality?.name?.toLowerCase().replace(/[- ]/g, '') === name.toLowerCase().replace(/[- ]/g, '')) {
                item.allowed = true;
                return { 
                  topLevelId: item.id || item.quality.id, 
                  qualityId: item.quality.id 
                };
            }
            // Check groups
            if (item.items && item.items.length > 0) {
                for (const subItem of item.items) {
                    if (subItem.quality?.name?.toLowerCase().replace(/[- ]/g, '') === name.toLowerCase().replace(/[- ]/g, '')) {
                        subItem.allowed = true;
                        item.allowed = true;
                        return { 
                          topLevelId: item.id || subItem.quality.id, 
                          qualityId: subItem.quality.id 
                        };
                    }
                }
            }
        }
        return null;
    };
    
    let itemsToConfigure = profile ? profile.items : profileSchema.items;

    // Reset all
    const resetAllowed = (items) => {
        items.forEach(item => {
            item.allowed = false;
            if (item.items) resetAllowed(item.items);
        });
    };
    resetAllowed(itemsToConfigure);

    // Enable FLAC and MP3 320
    const flacResult = findAndEnableQuality(itemsToConfigure, "FLAC");
    const mp3320Result = findAndEnableQuality(itemsToConfigure, "MP3 320") || findAndEnableQuality(itemsToConfigure, "MP3 320kbps");

    // Reorder items to bring allowed ones to the top
    itemsToConfigure.sort((a, b) => {
        if (a.allowed && !b.allowed) return -1;
        if (!a.allowed && b.allowed) return 1;
        return 0;
    });

    const profileData = {
      ...(profile || profileSchema),
      name: "Aurral - HQ",
      upgradeAllowed: true,
      cutoff: flacResult ? flacResult.topLevelId : (itemsToConfigure.find(i => i.allowed)?.id || itemsToConfigure.find(i => i.allowed)?.quality?.id || 0),
      items: itemsToConfigure,
      formatItems: formatScores.map(fs => ({
          format: fs.formatId,
          score: fs.score
      })),
      minFormatScore: 1 
    };
    
    // Ensure we preserve ID if updating
    if (profile) {
      profileData.id = profile.id;
      await lidarrRequest(`/qualityprofile/${profile.id}`, "PUT", profileData);
      console.log(`Updated '${profileData.name}' profile.`);
    } else {
        // Create new
       // Remove ID from schema if present to avoid conflicts on creation
       delete profileData.id; 



        const created = await lidarrRequest("/qualityprofile", "POST", profileData);
        profileData.id = created.id;
       console.log("Created 'Aurral - HQ' profile.");
    }

    // --- 3. Naming Config ---
    console.log("Updating Naming Configuration...");
    const namingConfig = await lidarrRequest("/config/naming");
    await lidarrRequest("/config/naming", "PUT", {
      ...namingConfig,
      renameTracks: true,
      replaceIllegalCharacters: true,
      standardTrackFormat: "{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{track:00}_{Track Title}",
      multiDiscTrackFormat: "{Album Title} {(Album Disambiguation)}/{Artist Name}_{Album Title}_{medium:00}-{track:00}_{Track Title}",
      artistFolderFormat: "{Artist Name}",
    });

    // --- 4. Metadata Profile ---
    let standardProfileId = null;
    if (options.enableMetadataProfile && options.releaseTypes) {
      console.log("Updating Metadata Profile 'Aurral - Standard'...");
      
      const metadataProfiles = await lidarrRequest("/metadataprofile");
      let standardProfile = metadataProfiles.find((p) => p.name === "Aurral - Standard") || metadataProfiles.find((p) => p.name === "Standard");

      if (standardProfile) {
          const typesToEnable = options.releaseTypes;
          
          if (standardProfile.primaryAlbumTypes) {
              standardProfile.primaryAlbumTypes.forEach(typeObj => {
                  if (typesToEnable.includes(typeObj.albumType.name)) {
                      typeObj.allowed = true;
                  }
              });
              
              // Ensure name is set to Aurral - Standard even if it was "Standard" before
              standardProfile.name = "Aurral - Standard";

              await lidarrRequest(`/metadataprofile/${standardProfile.id}`, "PUT", standardProfile);
              console.log("Updated 'Aurral - Standard' Metadata Profile.");
              standardProfileId = standardProfile.id;
          }
      }
    } else {
      console.log("Skipping Metadata Profile update (not requested or no types provided).");
      // Still try to find the ID if it exists for default setting purposes
      const metadataProfiles = await lidarrRequest("/metadataprofile");
      const standardProfile = metadataProfiles.find((p) => p.name === "Aurral - Standard") || metadataProfiles.find((p) => p.name === "Standard");
      if (standardProfile) standardProfileId = standardProfile.id;
    }

    return {
      success: true,
      message: "Optimizations applied: Custom Formats, Aurral - HQ Quality Profile, Naming, and Aurral - Standard Metadata Profile updated.",
      customFormatsCreated: Object.keys(cfMap),

      qualityProfileId: profileData.id || null,
      metadataProfileId: standardProfileId,
    };

  } catch (error) {
    console.error("Optimization failed:", error);
    throw error;
  }
};

