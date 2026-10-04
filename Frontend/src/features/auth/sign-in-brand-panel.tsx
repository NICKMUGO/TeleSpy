import { BrandLockup } from "@/components/brand/brand-lockup";
import { cn } from "@/lib/utils";

// The four stages a CDR row actually passes through in this system, in
// order: POST /cdr/ingest -> attribution against SimAllocation ->
// ML/training/anomaly_detection.py (Isolation Forest) -> the manager-facing
// anomaly/budget screens. Step 3 is highlighted because it's the part that
// distinguishes TeleSpy from a plain billing report.
const PIPELINE_STEPS = [
  { body: "Carrier CDR batch uploaded" },
  { body: "Validated, parsed & attributed to employee + SIM" },
  { body: "Isolation Forest scores usage against baseline", accent: true },
  { body: "Anomalies, budgets & spend surfaced to managers" },
];

const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL ?? "local dev";

/**
 * Left panel of the split sign-in screen: brand lockup, the product's
 * one-line promise, and the ingest-to-insight pipeline as a numbered
 * stepper. Hidden below lg — on phones the form is the whole screen and
 * this would push it under the fold.
 */
export function SignInBrandPanel() {
  return (
    <aside className="bg-brand-wash border-brand-wash-border relative isolate hidden overflow-hidden border-e px-10 py-12 lg:flex lg:w-[44%] lg:max-w-xl lg:shrink-0 lg:flex-col">
      {/* Decorative flight path — a nod to the parent brand. First in the
       * DOM and z-0, with the panel content lifted to z-10 above it, so it
       * sits over the wash but under the text. Out of the a11y tree. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 400 260"
        fill="none"
        className="text-primary/30 pointer-events-none absolute right-0 bottom-10 z-0 w-80"
      >
        <path
          d="M392 8C300 40 250 96 196 150c-40 40-92 70-156 78"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 7"
          strokeLinecap="round"
        />
        <path
          d="M214 128 176 148l10 4 2 11 26-35Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      <BrandLockup eyebrow className="relative z-10" />

      <h2 className="font-heading relative z-10 mt-10 max-w-sm text-2xl leading-snug font-semibold tracking-tight text-balance">
        SIM management &amp; telecom cost accountability
      </h2>

      <p className="text-muted-foreground relative z-10 mt-10 text-[0.6875rem] font-medium tracking-[0.16em] uppercase">
        How TeleSpy works
      </p>

      <ol className="relative z-10 mt-4 flex max-w-sm flex-col">
        {PIPELINE_STEPS.map((step, index) => (
          <li key={step.body}>
            <div
              className={cn(
                "bg-card rounded-lg border px-4 py-3",
                step.accent
                  ? "border-primary/40 ring-primary/10 ring-1"
                  : "border-brand-wash-border",
              )}
            >
              <span
                className={cn(
                  "font-tabular block text-[0.625rem] font-semibold",
                  step.accent ? "text-primary" : "text-muted-foreground",
                )}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="mt-1 block text-sm leading-snug">
                {step.body}
              </span>
            </div>
            {index < PIPELINE_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className="bg-brand-wash-border mx-auto block h-4 w-px"
              />
            ) : null}
          </li>
        ))}
      </ol>

      <p className="text-muted-foreground relative z-10 mt-auto pt-10 text-xs">
        Build {BUILD_LABEL}
      </p>

    </aside>
  );
}
