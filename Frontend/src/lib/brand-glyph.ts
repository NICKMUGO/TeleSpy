/**
 * The app's glyph: a phone handset ringing, earpiece top right, mouthpiece
 * bottom left, with three call waves at the top left. On a 24×24 grid: the
 * handset is filled, the waves are stroked (BRAND_WAVES_STROKE wide, round
 * caps). Shared by BrandMark (sidebar, sign-in) and brandIcon (installed-app
 * and home-screen icons) so they always match.
 */
export const BRAND_HANDSET_PATH =
  "M14.3 6.6L16.3 3.3Q17 2.3 18.1 2.9L20.6 4.4Q21.6 5 21.6 6.3" +
  "C21.6 14.6 14.6 21.6 6.3 21.6Q5 21.6 4.4 20.6L2.9 18.1Q2.3 17 3.3 16.3" +
  "L6.6 14.3Q7.6 13.7 8.4 14.5L9.6 15.6Q10.2 16.2 11 15.8" +
  "C13 14.6 14.6 13 15.8 11Q16.2 10.2 15.6 9.6L14.5 8.4Q13.7 7.6 14.3 6.6Z";

export const BRAND_WAVES_PATH =
  "M11 7.9A2.7 2.7 0 0 0 8.3 10.6" +
  "M11 4.9A5.7 5.7 0 0 0 5.3 10.6" +
  "M11 1.9A8.7 8.7 0 0 0 2.3 10.6";

export const BRAND_WAVES_STROKE = 1.5;
