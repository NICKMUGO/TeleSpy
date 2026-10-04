import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";

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
    <div className="border-destructive/30 bg-destructive/5 m-6 flex flex-col items-center gap-3 rounded-lg border p-8 text-center">
      <AlertCircle aria-hidden="true" className="text-destructive size-6" />
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
