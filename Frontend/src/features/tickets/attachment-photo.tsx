"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ticketsApi } from "@/lib/api/resources";
import type { TicketAttachment } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Photos a browser can draw. (HEIC only shows in Safari; elsewhere it
 * falls back to the download bubble.) */
export function isPhoto(attachment: TicketAttachment) {
  return attachment.content_type.startsWith("image/");
}

/** A photo in the ticket chat: a small picture that opens full-screen,
 * with a Download button there. The file is fetched with the signed-in
 * token (it has no public link). `fallback` is shown while it can't be
 * drawn — loading failed, or the browser can't show that format. */
export function AttachmentPhoto({
  ticketId,
  attachment,
  mine,
  onDownload,
  fallback,
}: {
  ticketId: string;
  attachment: TicketAttachment;
  mine: boolean;
  onDownload: () => void;
  fallback: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    ticketsApi
      .attachmentBlob(ticketId, attachment, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setBroken(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ticketId, attachment]);

  if (broken) return <>{fallback}</>;

  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        className={cn(
          "bg-muted block overflow-hidden rounded-2xl",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          mine ? "rounded-br-sm" : "rounded-bl-sm",
        )}
        title={`View ${attachment.file_name}`}
        aria-label={`View photo ${attachment.file_name}`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed-in blob, not a public URL
          <img
            src={url}
            alt={attachment.file_name}
            onError={() => setBroken(true)}
            className="block max-h-60 w-auto max-w-full object-cover sm:max-w-xs"
          />
        ) : (
          <span className="block h-40 w-56 animate-pulse" />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {attachment.file_name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              The photo, full size.
            </DialogDescription>
          </DialogHeader>
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed-in blob, not a public URL
            <img
              src={url}
              alt={attachment.file_name}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDownload}>
              <Download aria-hidden="true" />
              Download
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
