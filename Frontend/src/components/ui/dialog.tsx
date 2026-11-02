"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/** For a dialog its parent shows only while it's open (`{x ? <MyDialog
 * onClose={…} /> : null}`): unmounting it straight away would skip the
 * closing animation. `close` animates it shut first; the parent's `onClose`
 * runs once it's gone. Pass `open` to <Dialog> and `onExitComplete` to its
 * <DialogContent>. */
function useClosingDialog(onClose: () => void) {
  const [open, setOpen] = React.useState(true);
  const close = React.useCallback(() => setOpen(false), []);
  const onOpenChange = React.useCallback(
    (next: boolean) => !next && setOpen(false),
    [],
  );
  return { open, close, onOpenChange, onExitComplete: onClose };
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "max-sm:data-open:animate-in max-sm:data-open:fade-in-0 max-sm:data-closed:animate-out max-sm:data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/25 duration-300 supports-backdrop-filter:backdrop-blur-xs dark:bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

/** A dialog on desktop (no animation, it just appears); on phones, an iOS-style bottom sheet that slides
 * up from the bottom edge and can be swiped down to close by its handle. */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  style,
  onExitComplete,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /** Once it has closed and its closing animation has finished. */
  onExitComplete?: () => void;
}) {
  const exitRef = React.useRef(onExitComplete);
  React.useEffect(() => {
    exitRef.current = onExitComplete;
  });
  // Mounts with the panel on each open (this wrapper stays mounted while
  // closed) and unmounts once its closing animation has played.
  const panelRef = React.useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    return () => {
      if (el.dataset.state === "closed") exitRef.current?.();
    };
  }, []);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const dragStart = React.useRef<number | null>(null);
  const [dragY, setDragY] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  function onHandleDown(event: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = event.clientY;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onHandleMove(event: React.PointerEvent<HTMLDivElement>) {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, event.clientY - dragStart.current));
  }
  function onHandleUp() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    // Far enough down closes it; anything less springs back.
    if (dragY > 80) closeRef.current?.click();
    else setDragY(0);
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "bg-popover text-popover-foreground shadow-panel fixed z-50 grid w-full gap-4 p-4 text-sm outline-none max-sm:pt-7",
          // Phone: a sheet along the bottom edge.
          "inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]",
          "max-sm:data-open:animate-in max-sm:data-closed:animate-out max-sm:ease-spring max-sm:duration-300 max-sm:data-closed:duration-200",
          "max-sm:data-open:slide-in-from-bottom max-sm:data-closed:slide-out-to-bottom",
          // Desktop: centred.
          "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-4",
          className,
        )}
        style={
          dragY
            ? {
                ...style,
                translate: `0 ${dragY}px`,
                transition: dragging
                  ? "none"
                  : "translate 0.3s var(--ease-spring)",
              }
            : style
        }
        {...props}
        ref={panelRef}
      >
        <div
          aria-hidden="true"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          className="absolute inset-x-0 top-0 z-10 flex h-7 cursor-grab touch-none items-center justify-center sm:hidden"
        >
          <span className="bg-muted-foreground/30 h-1.5 w-10 rounded-full" />
        </div>
        <DialogPrimitive.Close
          ref={closeRef}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
        />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-muted/50 border-border-subtle -mx-4 -mb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col-reverse gap-2 border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:-mb-4 sm:flex-row sm:justify-end sm:rounded-b-2xl sm:pb-4",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-lg leading-tight font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  useClosingDialog,
};
