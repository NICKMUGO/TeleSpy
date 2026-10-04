"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDismissTutorial,
  useMarkTutorialStep,
  useTutorialProgress,
} from "@/lib/api/hooks";

interface TutorialOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Server-driven guided tour: content, order and per-user progress all
 * come from GET /tutorial/progress (BackendDotNet/Api/TutorialController.cs
 * + Core/TutorialContent.cs, role-aware) — this component is purely
 * presentation, not where the steps are authored. */
export function TutorialOverlay({ open, onOpenChange }: TutorialOverlayProps) {
  const router = useRouter();
  const { data, isLoading } = useTutorialProgress();
  const markStep = useMarkTutorialStep();
  const dismissTutorial = useDismissTutorial();
  const [stepIndex, setStepIndex] = useState(0);
  // Tracks whether we've already jumped to the "resume where you left
  // off" step for the current open-state — reset to false as soon as the
  // dialog closes, so the next open re-syncs. Adjusted during render
  // (React's documented pattern for "reset state when a prop changes")
  // instead of an effect, which would cost an extra render pass.
  const [hasSyncedForThisOpen, setHasSyncedForThisOpen] = useState(false);

  const steps = data?.data.steps ?? [];
  const completed = new Set(data?.data.completed_step_ids ?? []);

  if (open && !hasSyncedForThisOpen && data) {
    setHasSyncedForThisOpen(true);
    const nextId = data.data.next_step_id;
    const index = nextId ? steps.findIndex((s) => s.id === nextId) : 0;
    setStepIndex(index >= 0 ? index : 0);
  } else if (!open && hasSyncedForThisOpen) {
    setHasSyncedForThisOpen(false);
  }

  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  function goToStep(index: number) {
    setStepIndex(Math.max(0, Math.min(steps.length - 1, index)));
  }

  async function handleNext() {
    if (!step) return;
    if (!completed.has(step.id)) {
      await markStep.mutateAsync({ stepId: step.id, completed: true });
    }
    if (isLastStep) {
      onOpenChange(false);
    } else {
      goToStep(stepIndex + 1);
    }
  }

  async function handleSkip() {
    await dismissTutorial.mutateAsync();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap aria-hidden="true" className="text-primary size-5" />
            Guided tour
          </DialogTitle>
          <DialogDescription>
            {steps.length > 0
              ? `Step ${stepIndex + 1} of ${steps.length}`
              : "Loading your walkthrough…"}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !step ? (
          <div className="flex flex-col gap-3 py-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-2">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold">{step.title}</h3>
              {completed.has(step.id) ? (
                <Badge variant="secondary" className="gap-1">
                  <Check aria-hidden="true" className="size-3" />
                  Done
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">{step.body}</p>
            {step.href ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => router.push(step.href)}
              >
                Take me there
              </Button>
            ) : null}

            {/* Step dots double as a progress indicator and a jump-to
             * control — generous 44px-equivalent hit targets per touch
             * target guidance, not just the visible dot. */}
            <div
              className="mt-1 flex flex-wrap items-center gap-1"
              role="tablist"
              aria-label="Tutorial steps"
            >
              {steps.map((s, index) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={index === stepIndex}
                  aria-label={`Go to step ${index + 1}: ${s.title}`}
                  onClick={() => goToStep(index)}
                  className="flex size-6 items-center justify-center"
                >
                  <span
                    aria-hidden="true"
                    className={
                      index === stepIndex
                        ? "bg-primary size-2 rounded-full"
                        : completed.has(s.id)
                          ? "bg-primary/50 size-1.5 rounded-full"
                          : "bg-muted-foreground/30 size-1.5 rounded-full"
                    }
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={handleSkip}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            {stepIndex > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => goToStep(stepIndex - 1)}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              onClick={handleNext}
              disabled={!step || markStep.isPending}
            >
              {isLastStep ? "Finish" : "Next"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
