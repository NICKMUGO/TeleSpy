import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AppProviders } from "@/components/providers/app-providers";
import { PreferencesEffect } from "@/components/preferences-effect";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { noFlashScript } from "@/lib/no-flash-script";
import "./globals.css";

// UI + body copy.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// MSISDNs, ICCIDs, KES amounts, durations, data volumes, timestamps — anything
// that must align or be compared gets tabular, monospaced digits.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "TeleSpy",
  description:
    "SIM management and telecom cost accountability for Kenya Airways",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before hydration so persisted font-scale/density/motion apply
         * on first paint instead of flashing the defaults. next-themes injects
         * its own equivalent script for theme. */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="bg-background text-foreground ring-ring sr-only rounded-md px-4 py-2 text-sm font-medium ring-2 focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50"
        >
          Skip to main content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AppProviders>
            <TooltipProvider delayDuration={300}>
              <PreferencesEffect />
              {children}
              <Toaster richColors closeButton />
            </TooltipProvider>
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
