import type { MetadataRoute } from "next";
import { BRAND_COLORS } from "@/lib/brand-colors";

/**
 * The web app manifest (served as /manifest.webmanifest and linked from
 * every page). It's what makes TeleSpy installable: Chrome/Edge on a laptop
 * and Chrome on Android offer "Install" once a page has this plus a service
 * worker (public/sw.js), and the installed app opens in its own window from
 * its own icon. iOS reads the name and display mode from here too, but its
 * icon from apple-icon.tsx.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TeleSpy — Kenya Airways",
    short_name: "TeleSpy",
    description:
      "SIM management, telecom cost accountability and tickets for Kenya Airways",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // The window's title bar and the splash screen while it opens.
    theme_color: BRAND_COLORS.backgroundLight,
    background_color: BRAND_COLORS.backgroundLight,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Right-click the taskbar/dock icon (laptop) or long-press it (Android)
    // to jump straight to one of these.
    shortcuts: [
      {
        name: "Tickets",
        url: "/tickets",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "SLA report",
        url: "/tickets/sla",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Dashboard",
        url: "/dashboard",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
    categories: ["business", "productivity"],
  };
}
