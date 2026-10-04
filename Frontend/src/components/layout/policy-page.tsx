import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLockup } from "@/components/brand/brand-lockup";
import { Button } from "@/components/ui/button";

/**
 * Shell for the sign-in footer's policy links. The binding text for both
 * documents is owned by KQ Legal and Data Protection, not by this repo —
 * so these pages point at the owners rather than restating policy the
 * product team is not authorised to write.
 */
export function PolicyPage({
  title,
  summary,
  owner,
  contact,
}: {
  title: string;
  summary: string;
  owner: string;
  contact: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="focus-visible:ring-ring mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-14 focus-visible:ring-2 focus-visible:outline-none"
    >
      <BrandLockup eyebrow />
      <h1 className="font-heading mt-10 text-3xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {summary}
      </p>
      <dl className="border-border-subtle mt-8 grid gap-3 border-t pt-6 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Document owner</dt>
        <dd>{owner}</dd>
        <dt className="text-muted-foreground">Questions</dt>
        <dd>
          <a
            href={`mailto:${contact}`}
            className="text-primary hover:underline"
          >
            {contact}
          </a>
        </dd>
      </dl>
      <Button asChild variant="outline" size="lg" className="mt-10 self-start">
        <Link href="/login">
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          Back to sign in
        </Link>
      </Button>
    </main>
  );
}
