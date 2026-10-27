import type { LucideIcon } from "lucide-react";
import { IconBadge } from "@/components/data/icon-badge";

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
    <div className="m-4 flex flex-1 flex-col items-center justify-center gap-4 px-6 py-14 text-center sm:m-6">
      <IconBadge icon={Icon} />
      <p className="text-muted-foreground max-w-sm text-sm">{children}</p>
    </div>
  );
}
