"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ErrorDialogContent {
  title: string;
  message: string;
  hint?: string;
}

/** A popup for an error the person has to read and acknowledge — one a
 * toast would let slip by, like being refused because of a rule. Opens
 * while `error` is set; dismissing it calls `onClose`. */
export function ErrorDialog({
  error,
  onClose,
}: {
  error: ErrorDialogContent | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={error !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent role="alertdialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert
              aria-hidden="true"
              className="text-destructive size-5 shrink-0"
            />
            {error?.title}
          </DialogTitle>
          <DialogDescription>{error?.message}</DialogDescription>
        </DialogHeader>
        {error?.hint ? (
          <p className="text-muted-foreground text-sm">{error.hint}</p>
        ) : null}
        <DialogFooter>
          <Button autoFocus onClick={onClose}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
