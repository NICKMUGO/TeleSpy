import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Facts about the thing on screen (a ticket's number, category, who
   * raised it), shown small under the title. Pages don't describe
   * themselves here — the large title is enough. */
  meta?: string;
  /** Right-aligned controls for the page as a whole (period picker,
   * export, primary action). Wraps under the title on narrow screens. */
  actions?: ReactNode;
}

/** iOS-style large title: bold, tight, sitting straight on the page
 * background with no rule under it. */
export function PageHeader({ title, meta, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 px-4 pt-6 pb-2 sm:px-6 sm:pt-8">
      <div className="min-w-0">
        <h1 className="font-heading text-[1.75rem] leading-tight font-bold tracking-tight sm:text-[2.125rem]">
          {title}
        </h1>
        {meta ? (
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{meta}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
