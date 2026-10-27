import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconBadge } from "@/components/data/icon-badge";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <IconBadge icon={SearchX} />
      <div>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-muted-foreground mt-1 max-w-md text-sm">
          This page does not exist or may have moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
