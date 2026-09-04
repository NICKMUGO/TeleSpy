"use client";

import { useTheme } from "next-themes";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  FONT_SCALES,
  useUiPreferences,
  type Density,
  type FontScale,
  type Motion,
} from "@/lib/store/ui-preferences";

const FONT_SCALE_LABELS: Record<FontScale, string> = {
  "100": "100%",
  "112.5": "112.5%",
  "125": "125%",
  "150": "150%",
};

export function DisplaySettingsForm() {
  const { theme, setTheme } = useTheme();
  const fontScale = useUiPreferences((s) => s.fontScale);
  const setFontScale = useUiPreferences((s) => s.setFontScale);
  const density = useUiPreferences((s) => s.density);
  const setDensity = useUiPreferences((s) => s.setDensity);
  const motion = useUiPreferences((s) => s.motion);
  const setMotion = useUiPreferences((s) => s.setMotion);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 id="display-settings-theme" className="mb-2 text-sm font-medium">
          Theme
        </h3>
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(value) => value && setTheme(value)}
          variant="outline"
          aria-labelledby="display-settings-theme"
        >
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          <ToggleGroupItem value="system">System</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div>
        <h3
          id="display-settings-font-size"
          className="mb-2 text-sm font-medium"
        >
          Text size
        </h3>
        <ToggleGroup
          type="single"
          value={fontScale}
          onValueChange={(value) => value && setFontScale(value as FontScale)}
          variant="outline"
          aria-labelledby="display-settings-font-size"
        >
          {FONT_SCALES.map((scale) => (
            <ToggleGroupItem key={scale} value={scale}>
              {FONT_SCALE_LABELS[scale]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div>
        <h3 id="display-settings-density" className="mb-2 text-sm font-medium">
          Density
        </h3>
        <ToggleGroup
          type="single"
          value={density}
          onValueChange={(value) => value && setDensity(value as Density)}
          variant="outline"
          aria-labelledby="display-settings-density"
        >
          <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
          <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div>
        <h3 id="display-settings-motion" className="mb-2 text-sm font-medium">
          Motion
        </h3>
        <ToggleGroup
          type="single"
          value={motion}
          onValueChange={(value) => value && setMotion(value as Motion)}
          variant="outline"
          aria-labelledby="display-settings-motion"
        >
          <ToggleGroupItem value="system">Match system</ToggleGroupItem>
          <ToggleGroupItem value="reduce">Reduce motion</ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}
