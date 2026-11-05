import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata: Metadata = {
  title: "Styleguide — TeleSpy",
  description:
    "Design tokens, type scale and component variants, side by side in light and dark.",
};

const COLOR_GROUPS: {
  heading: string;
  pairs: { label: string; token: string; bg: string; fg: string }[];
}[] = [
  {
    heading: "Surfaces",
    pairs: [
      {
        label: "Page",
        token: "background / foreground",
        bg: "bg-background",
        fg: "text-foreground",
      },
      {
        label: "Card",
        token: "card / card-foreground",
        bg: "bg-card",
        fg: "text-card-foreground",
      },
      {
        label: "Popover",
        token: "popover / popover-foreground",
        bg: "bg-popover",
        fg: "text-popover-foreground",
      },
      {
        label: "Muted",
        token: "muted / muted-foreground",
        bg: "bg-muted",
        fg: "text-muted-foreground",
      },
      {
        label: "Accent",
        token: "accent / accent-foreground",
        bg: "bg-accent",
        fg: "text-accent-foreground",
      },
      {
        label: "Secondary",
        token: "secondary / secondary-foreground",
        bg: "bg-secondary",
        fg: "text-secondary-foreground",
      },
    ],
  },
  {
    heading: "Brand & actions",
    pairs: [
      {
        label: "Primary",
        token: "primary / primary-foreground",
        bg: "bg-primary",
        fg: "text-primary-foreground",
      },
      {
        label: "Destructive",
        token: "destructive / destructive-foreground",
        bg: "bg-destructive",
        fg: "text-destructive-foreground",
      },
    ],
  },
  {
    heading: "Status (color + icon + label, never color alone)",
    pairs: [
      {
        label: "Warning",
        token: "warning / warning-foreground",
        bg: "bg-warning",
        fg: "text-warning-foreground",
      },
      {
        label: "Success",
        token: "success / success-foreground",
        bg: "bg-success",
        fg: "text-success-foreground",
      },
      {
        label: "Info",
        token: "info / info-foreground",
        bg: "bg-info",
        fg: "text-info-foreground",
      },
    ],
  },
  {
    heading: "Sidebar",
    pairs: [
      {
        label: "Sidebar",
        token: "sidebar / sidebar-foreground",
        bg: "bg-sidebar",
        fg: "text-sidebar-foreground",
      },
      {
        label: "Sidebar active",
        token: "sidebar-primary / sidebar-primary-foreground",
        bg: "bg-sidebar-primary",
        fg: "text-sidebar-primary-foreground",
      },
      {
        label: "Sidebar hover",
        token: "sidebar-accent / sidebar-accent-foreground",
        bg: "bg-sidebar-accent",
        fg: "text-sidebar-accent-foreground",
      },
    ],
  },
];

function ColorPair({
  label,
  token,
  bg,
  fg,
}: {
  label: string;
  token: string;
  bg: string;
  fg: string;
}) {
  return (
    <div
      className={`border-border flex h-24 flex-col justify-between rounded-lg border p-3 ${bg} ${fg}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="font-mono text-xs opacity-70">--{token}</span>
    </div>
  );
}

function BoundarySwatch({
  label,
  token,
  borderClass,
}: {
  label: string;
  token: string;
  borderClass: string;
}) {
  return (
    <div
      className={`bg-background text-foreground flex h-20 flex-col justify-between rounded-lg border-2 p-3 ${borderClass}`}
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-muted-foreground font-mono text-xs">--{token}</span>
    </div>
  );
}

function ChartSwatch({ n }: { n: 1 | 2 | 3 | 4 | 5 }) {
  const bg = {
    1: "bg-chart-1",
    2: "bg-chart-2",
    3: "bg-chart-3",
    4: "bg-chart-4",
    5: "bg-chart-5",
  }[n];
  return (
    <div
      className={`flex h-16 flex-1 items-end rounded-md p-2 text-xs font-medium text-white ${bg}`}
    >
      chart-{n}
    </div>
  );
}

function StyleguideContent() {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h3 className="mb-3 text-lg font-semibold">Color tokens</h3>
        <div className="flex flex-col gap-6">
          {COLOR_GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="text-muted-foreground mb-2 text-sm font-medium">
                {group.heading}
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {group.pairs.map((pair) => (
                  <ColorPair key={pair.token} {...pair} />
                ))}
              </div>
            </div>
          ))}

          <div>
            <p className="text-muted-foreground mb-2 text-sm font-medium">
              UI boundaries (3:1 minimum against their surface)
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <BoundarySwatch
                label="Border"
                token="border"
                borderClass="border-border"
              />
              <BoundarySwatch
                label="Input"
                token="input"
                borderClass="border-input"
              />
              <BoundarySwatch
                label="Ring"
                token="ring"
                borderClass="border-ring"
              />
            </div>
          </div>

          <div>
            <p className="text-muted-foreground mb-2 text-sm font-medium">
              Chart palette (distinguishable without relying on red/green alone)
            </p>
            <div className="flex gap-2">
              <ChartSwatch n={1} />
              <ChartSwatch n={2} />
              <ChartSwatch n={3} />
              <ChartSwatch n={4} />
              <ChartSwatch n={5} />
            </div>
          </div>
        </div>
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 text-lg font-semibold">Type scale</h3>
        <div className="flex flex-col gap-2">
          <p className="text-4xl font-semibold tracking-tight">
            Text 4xl — page titles
          </p>
          <p className="text-3xl font-semibold tracking-tight">
            Text 3xl — section titles
          </p>
          <p className="text-2xl font-semibold">Text 2xl — card titles</p>
          <p className="text-xl">Text xl — emphasis</p>
          <p className="text-lg">Text lg — lead text</p>
          <p className="text-base">Text base — body copy</p>
          <p className="text-muted-foreground text-sm">
            Text sm — secondary text
          </p>
          <p className="text-muted-foreground text-xs">
            Text xs — captions, metadata
          </p>
        </div>
        <div className="border-border bg-muted mt-4 flex flex-col gap-1 rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            Tabular numerals — MSISDNs, ICCIDs, KES amounts, durations,
            timestamps
          </p>
          <p className="font-tabular text-lg">+254 712 345 678</p>
          <p className="font-tabular text-lg">KES 12,450.00</p>
          <p className="font-tabular text-lg">2026-08-17 09:41:03</p>
        </div>
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 text-lg font-semibold">Buttons</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="default">Allocate SIM</Button>
          <Button variant="secondary">Save draft</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">Dismiss</Button>
          <Button variant="destructive">Deallocate SIM</Button>
          <Button variant="link">View usage history</Button>
          <Button variant="default" disabled>
            Allocate SIM
          </Button>
        </div>
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 text-lg font-semibold">Badges / status chips</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Critical</Badge>
        </div>
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 text-lg font-semibold">Card</h3>
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>SIM +254 712 345 678</CardTitle>
            <CardDescription>
              Assigned to Grace Wanjiru — Finance
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Active since 2026-03-02. Standard tariff plan.
          </CardContent>
          <CardFooter className="gap-2">
            <Button size="sm" variant="outline">
              View history
            </Button>
            <Button size="sm" variant="destructive">
              Deallocate
            </Button>
          </CardFooter>
        </Card>
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 text-lg font-semibold">Form controls</h3>
        <div className="flex max-w-sm flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="styleguide-cost-centre">Cost centre</Label>
            <Input id="styleguide-cost-centre" placeholder="e.g. CC-4021" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="styleguide-disabled">Employee ID (read-only)</Label>
            <Input id="styleguide-disabled" defaultValue="EMP-00842" disabled />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="styleguide-switch" defaultChecked />
            <Label htmlFor="styleguide-switch">Notify on budget breach</Label>
          </div>
        </div>
      </section>

      <Separator />

      <section>
        <h3 className="mb-3 text-lg font-semibold">Tabs</h3>
        <Tabs defaultValue="overview" className="max-w-sm">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent
            value="overview"
            className="text-muted-foreground text-sm"
          >
            Overview content.
          </TabsContent>
          <TabsContent value="usage" className="text-muted-foreground text-sm">
            Usage content.
          </TabsContent>
          <TabsContent
            value="history"
            className="text-muted-foreground text-sm"
          >
            History content.
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Styleguide</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          Every design token, type step and component variant, rendered side by
          side in light and dark. This is how the design gets reviewed — not the
          running app. The Kenya Airways red shown here is a placeholder pending
          confirmation against the official brand guide.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="border-border bg-background text-foreground rounded-xl border p-6">
          <h2 className="text-muted-foreground mb-6 text-sm font-semibold tracking-wide uppercase">
            Light
          </h2>
          <StyleguideContent />
        </section>

        <section className="dark border-border bg-background text-foreground rounded-xl border p-6">
          <h2 className="text-muted-foreground mb-6 text-sm font-semibold tracking-wide uppercase">
            Dark
          </h2>
          <StyleguideContent />
        </section>
      </div>
    </div>
  );
}
