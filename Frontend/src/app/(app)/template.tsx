import type { ReactNode } from "react";

/** A template (unlike a layout) mounts afresh on every navigation, so each
 * new page fades in while rising a few pixels — the shell around it (top
 * bar, sidebar, tab bar) stays still. */
export default function PageTransition({ children }: { children: ReactNode }) {
  return <div className="animate-rise flex flex-1 flex-col">{children}</div>;
}
