"use client";

import { useMemo, useState } from "react";
import { FingerprintPattern, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/empty-state";
import { ErrorBanner } from "@/components/data/error-banner";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import type { UsageProfile } from "@/lib/api/types";
import { useUsageProfiles } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

type GroupKey = NonNullable<UsageProfile["cluster_label"]> | "unprofiled";

/** One group per KMeans cluster, heaviest first, then anyone the model
 * hasn't profiled yet. Each tone sets the circle, border and chips. */
const GROUPS: {
  key: GroupKey;
  title: string;
  description: string;
  circle: string;
  card: string;
  chip: string;
}[] = [
  {
    key: "high_usage",
    title: "High usage",
    description: "Call the most — watch these against their limits.",
    circle: "bg-destructive text-destructive-foreground",
    card: "border-destructive/40 bg-destructive/5",
    chip: "border-destructive/30 bg-destructive/10",
  },
  {
    key: "moderate_usage",
    title: "Moderate usage",
    description: "Steady, middle-of-the-range calling.",
    circle: "bg-warning text-warning-foreground",
    card: "border-warning/40 bg-warning/5",
    chip: "border-warning/30 bg-warning/10",
  },
  {
    key: "low_usage",
    title: "Low usage",
    description: "Make few or short paid calls.",
    circle: "bg-success text-success-foreground",
    card: "border-success/40 bg-success/5",
    chip: "border-success/30 bg-success/10",
  },
  {
    key: "unprofiled",
    title: "Not yet profiled",
    description: "Too little calling for the model to place them.",
    circle: "bg-muted-foreground text-background",
    card: "border-border bg-muted/30",
    chip: "border-border bg-muted",
  },
];

export default function ProfilesPage() {
  const profiles = useUsageProfiles();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const all = useMemo(() => profiles.data?.data ?? [], [profiles.data]);
  const grouped = useMemo(() => {
    const byGroup = new Map<GroupKey, UsageProfile[]>(
      GROUPS.map((g) => [g.key, []]),
    );
    for (const profile of all) {
      byGroup.get(profile.cluster_label ?? "unprofiled")?.push(profile);
    }
    for (const members of byGroup.values()) {
      members.sort((a, b) => a.full_name.localeCompare(b.full_name));
    }
    return byGroup;
  }, [all]);

  const matches = needle
    ? all.filter((p) => p.full_name.toLowerCase().includes(needle)).length
    : null;

  return (
    <>
      <PageHeader
        title="Usage profiles"
        description="Employees grouped by calling behaviour — KMeans clustering into high, moderate and low usage."
      />
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <InputGroup className="w-full sm:w-80">
            <InputGroupAddon>
              <Search aria-hidden="true" className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Find an employee…"
              aria-label="Find an employee"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          {matches !== null ? (
            <p className="text-muted-foreground text-sm" aria-live="polite">
              {matches === 0
                ? "Nobody matches that name."
                : `${matches} match${matches === 1 ? "" : "es"} highlighted.`}
            </p>
          ) : null}
        </div>

        {profiles.error ? (
          <ErrorBanner
            error={profiles.error}
            onRetry={() => profiles.refetch()}
          />
        ) : profiles.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <EmptyState
            icon={FingerprintPattern}
            title="No usage profiles yet"
            description="Run ML/training/usage_profiling.py to populate this view."
          />
        ) : (
          <div
            data-tour="profiles-groups"
            className="grid items-start gap-4 lg:grid-cols-3"
          >
            {GROUPS.map((group) => {
              const members = grouped.get(group.key) ?? [];
              // Only show the "not yet profiled" group when it has anyone.
              if (group.key === "unprofiled" && members.length === 0) {
                return null;
              }
              const share = Math.round((100 * members.length) / all.length);
              return (
                <section
                  key={group.key}
                  aria-labelledby={`group-${group.key}`}
                  className={cn(
                    "flex flex-col gap-4 rounded-xl border p-4",
                    group.card,
                    group.key === "unprofiled" && "lg:col-span-3",
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        "flex size-20 shrink-0 flex-col items-center justify-center rounded-full shadow-sm",
                        group.circle,
                      )}
                      aria-hidden="true"
                    >
                      <span className="text-2xl leading-none font-semibold tabular-nums">
                        {members.length}
                      </span>
                      <span className="mt-1 text-xs opacity-90">{share}%</span>
                    </div>
                    <div className="min-w-0">
                      <h2
                        id={`group-${group.key}`}
                        className="text-base font-semibold"
                      >
                        {group.title}
                        <span className="sr-only">
                          : {members.length} employees, {share}% of staff
                        </span>
                      </h2>
                      <p className="text-muted-foreground text-sm">
                        {group.description}
                      </p>
                    </div>
                  </div>

                  {members.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      Nobody in this group.
                    </p>
                  ) : (
                    <ul className="flex max-h-96 flex-wrap gap-1.5 overflow-y-auto">
                      {members.map((member) => {
                        const hit =
                          needle !== "" &&
                          member.full_name.toLowerCase().includes(needle);
                        return (
                          <li
                            key={member.employee_id}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs transition-opacity",
                              group.chip,
                              needle !== "" && !hit && "opacity-30",
                              hit && "ring-ring font-semibold ring-2",
                            )}
                          >
                            {member.full_name}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
