"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/session-store";
import { Skeleton } from "@/components/ui/skeleton";

/** Wraps every (app) route. hasHydrated distinguishes "still reading the
 * persisted session from localStorage" from "definitely signed out" —
 * without that check this would redirect to /login for a split second on
 * every hard refresh, even for a signed-in user. */
export function AuthGuard({ children }: { children: ReactNode }) {
  const accessToken = useSession((state) => state.accessToken);
  const hasHydrated = useSession((state) => state.hasHydrated);
  const router = useRouter();

  useEffect(() => {
    if (hasHydrated && !accessToken) {
      router.replace("/login");
    }
  }, [hasHydrated, accessToken, router]);

  if (!hasHydrated) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!accessToken) return null; // redirect effect above is already firing

  return <>{children}</>;
}
