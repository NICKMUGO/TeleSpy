import {
  BRAND_HANDSET_PATH,
  BRAND_WAVES_PATH,
  BRAND_WAVES_STROKE,
} from "@/lib/brand-glyph";
import { cn } from "@/lib/utils";

/**
 * The app mark: a red tile carrying a ringing phone handset, for the
 * product's telecom focus. Deliberately not the Kenya Airways bird, which is
 * a registered trademark.
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
        <path d={BRAND_HANDSET_PATH} fill="currentColor" />
        <path
          d={BRAND_WAVES_PATH}
          stroke="currentColor"
          strokeWidth={BRAND_WAVES_STROKE}
          strokeLinecap="round"
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
