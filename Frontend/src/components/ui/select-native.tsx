import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A styled native <select>. Deliberately native rather than a Radix
 * listbox: these are short, non-searchable option lists (a carrier, a
 * billing period), and the platform control gives correct keyboard,
 * mobile and screen-reader behaviour for free.
 */
function SelectNative({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select-native"
        className={cn(
          "border-border bg-background h-9 w-full appearance-none rounded-lg border ps-3 pe-8 text-sm outline-none max-sm:h-11 max-sm:text-base",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2"
      />
    </div>
  );
}

export { SelectNative };
