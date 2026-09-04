"use client";

import "./globals.css";

// global-error replaces the entire root layout when it fires, so it must
// define its own <html>/<body> and can't rely on ThemeProvider/next-themes
// (no provider is mounted here) — it always renders in the light-mode
// tokens from :root. See error.md's "Global Error" section for why.
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-background text-foreground flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground mt-1 max-w-md text-sm">
            Try again, or come back later if the problem continues.
          </p>
        </div>
        <button
          type="button"
          onClick={() => retry()}
          className="bg-primary text-primary-foreground hover:bg-primary/80 inline-flex h-8 items-center justify-center rounded-lg px-3 text-sm font-medium"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
