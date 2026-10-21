"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session-store";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A 401/403/404 won't fix itself on retry — only retry transient
            // (network/5xx) failures, and keep it to one retry so a broken
            // endpoint fails fast instead of stalling the UI for seconds.
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.status < 500) return false;
              return failureCount < 1;
            },
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // Query keys aren't per-user, so whenever the signed-in person changes
  // (sign-out, sign-in, a superseded session) drop everything cached for
  // the previous one. Without this, an Employee signing in after an Admin
  // in the same tab saw the Admin's cached data — including the Admin's
  // tutorial steps, which then walked them onto Admin-only pages.
  useEffect(
    () =>
      useSession.subscribe((state, previous) => {
        if (state.user?.id !== previous.user?.id) queryClient.clear();
      }),
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
