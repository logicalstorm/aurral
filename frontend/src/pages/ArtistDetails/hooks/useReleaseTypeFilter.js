import { useState, useEffect } from "react";
import {
  allReleaseTypes,
  primaryReleaseTypes,
  secondaryReleaseTypes,
  ARTIST_DETAILS_FILTER_KEY,
} from "../constants";

export function useReleaseTypeFilter() {
  const loadFilterSettings = () => {
    try {
      const saved = localStorage.getItem(ARTIST_DETAILS_FILTER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const validTypes = parsed.filter((type) =>
          allReleaseTypes.includes(type)
        );
        if (validTypes.length > 0) {
          return validTypes;
        }
      }
    } catch {}
    return allReleaseTypes;
  };

  const [selectedReleaseTypes, setSelectedReleaseTypes] =
    useState(loadFilterSettings);

  useEffect(() => {
    try {
      localStorage.setItem(
        ARTIST_DETAILS_FILTER_KEY,
        JSON.stringify(selectedReleaseTypes)
      );
    } catch {}
  }, [selectedReleaseTypes]);

  return {
    selectedReleaseTypes,
    setSelectedReleaseTypes,
    primaryReleaseTypes,
    secondaryReleaseTypes,
    allReleaseTypes,
  };
}
