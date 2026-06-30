import { useState, useEffect, useCallback } from "react";
import { THEMES, DEFAULT_THEME_ID, type Theme } from "../lib/themes";
import {
  listBackgrounds,
  importBackground,
  deleteBackground,
  assetUrl,
  type BackgroundInfo,
} from "../lib/ipc";

const STORAGE_KEY = "cockpit.theme";

// Custom uploads get a neutral scrim — we can't know how bright an arbitrary
// image is, and this keeps UI text legible across most photos.
const CUSTOM_SCRIM = 1.0;

function loadThemeId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function toTheme(bg: BackgroundInfo): Theme {
  return {
    id: bg.id,
    name: bg.name,
    image: assetUrl(bg.path),
    scrim: CUSTOM_SCRIM,
    custom: true,
  };
}

/**
 * Tracks the selected background theme (persisted to localStorage) and the set
 * of user-uploaded custom backgrounds (persisted on disk by the backend). The
 * built-in themes and custom uploads are presented as one merged list.
 */
export function useTheme() {
  const [themeId, setThemeId] = useState<string>(loadThemeId);
  const [custom, setCustom] = useState<Theme[]>([]);

  const refreshCustom = useCallback(async () => {
    try {
      const list = await listBackgrounds();
      setCustom(list.map(toTheme));
    } catch (err) {
      console.error("Failed to load custom backgrounds:", err);
    }
  }, []);

  useEffect(() => {
    refreshCustom();
  }, [refreshCustom]);

  const themes: Theme[] = [...THEMES, ...custom];
  const theme: Theme = themes.find((t) => t.id === themeId) ?? THEMES[0];

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Non-fatal — selection just won't persist this session.
    }
  }, []);

  // Open the native picker, import the chosen image, then select it. No-ops if
  // the user cancels the dialog.
  const uploadBackground = useCallback(async () => {
    try {
      const bg = await importBackground();
      if (!bg) return;
      setCustom((prev) => [...prev, toTheme(bg)]);
      setTheme(bg.id);
    } catch (err) {
      console.error("Failed to import background:", err);
    }
  }, [setTheme]);

  const removeBackground = useCallback(
    async (id: string) => {
      try {
        const list = await deleteBackground(id);
        setCustom(list.map(toTheme));
        // If we just removed the active background, fall back to the default.
        setThemeId((current) => {
          if (current !== id) return current;
          try {
            localStorage.setItem(STORAGE_KEY, DEFAULT_THEME_ID);
          } catch {
            /* ignore */
          }
          return DEFAULT_THEME_ID;
        });
      } catch (err) {
        console.error("Failed to delete background:", err);
      }
    },
    []
  );

  return { theme, themes, setTheme, uploadBackground, removeBackground };
}
