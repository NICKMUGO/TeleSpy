"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DisplaySettingsForm } from "@/components/layout/display-settings-form";

interface DisplaySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DisplaySettingsDialog({
  open,
  onOpenChange,
}: DisplaySettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Display settings</DialogTitle>
          <DialogDescription>
            Theme, text size, density and motion — saved on this device.
          </DialogDescription>
        </DialogHeader>
        <DisplaySettingsForm />
      </DialogContent>
    </Dialog>
  );
}
