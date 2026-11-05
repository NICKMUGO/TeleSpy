import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/policy-page";

export const metadata: Metadata = { title: "Terms — TeleSpy" };

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of use"
      summary="TeleSpy is an internal Kenya Airways system. Access is granted per role, and use is subject to the Kenya Airways acceptable-use and IT security policies."
      owner="Kenya Airways IT Security"
      contact="itsecurity@kenya-airways.com"
    />
  );
}
