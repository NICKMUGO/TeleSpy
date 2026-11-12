"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleCheckBig, Star } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import { feedbackApi } from "@/lib/api/resources";
import type { FeedbackView } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const LABELS = ["Very poor", "Poor", "Okay", "Good", "Excellent"];

/**
 * The customer's side of CSAT. The email has one link per rating, so the
 * rating they clicked is saved the moment the page opens — one click is the
 * whole job. They can then change it or add a comment, until the link
 * expires.
 *
 * Saved from the browser (this effect), never by the page's own GET: email
 * link scanners (Outlook Safe Links and the like) fetch every link in a
 * message but don't run scripts, so they can't cast a rating.
 */
export function FeedbackForm({
  token,
  initialRating,
}: {
  token: string | null;
  initialRating: number | null;
}) {
  const [view, setView] = useState<FeedbackView | null>(null);
  const [problem, setProblem] = useState<string | null>(
    token
      ? null
      : "This rating link is incomplete. Open it again from the email.",
  );
  const [rating, setRating] = useState<number | null>(initialRating);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    (async () => {
      try {
        const found = (await feedbackApi.lookup(token)).data;
        setComment(found.comment ?? "");
        if (initialRating && !found.expired) {
          const result = await feedbackApi.submit({
            token,
            rating: initialRating,
            comment: found.comment ?? undefined,
          });
          setView(result.data);
          setRating(initialRating);
          setSaved(true);
        } else {
          setView(found);
          setRating(found.rating ?? initialRating);
        }
      } catch (error) {
        setProblem(
          error instanceof ApiError
            ? error.message
            : "Something went wrong. Please try the link again.",
        );
      }
    })();
  }, [token, initialRating]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token || !rating) return;
    setSaving(true);
    try {
      const result = await feedbackApi.submit({
        token,
        rating,
        comment: comment.trim() || undefined,
      });
      setView(result.data);
      setSaved(true);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? error.message
          : "Couldn't save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (problem) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Can&apos;t open this rating</AlertTitle>
        <AlertDescription>{problem}</AlertDescription>
      </Alert>
    );
  }
  if (!view) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          Request {view.number}
          {view.department_name ? ` · ${view.department_name}` : ""}
        </p>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight">
          How did we do?
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{view.subject}</p>
      </div>

      {saved ? (
        <Alert variant="success">
          <CircleCheckBig aria-hidden="true" />
          <AlertTitle>Thank you for your feedback</AlertTitle>
          <AlertDescription>
            {view.expired
              ? "Your rating is saved."
              : "Your rating is saved. You can change it or add a comment below."}
          </AlertDescription>
        </Alert>
      ) : null}

      {view.expired ? (
        <p className="text-muted-foreground text-sm">
          {view.responded
            ? `You rated this ${view.rating} out of 5. This link has expired, so it can no longer be changed.`
            : "This rating link has expired."}
        </p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Your rating</legend>
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} — ${LABELS[value - 1]}`}
                  onClick={() => {
                    setRating(value);
                    setSaved(false);
                  }}
                  className="focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Star
                    aria-hidden="true"
                    className={cn(
                      "size-9 transition-colors",
                      rating && value <= rating
                        ? "fill-warning text-warning"
                        : "text-muted-foreground/50",
                    )}
                  />
                </button>
              ))}
            </div>
            <p className="text-muted-foreground mt-1 h-5 text-sm">
              {rating ? LABELS[rating - 1] : "Tap a star"}
            </p>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor="feedback-comment">
              Anything you&apos;d like to add? (optional)
            </Label>
            <Textarea
              id="feedback-comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                setSaved(false);
              }}
              rows={4}
              maxLength={1000}
              placeholder="What went well, or what could we do better?"
            />
          </div>

          <Button type="submit" size="lg" disabled={!rating || saving}>
            {saving ? "Saving…" : saved ? "Saved" : "Save feedback"}
          </Button>
        </form>
      )}
    </div>
  );
}
