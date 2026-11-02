import { brandIcon } from "@/lib/brand-icon";

// The home-screen icon on iPhone and iPad ("Add to Home Screen"). iOS
// ignores the manifest's icons and rounds this square itself.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIcon(180, { shape: "full" });
}
