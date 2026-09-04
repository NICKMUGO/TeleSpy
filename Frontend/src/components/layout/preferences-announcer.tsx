"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useUiPreferences } from "@/lib/store/ui-preferences";

const DENSITY_LABEL = { comfortable: "comfortable", compact: "compact" };
const MOTION_LABEL = { system: "system default", reduce: "reduced" };

// A single visually-hidden live region that announces display-setting
// changes to screen readers (theme, text size, density, motion). Skips the
// initial mount so it only speaks on actual user changes, not on load.
export function PreferencesAnnouncer() {
  const { resolvedTheme } = useTheme();
  const fontScale = useUiPreferences((s) => s.fontScale);
  const density = useUiPreferences((s) => s.density);
  const motion = useUiPreferences((s) => s.motion);

  const [message, setMessage] = useState("");
  const mounted = useRef(false);
  const prev = useRef({ resolvedTheme, fontScale, density, motion });

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prev.current = { resolvedTheme, fontScale, density, motion };
      return;
    }

    if (resolvedTheme !== prev.current.resolvedTheme && resolvedTheme) {
      setMessage(`Theme set to ${resolvedTheme}.`);
    } else if (fontScale !== prev.current.fontScale) {
      setMessage(`Text size set to ${fontScale}%.`);
    } else if (density !== prev.current.density) {
      setMessage(`Density set to ${DENSITY_LABEL[density]}.`);
    } else if (motion !== prev.current.motion) {
      setMessage(`Motion set to ${MOTION_LABEL[motion]}.`);
    }

    prev.current = { resolvedTheme, fontScale, density, motion };
  }, [resolvedTheme, fontScale, density, motion]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  );
}
