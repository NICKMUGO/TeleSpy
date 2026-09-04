import type { LucideIcon } from "lucide-react";

interface StubNoticeProps {
  icon: LucideIcon;
  children: string;
}

// Placeholder body for routes whose real screen isn't built yet — this is
// scaffolding text for Phase 3 (app shell/navigation), not the Phase 4
// EmptyState primitive (which will handle real "no data yet" cases once
// screens are wired to the mock/real API in later phases).
export function StubNotice({ icon: Icon, children }: StubNoticeProps) {
  return (
    <div className="border-border m-6 flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
      <Icon aria-hidden="true" className="text-muted-foreground size-8" />
      <p className="text-muted-foreground max-w-sm text-sm">{children}</p>
    </div>
  );
}
