/**
 * sRGB copies of a few app/globals.css tokens, for the places that can't
 * read CSS variables or oklch(): the generated app icons, the web app
 * manifest and the browser's theme-color (installed app title bar). Keep
 * them in step with globals.css — everything else uses the CSS tokens.
 */
export const BRAND_COLORS = {
  /** --color-kq-red, oklch(0.52 0.2 25). */
  red: "#c21725",
  /** White glyph on the red icon tile. */
  onRed: "#ffffff",
  /** Light --background, oklch(0.965 0.004 286). */
  backgroundLight: "#f4f4f6",
  /** Dark --background, oklch(0 0 0). */
  backgroundDark: "#000000",
} as const;
