import type { Metadata } from "next";
import { FeedbackForm } from "@/features/feedback/feedback-form";

export const metadata: Metadata = {
  title: "How did we do?",
  // The rating token is in this page's URL; keep it out of the Referer
  // header of anything the page loads.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

// Target of the customer's "How did we do?" email (BackendDotNet
// TicketsController.SendFeedbackRequestAsync builds
// `{FRONTEND_ORIGINS[0]}/feedback?token=…&rating=N`). Public: customers have
// no TeleSpy account, so there's no sign-in here and no app chrome.
export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string | string[];
    rating?: string | string[];
  }>;
}) {
  const { token, rating } = await searchParams;
  const value = typeof token === "string" && token.length > 0 ? token : null;
  const picked = typeof rating === "string" ? Number.parseInt(rating, 10) : NaN;

  return (
    <main
      id="main-content"
      className="bg-background flex min-h-svh items-center justify-center px-4 py-10"
    >
      <div className="w-full max-w-md">
        <FeedbackForm
          token={value}
          initialRating={picked >= 1 && picked <= 5 ? picked : null}
        />
      </div>
    </main>
  );
}
