"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "This page couldn't load",
  description = "Try again, or come back later if the problem continues.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <TriangleAlert aria-hidden="true" className="text-destructive size-8" />
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 max-w-md text-sm">
          {description}
        </p>
      </div>
      {onRetry ? (
        <Button onClick={onRetry} variant="outline">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
