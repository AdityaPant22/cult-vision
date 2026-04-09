import { CSSProperties } from "react";

export interface SilhouetteGuideSettings {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export const SILHOUETTE_GUIDE_STORAGE_KEY = "cult-vision.squat-guide-settings";

export const DEFAULT_SILHOUETTE_GUIDE_SETTINGS: SilhouetteGuideSettings = {
  offsetX: 0,
  offsetY: 0,
  scale: 100
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeSilhouetteGuideSettings(
  settings: Partial<SilhouetteGuideSettings> | null | undefined
): SilhouetteGuideSettings {
  return {
    offsetX: clamp(Number(settings?.offsetX ?? DEFAULT_SILHOUETTE_GUIDE_SETTINGS.offsetX), -30, 30),
    offsetY: clamp(Number(settings?.offsetY ?? DEFAULT_SILHOUETTE_GUIDE_SETTINGS.offsetY), -25, 25),
    scale: clamp(Number(settings?.scale ?? DEFAULT_SILHOUETTE_GUIDE_SETTINGS.scale), 60, 145)
  };
}

export function loadSilhouetteGuideSettings(): SilhouetteGuideSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SILHOUETTE_GUIDE_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(SILHOUETTE_GUIDE_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_SILHOUETTE_GUIDE_SETTINGS;
    }

    return sanitizeSilhouetteGuideSettings(JSON.parse(rawValue) as Partial<SilhouetteGuideSettings>);
  } catch {
    return DEFAULT_SILHOUETTE_GUIDE_SETTINGS;
  }
}

export function saveSilhouetteGuideSettings(settings: SilhouetteGuideSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const nextSettings = sanitizeSilhouetteGuideSettings(settings);
  window.localStorage.setItem(SILHOUETTE_GUIDE_STORAGE_KEY, JSON.stringify(nextSettings));
}

export function getSilhouetteGuideStyle(
  settings: SilhouetteGuideSettings
): CSSProperties {
  const safeSettings = sanitizeSilhouetteGuideSettings(settings);
  const widthPercent = clamp((76 * safeSettings.scale) / 100, 38, 92);
  const maxHeightPercent = clamp((80 * safeSettings.scale) / 100, 52, 96);

  return {
    left: `calc(50% + ${safeSettings.offsetX}%)`,
    bottom: `calc(11% + ${safeSettings.offsetY}%)`,
    width: `${widthPercent}%`,
    maxHeight: `${maxHeightPercent}%`
  };
}
