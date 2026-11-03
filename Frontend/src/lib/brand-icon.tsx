import { ImageResponse } from "next/og";
import { BRAND_COLORS } from "@/lib/brand-colors";
import {
  BRAND_HANDSET_PATH,
  BRAND_WAVES_PATH,
  BRAND_WAVES_STROKE,
} from "@/lib/brand-glyph";

/**
 * The app icon as a PNG: BrandMark's ringing-phone glyph, white on the red
 * tile.
 *
 * - "rounded": a rounded tile on transparent, for laptop docks, taskbars
 *   and the browser tab.
 * - "full": a square tile edge to edge. iOS rounds the corners itself
 *   (apple-touch-icon); Android crops a maskable icon to its own shape
 *   (circle, squircle…), so that version also shrinks the glyph to stay
 *   inside the middle 80% every shape keeps.
 */
export function brandIcon(
  size: number,
  {
    shape,
    glyphScale = 0.6,
  }: { shape: "rounded" | "full"; glyphScale?: number },
) {
  const glyph = Math.round(size * glyphScale);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_COLORS.red,
        borderRadius: shape === "rounded" ? size * 0.22 : 0,
      }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
        <path d={BRAND_HANDSET_PATH} fill={BRAND_COLORS.onRed} />
        <path
          d={BRAND_WAVES_PATH}
          stroke={BRAND_COLORS.onRed}
          strokeWidth={BRAND_WAVES_STROKE}
          strokeLinecap="round"
        />
      </svg>
    </div>,
    { width: size, height: size },
  );
}
