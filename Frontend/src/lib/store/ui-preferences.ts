"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const FONT_SCALES = ["100", "112.5", "125", "150"] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export type Density = "comfortable" | "compact";
export type Motion = "system" | "reduce";

interface UiPreferencesState {
  fontScale: FontScale;
  density: Density;
  motion: Motion;
  setFontScale: (value: FontScale) => void;
  setDensity: (value: Density) => void;
  setMotion: (value: Motion) => void;
}

export const STORAGE_KEY = "telespy-ui-preferences";

export const useUiPreferences = create<UiPreferencesState>()(
  persist(
    (set) => ({
      fontScale: "100",
      density: "comfortable",
      motion: "system",
      setFontScale: (fontScale) => set({ fontScale }),
      setDensity: (density) => set({ density }),
      setMotion: (motion) => set({ motion }),
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        fontScale: state.fontScale,
        density: state.density,
        motion: state.motion,
      }),
    },
  ),
);
