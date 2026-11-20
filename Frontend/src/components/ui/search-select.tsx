"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Shown faintly after the label, and searchable (e.g. "ext. 436"). */
  hint?: string;
}

/**
 * A select you can type into: click it, start typing a name, and the list
 * narrows as you go. For long lists of people, where scrolling a native
 * <select> to find someone is slow. Looks like SelectNative so the two sit
 * side by side in a form.
 */
function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Choose…",
  searchPlaceholder = "Type a name…",
  emptyText = "No one by that name.",
  disabled,
  isLoading,
  className,
  "aria-describedby": describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const listId = React.useId();
  const chosen = options.find((o) => o.value === value);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={describedBy}
          data-slot="search-select"
          className={cn(
            "border-border bg-background relative flex h-9 w-full items-center rounded-lg border ps-3 pe-8 text-start text-sm outline-none max-sm:h-11 max-sm:text-base",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", !chosen && "text-muted-foreground")}>
            {chosen ? chosen.label : placeholder}
            {chosen?.hint ? (
              <span className="text-muted-foreground"> {chosen.hint}</span>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute end-2.5 top-1/2 size-4 -translate-y-1/2"
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={listId}
          align="start"
          sideOffset={4}
          className="bg-popover text-popover-foreground border-border z-50 w-(--radix-popover-trigger-width) min-w-56 overflow-hidden rounded-lg border shadow-md"
        >
          <Command className="h-auto">
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList className="max-h-64">
              <CommandEmpty>{isLoading ? "Loading…" : emptyText}</CommandEmpty>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  // The value keeps two people with the same name apart.
                  value={`${o.label} ${o.hint ?? ""} ${o.value}`}
                  data-checked={o.value === value}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{o.label}</span>
                  {o.hint ? (
                    <span className="text-muted-foreground ms-auto shrink-0 text-xs">
                      {o.hint}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export { SearchSelect };
