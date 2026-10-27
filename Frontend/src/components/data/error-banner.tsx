import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { IconBadge } from "@/components/data/icon-badge";

/** Standard "this fetch failed" surface for a screen's main content area —
 * distinct from the route-level error.tsx boundary (which catches render
 * crashes); this is for a query that resolved to an error state while the
 * rest of the page stays interactive. */
export function ErrorBanner({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong loading this data.";
  return (
    <div className="bg-destructive/5 animate-rise m-4 flex flex-col items-center gap-3 rounded-xl p-8 text-center sm:m-6">
      <IconBadge icon={AlertCircle} tone="destructive" />
      <p role="alert" className="text-sm">
        {message}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
