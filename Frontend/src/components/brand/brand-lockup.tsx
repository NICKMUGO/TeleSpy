import { cn } from "@/lib/utils";

/**
 * The app mark: a red tile carrying an abstract wing/tail glyph.
 *
 * Deliberately NOT a redraw of the Kenya Airways bird — that mark is a
 * registered trademark and can't be reproduced from a wireframe sketch.
 * This is a neutral stand-in in the same silhouette family, to be swapped
 * for the licensed asset once brand supplies it (same note as the
 * placeholder --color-kq-red in globals.css).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="size-[60%]"
        role="presentation"
      >
        <path
          d="M3 14.5 21 4 13.5 21l-2.4-6.1L3 14.5Z"
          fill="currentColor"
          strokeLinejoin="round"
          strokeWidth={1.5}
          stroke="currentColor"
        />
      </svg>
    </span>
  );
}

/**
 * Mark + wordmark. `eyebrow` shows the parent-brand line above the product
 * name (sign-in, print headers); the in-app sidebar omits it — the tile
 * alone is enough once you're inside the product.
 */
export function BrandLockup({
  eyebrow = false,
  className,
  markClassName,
}: {
  eyebrow?: boolean;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark className={markClassName} />
      <span className="flex flex-col leading-none">
        {eyebrow ? (
          <span className="text-muted-foreground text-[0.625rem] font-medium tracking-[0.18em] uppercase">
            Kenya Airways
          </span>
        ) : null}
        <span className="text-base font-semibold tracking-tight">TeleSpy</span>
      </span>
    </span>
  );
}
