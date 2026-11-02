import { brandIcon } from "@/lib/brand-icon";

/** The installed app's icons, listed in the web app manifest. Rendered once
 * at build time, not per request. */
const ICONS = {
  "icon-192.png": () => brandIcon(192, { shape: "rounded" }),
  "icon-512.png": () => brandIcon(512, { shape: "rounded" }),
  "maskable-512.png": () => brandIcon(512, { shape: "full", glyphScale: 0.42 }),
} as const;

type IconName = keyof typeof ICONS;

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  return ICONS[name as IconName]();
}
