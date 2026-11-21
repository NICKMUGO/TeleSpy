import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Inline, non-blocking message tied to the surface it appears on (a form, a
// card, a page section). A tinted body plus a heavier inline-start rule, so
// the severity reads without relying on the tint alone — the tints are
// deliberately light enough that body text still clears AA against them.
const alertVariants = cva(
  "relative grid w-full grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-1 rounded-md border-s-2 px-3 py-2.5 text-sm [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-muted border-s-border text-foreground [&>svg]:text-muted-foreground",
        destructive:
          "bg-destructive/8 border-s-destructive text-foreground [&>svg]:text-destructive dark:bg-destructive/15",
        warning:
          "bg-warning/10 border-s-warning text-foreground [&>svg]:text-warning dark:bg-warning/15",
        success:
          "bg-success/10 border-s-success text-foreground [&>svg]:text-success dark:bg-success/15",
        info: "bg-info/10 border-s-info text-foreground [&>svg]:text-info dark:bg-info/15",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 font-medium", className)}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-muted-foreground col-start-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, alertVariants };
