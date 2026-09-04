import { STORAGE_KEY } from "@/lib/store/ui-preferences";

// Runs synchronously in <head>, before hydration, so persisted display
// preferences (font scale, density, motion) apply on first paint instead of
// flashing the defaults. Mirrors what next-themes does internally for theme.
// Kept as a plain string (not a component) because it must execute as a
// blocking inline <script>, not through React.
export const noFlashScript = `(function () {
  try {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (!raw) return;
    var state = (JSON.parse(raw) || {}).state || {};
    var root = document.documentElement;
    if (state.fontScale) root.style.fontSize = state.fontScale + "%";
    if (state.density) root.dataset.density = state.density;
    if (state.motion) root.dataset.motion = state.motion;
  } catch (e) {}
})();`;
