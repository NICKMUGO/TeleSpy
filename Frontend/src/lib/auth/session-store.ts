"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CurrentUser } from "@/lib/api/types";

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: CurrentUser | null;
  hasHydrated: boolean;
  setSession: (session: {
    accessToken: string;
    refreshToken: string;
    user: CurrentUser;
  }) => void;
  setAccessToken: (token: string) => void;
  clear: () => void;
  setHasHydrated: (value: boolean) => void;
}

// Persisted client-side (localStorage) rather than an httpOnly cookie:
// BackendDotNet issues JWTs directly to the caller (Authorization: Bearer),
// there's no Next.js server session in front of it, so this is the
// standard pattern for an SPA-style client talking to an external API.
// hasHydrated exists so route guards can tell "no session yet because
// still reading localStorage" apart from "no session, redirect to
// /login" — without it there's a flash-redirect on every hard refresh.
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      hasHydrated: false,
      setSession: ({ accessToken, refreshToken, user }) =>
        set({ accessToken, refreshToken, user }),
      setAccessToken: (accessToken) => set({ accessToken }),
      clear: () => set({ accessToken: null, refreshToken: null, user: null }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "telespy-session",
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
);
