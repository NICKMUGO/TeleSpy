"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Check, GraduationCap, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDismissTutorial,
  useMarkTutorialStep,
  useTutorialProgress,
} from "@/lib/api/hooks";
import type { TutorialStep } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface TutorialOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Frame {
  /** The spotlight cut-out in viewport px; null = whole page dimmed. */
  hole: Box | null;
  vw: number;
  vh: number;
}

/** Breathing room between the highlighted element and the cut-out edge. */
const HOLE_PADDING = 8;
/** Space between the cut-out and the card, and the card's viewport inset. */
const CARD_GAP = 16;
const VIEWPORT_MARGIN = 16;
/** How long to wait for a step's element (its page may still be loading
 * data) before falling back to the step's sidebar link, then to none. */
const TARGET_WAIT_MS = 3000;

function prefersReducedMotion() {
  return (
    document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function findVisible(selector: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

/** The element's padded rect, clipped to the viewport so a table taller
 * than the screen spotlights just the part you can see. */
function holeFor(el: HTMLElement, vw: number, vh: number): Box {
  const rect = el.getBoundingClientRect();
  const top = Math.max(rect.top - HOLE_PADDING, 4);
  const left = Math.max(rect.left - HOLE_PADDING, 4);
  const bottom = Math.min(rect.bottom + HOLE_PADDING, vh - 4);
  const right = Math.min(rect.right + HOLE_PADDING, vw - 4);
  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

function sameFrame(a: Frame, hole: Box | null, vw: number, vh: number) {
  if (a.vw !== vw || a.vh !== vh) return false;
  if (!a.hole || !hole) return a.hole === hole;
  return (
    Math.round(a.hole.top) === Math.round(hole.top) &&
    Math.round(a.hole.left) === Math.round(hole.left) &&
    Math.round(a.hole.width) === Math.round(hole.width) &&
    Math.round(a.hole.height) === Math.round(hole.height)
  );
}

/** Below the cut-out if it fits, else above, right, left — and as a last
 * resort (the element fills the screen) pinned to the bottom edge. */
function placeCard(
  hole: Box | null,
  card: { width: number; height: number },
  vw: number,
  vh: number,
) {
  const { width: w, height: h } = card;
  if (!hole) return { top: (vh - h) / 2, left: (vw - w) / 2 };

  const clampX = (x: number) =>
    Math.min(Math.max(x, VIEWPORT_MARGIN), vw - w - VIEWPORT_MARGIN);
  const clampY = (y: number) =>
    Math.min(Math.max(y, VIEWPORT_MARGIN), vh - h - VIEWPORT_MARGIN);

  const below = hole.top + hole.height + CARD_GAP;
  if (below + h <= vh - VIEWPORT_MARGIN) {
    return { top: below, left: clampX(hole.left) };
  }
  const above = hole.top - CARD_GAP - h;
  if (above >= VIEWPORT_MARGIN) return { top: above, left: clampX(hole.left) };
  const right = hole.left + hole.width + CARD_GAP;
  if (right + w <= vw - VIEWPORT_MARGIN) {
    return { top: clampY(hole.top), left: right };
  }
  const left = hole.left - CARD_GAP - w;
  if (left >= VIEWPORT_MARGIN) return { top: clampY(hole.top), left };
  return { top: vh - h - VIEWPORT_MARGIN, left: (vw - w) / 2 };
}

/** Finds the step's `data-tour` element once its page is showing, scrolls
 * it into view, then follows it every frame — data loading in, the window
 * resizing and the page scrolling all move it, and a per-frame
 * getBoundingClientRect is cheaper than wiring an observer for each. */
function useSpotlight(
  step: TutorialStep | undefined,
  active: boolean,
  onPage: boolean,
): Frame {
  const [frame, setFrame] = useState<Frame>({ hole: null, vw: 0, vh: 0 });
  const target = step?.target ?? null;
  const href = step?.href;

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let el: HTMLElement | null = null;
    let scrolled = false;
    let gaveUp = false;
    const startedAt = performance.now();

    const tick = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      if (onPage && target && !gaveUp && !el?.isConnected) {
        el = findVisible(`[data-tour="${target}"]`);
        if (!el && performance.now() - startedAt > TARGET_WAIT_MS) {
          gaveUp = true;
          el = href ? findVisible(`[data-tour-nav="${href}"]`) : null;
        }
        if (el && !scrolled) {
          scrolled = true;
          const fits = el.getBoundingClientRect().height <= vh * 0.6;
          el.scrollIntoView({
            block: fits ? "center" : "start",
            inline: "nearest",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
          });
        }
      }

      const hole = el?.isConnected ? holeFor(el, vw, vh) : null;
      setFrame((prev) =>
        sameFrame(prev, hole, vw, vh) ? prev : { hole, vw, vh },
      );
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, onPage, target, href]);

  return frame;
}

/** Server-driven spotlight tour: content, order, the page each step opens
 * and the element it highlights all come from GET /tutorial/progress
 * (BackendDotNet/Api/TutorialController.cs + Core/TutorialContent.cs,
 * role-aware) — this component is purely presentation. Each step opens its
 * page, dims everything else and cuts a pulsing hole around the element
 * whose data-tour attribute matches the step's target. */
export function TutorialOverlay({ open, onOpenChange }: TutorialOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data, isLoading } = useTutorialProgress();
  const markStep = useMarkTutorialStep();
  const dismissTutorial = useDismissTutorial();
  const [stepIndex, setStepIndex] = useState(0);
  // Tracks whether we've already jumped to the "resume where you left
  // off" step for the current open-state — reset to false as soon as the
  // tour closes, so the next open re-syncs. Adjusted during render
  // (React's documented pattern for "reset state when a prop changes")
  // instead of an effect, which would cost an extra render pass.
  const [hasSyncedForThisOpen, setHasSyncedForThisOpen] = useState(false);
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

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
  const onPage = !!step && pathname === step.href;
  const frame = useSpotlight(step, open, onPage);

  // Open the step's page for the user — this replaces the old "Take me
  // there" button.
  const stepHref = step?.href;
  useEffect(() => {
    if (open && stepHref && pathname !== stepHref) router.push(stepHref);
  }, [open, stepHref, pathname, router]);

  // Hand focus back to whatever opened the tour once it closes.
  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => previous?.focus({ preventScroll: true });
  }, [open]);

  // Focus the card on every step so a screen reader announces its title
  // and body (it's labelled by both), not just whichever button had focus.
  const stepId = step?.id;
  useEffect(() => {
    if (open) cardRef.current?.focus({ preventScroll: true });
  }, [open, stepId]);

  useEffect(() => {
    const card = cardRef.current;
    if (!open || !card) return;
    const observer = new ResizeObserver(() =>
      setCardSize({ width: card.offsetWidth, height: card.offsetHeight }),
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, [open]);

  if (!open) return null;

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

  function onCardKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    // Arrows only when the card itself has focus — inside, they belong to
    // whatever control is focused.
    if (event.target === event.currentTarget) {
      if (event.key === "ArrowRight" && step && !markStep.isPending) {
        event.preventDefault();
        void handleNext();
        return;
      }
      if (event.key === "ArrowLeft" && stepIndex > 0) {
        event.preventDefault();
        goToStep(stepIndex - 1);
        return;
      }
    }
    // Keep Tab inside the card: everything behind it is covered.
    if (event.key === "Tab") {
      const focusable = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (
        event.shiftKey &&
        (current === first || current === event.currentTarget)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const vw = frame.vw || window.innerWidth;
  const vh = frame.vh || window.innerHeight;
  const hole = frame.hole ?? { top: vh / 2, left: vw / 2, width: 0, height: 0 };
  const measured = cardSize.width > 0;
  const position = placeCard(frame.hole, cardSize, vw, vh);

  return createPortal(
    <div className="fixed inset-0 z-[70]">
      {/* Swallows clicks on the dimmed page — the tour moves on with Next,
       * not by poking at what's behind it. */}
      <div className="absolute inset-0" />

      {/* The spotlight: a cut-out whose enormous shadow is the dim layer,
       * so moving or resizing it slides the hole smoothly between steps.
       * With nothing to point at it shrinks to a point mid-screen and the
       * whole page dims. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-xl transition-[top,left,width,height] duration-300 ease-out"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow: "0 0 0 9999px var(--tour-scrim)",
        }}
      >
        {frame.hole ? (
          <div className="outline-primary animate-tour-pulse absolute inset-0 rounded-[inherit] outline-2" />
        ) : null}
      </div>

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={onCardKeyDown}
        style={{ top: position.top, left: position.left }}
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 fixed flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-xl p-4 text-sm shadow-lg ring-1 outline-none",
          // Hidden until measured, so it doesn't flash at a guessed spot.
          measured
            ? "transition-[top,left] duration-300 ease-out"
            : "invisible",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <GraduationCap aria-hidden="true" className="text-primary size-4" />
            {steps.length > 0
              ? `Guided tour · Step ${stepIndex + 1} of ${steps.length}`
              : "Guided tour"}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close tour"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        {isLoading || !step ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <h2 id={titleId} className="text-base font-semibold">
                {step.title}
              </h2>
              {completed.has(step.id) ? (
                <Badge variant="secondary" className="gap-1">
                  <Check aria-hidden="true" className="size-3" />
                  Done
                </Badge>
              ) : null}
            </div>
            <p id={bodyId} className="text-muted-foreground">
              {step.body}
            </p>

            {/* Step dots double as a progress indicator and a jump-to
             * control — generous 44px-equivalent hit targets per touch
             * target guidance, not just the visible dot. */}
            <div
              className="flex flex-wrap items-center gap-1"
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
          </>
        )}

        <div className="flex items-center justify-between gap-2">
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
        </div>
      </div>
    </div>,
    document.body,
  );
}
