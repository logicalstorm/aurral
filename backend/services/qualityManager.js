import { db } from '../config/db.js';

// Quality presets based on optimization standards
export const QUALITY_PRESETS = {
  low: {
    name: 'Low',
    allowedFormats: ['mp3-192', 'mp3-256', 'mp3-320'],
    preferLossless: false,
    preferredGroups: [],
    preferCD: false,
    preferWEB: false,
    avoidVinyl: false,
  },
  standard: {
    name: 'Standard',
    allowedFormats: ['mp3-320', 'flac'],
    preferLossless: true,
    preferredGroups: ['DeVOiD', 'PERFECT', 'ENRiCH'],
    preferCD: true,
    preferWEB: true,
    avoidVinyl: true,
  },
  max: {
    name: 'Max',
    allowedFormats: ['flac'],
    preferLossless: true,
    preferredGroups: ['DeVOiD', 'PERFECT', 'ENRiCH'],
    preferCD: true,
    preferWEB: true,
    avoidVinyl: true,
  },
};

export class QualityManager {
  constructor() {
    this.initDb();
  }

  initDb() {
    // No longer needed - we use simple quality presets
  }

  getQualityPreset(quality = 'standard') {
    return QUALITY_PRESETS[quality] || QUALITY_PRESETS.standard;
  }

  getAllQualityPresets() {
    return Object.keys(QUALITY_PRESETS).map(key => ({
      id: key,
      ...QUALITY_PRESETS[key],
    }));
  }

  // Helper to check if a filename matches quality preferences
  matchesQuality(filename, quality = 'standard') {
    const preset = this.getQualityPreset(quality);
    const lowerFilename = filename.toLowerCase();
    
    // Check format
    const hasAllowedFormat = preset.allowedFormats.some(format => {
      if (format === 'flac') return lowerFilename.includes('.flac');
      if (format === 'mp3-320') return lowerFilename.includes('320') || (lowerFilename.includes('.mp3') && !lowerFilename.includes('192') && !lowerFilename.includes('256'));
      if (format === 'mp3-256') return lowerFilename.includes('256');
      if (format === 'mp3-192') return lowerFilename.includes('192');
      return false;
    });
    
    if (!hasAllowedFormat) return false;
    
    // Check preferred groups
    if (preset.preferredGroups.length > 0) {
      const hasPreferredGroup = preset.preferredGroups.some(group => 
        lowerFilename.includes(group.toLowerCase())
      );
      if (hasPreferredGroup) return true;
    }
    
    // Avoid vinyl if configured
    if (preset.avoidVinyl && (lowerFilename.includes('vinyl') || lowerFilename.includes('vinylrip'))) {
      return false;
    }
    
    // Prefer CD/WEB if configured
    if (preset.preferCD && lowerFilename.includes('cd')) return true;
    if (preset.preferWEB && (lowerFilename.includes('web') || lowerFilename.includes('digital'))) return true;
    
    return true;
  }

  // Score a file based on quality preferences
  scoreFile(filename, quality = 'standard') {
    const preset = this.getQualityPreset(quality);
    const lowerFilename = filename.toLowerCase();
    let score = 0;
    
    // Preferred groups get high score
    if (preset.preferredGroups.length > 0) {
      preset.preferredGroups.forEach(group => {
        if (lowerFilename.includes(group.toLowerCase())) {
          score += 100;
        }
      });
    }
    
    // Format scoring
    if (lowerFilename.includes('.flac') || lowerFilename.includes('lossless')) {
      score += 10;
    } else if (lowerFilename.includes('320')) {
      score += 5;
    } else if (lowerFilename.includes('256')) {
      score += 3;
    } else if (lowerFilename.includes('192')) {
      score += 1;
    }
    
    // Source scoring
    if (preset.preferCD && lowerFilename.includes('cd')) score += 1;
    if (preset.preferWEB && (lowerFilename.includes('web') || lowerFilename.includes('digital'))) score += 1;
    if (preset.avoidVinyl && (lowerFilename.includes('vinyl') || lowerFilename.includes('vinylrip'))) {
      score -= 10000;
    }
    
    return score;
  }

  // Get quality profiles (for compatibility with frontend)
  getQualityProfiles() {
    return this.getAllQualityPresets();
  }

}

export const qualityManager = new QualityManager();
