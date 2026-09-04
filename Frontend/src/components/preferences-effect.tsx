"use client";

import { useEffect } from "react";
import { useUiPreferences } from "@/lib/store/ui-preferences";

// Applies persisted display preferences (font scale, density, motion) to the
// <html> element. The inline script in layout.tsx does the same thing
// synchronously before first paint (avoids a flash of the wrong scale); this
// effect keeps the DOM in sync after that, whenever the user changes a
// preference at runtime.
export function PreferencesEffect() {
  const fontScale = useUiPreferences((state) => state.fontScale);
  const density = useUiPreferences((state) => state.density);
  const motion = useUiPreferences((state) => state.motion);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}%`;
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  return null;
}
