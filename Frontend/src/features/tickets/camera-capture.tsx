"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Facing = "environment" | "user";

type CameraState =
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "taken"; file: File; url: string }
  | { kind: "denied" }
  | { kind: "missing" }
  | { kind: "failed"; message: string };

/** Can this browser show its own camera inside the page? (Needs HTTPS.) */
export function canUseCamera() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext
  );
}

function photoName() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `photo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
}

/** Take a photo with the phone's or laptop's camera and send it to the
 * ticket. The first time, the browser asks for camera permission with its
 * own question (on phones: "While using the app", "Only this time",
 * "Don't allow"); TeleSpy can't word or skip that question. If it's been
 * refused, this explains how to turn it back on. */
export function CameraDialog({
  open,
  onOpenChange,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [state, setState] = useState<CameraState>({ kind: "starting" });
  const [canFlip, setCanFlip] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (which: Facing) => {
      stop();
      setState({ kind: "starting" });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: which },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setState({ kind: "live" });
        const devices = await navigator.mediaDevices
          .enumerateDevices()
          .catch(() => []);
        setCanFlip(devices.filter((d) => d.kind === "videoinput").length > 1);
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState({ kind: "denied" });
        } else if (
          name === "NotFoundError" ||
          name === "OverconstrainedError"
        ) {
          setState({ kind: "missing" });
        } else {
          setState({
            kind: "failed",
            message:
              name === "NotReadableError"
                ? "Another app is using the camera. Close it and try again."
                : "The camera couldn't start. Try again.",
          });
        }
      }
    },
    [stop],
  );

  // Turn the camera on while the dialog is open, and off when it closes.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void start(facing), 0);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [open, facing, start, stop]);

  // Free the preview image once it's no longer shown.
  useEffect(() => {
    if (state.kind !== "taken") return;
    const { url } = state;
    return () => URL.revokeObjectURL(url);
  }, [state]);

  function take() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], photoName(), { type: "image/jpeg" });
        stop();
        setState({ kind: "taken", file, url: URL.createObjectURL(blob) });
      },
      "image/jpeg",
      0.85,
    );
  }

  function close() {
    stop();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Take a photo</DialogTitle>
          <DialogDescription>
            {state.kind === "taken"
              ? "Use it in your message, or take it again."
              : "Point the camera at what you want to show, then tap Take photo."}
          </DialogDescription>
        </DialogHeader>

        {state.kind === "denied" ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">
              TeleSpy isn&apos;t allowed to use the camera.
            </p>
            <p className="text-muted-foreground">
              It was turned off for this app. To turn it back on:
            </p>
            <ul className="text-muted-foreground list-disc pl-5">
              <li>
                <strong>Android:</strong> tap the icon at the left of the
                address bar (or long-press the TeleSpy app icon → App info) →{" "}
                <strong>Permissions</strong> → <strong>Camera</strong> →{" "}
                <strong>Allow while using the app</strong>.
              </li>
              <li>
                <strong>iPhone / iPad:</strong> Settings →{" "}
                <strong>Safari</strong> → <strong>Camera</strong> →{" "}
                <strong>Ask</strong> or <strong>Allow</strong>, then try again.
              </li>
              <li>
                <strong>Laptop:</strong> click the camera or lock icon in the
                address bar → <strong>Camera</strong> → <strong>Allow</strong>.
              </li>
            </ul>
          </div>
        ) : state.kind === "missing" ? (
          <p className="text-sm">
            No camera was found on this device. Use 📎 to attach a photo
            instead.
          </p>
        ) : state.kind === "failed" ? (
          <p className="text-sm">{state.message}</p>
        ) : (
          <div className="bg-muted relative aspect-[4/3] overflow-hidden rounded-lg">
            {state.kind === "taken" ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
              <img
                src={state.url}
                alt="The photo you took"
                className="size-full object-contain"
              />
            ) : (
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="size-full object-cover"
              />
            )}
            {state.kind === "starting" ? (
              <p className="text-muted-foreground absolute inset-0 flex items-center justify-center p-4 text-center text-sm">
                Starting the camera… If your device asks, allow TeleSpy to use
                it.
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          {state.kind === "taken" ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void start(facing)}
              >
                <RefreshCw aria-hidden="true" />
                Retake
              </Button>
              <Button
                type="button"
                onClick={() => {
                  onSend(state.file);
                  close();
                }}
              >
                Use photo
              </Button>
            </>
          ) : state.kind === "live" || state.kind === "starting" ? (
            <>
              {canFlip ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setFacing((f) =>
                      f === "environment" ? "user" : "environment",
                    )
                  }
                >
                  <SwitchCamera aria-hidden="true" />
                  Flip
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={state.kind !== "live"}
                onClick={take}
              >
                <Camera aria-hidden="true" />
                Take photo
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
              {state.kind !== "missing" ? (
                <Button type="button" onClick={() => void start(facing)}>
                  Try again
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
