import type { Metadata } from "next";
import { PolicyPage } from "@/components/layout/policy-page";

export const metadata: Metadata = { title: "Privacy — TeleSpy" };

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy"
      summary="TeleSpy processes call detail records, SIM assignments and monthly spend for Kenya Airways staff telephony. Handling of that data is governed by the Kenya Airways employee privacy notice and the Data Protection Act, 2019 — this product does not set its own policy."
      owner="Kenya Airways Data Protection Office"
      contact="dpo@kenya-airways.com"
    />
  );
}
