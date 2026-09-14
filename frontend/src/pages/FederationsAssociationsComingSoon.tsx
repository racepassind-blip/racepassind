import { ArrowLeft, BadgeCheck, BarChart3, Building2, GitBranch, Headset, Trophy } from "lucide-react";
import { Link } from "react-router-dom";

import { Layout } from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  {
    icon: Trophy,
    title: "Cross-event result aggregation",
    summary: "Combine district and qualifier events into one leaderboard.",
    description: "Keep every stage of a championship connected. Federation teams can preserve the full result history for each rider, combine scores across venues and categories, and give officials and participants one reliable view of standings instead of separate spreadsheets for every round.",
  },
  {
    icon: BadgeCheck,
    title: "Official licensing fields",
    summary: "Capture UCI/FMSCI IDs and government registration details at sign-up.",
    description: "Collect the identifiers and registration information needed for sanctioned events as part of the registration flow. Structured licensing fields make verification easier, reduce repeated data entry, and keep a dependable record for future events and audits.",
  },
  {
    icon: GitBranch,
    title: "Qualification & ranking logic",
    summary: "Automatically carry results into next-round eligibility.",
    description: "Define how categories, heats, points, and qualification thresholds work across a series. Once results are recorded, eligible participants can move into the next round without manually rebuilding lists or losing the context of their previous performance.",
  },
  {
    icon: Headset,
    title: "Dedicated support with faster response times",
    summary: "Get a support path designed for federation-scale race operations.",
    description: "Coordinate with a team that understands multi-event calendars, sanctioned competition, and race-day deadlines. Dedicated support will help resolve operational questions faster when several organizers, officials, and venues are working on the same series.",
  },
  {
    icon: BarChart3,
    title: "Custom reports for sponsors & government bodies",
    summary: "Turn event and participation data into ready-to-share reports.",
    description: "Build reports around the metrics your stakeholders need: participation by category, district and venue performance, qualification progress, licensing coverage, and series reach. Exportable reporting will make sponsor updates and government submissions easier to prepare and verify.",
  },
];

export default function FederationsAssociationsComingSoon() {
  return (
    <Layout>
      <div className="mx-auto max-w-[1500px] space-y-10 px-4 py-10 sm:px-6 lg:px-8">

        <section className="relative overflow-hidden rounded-2xl border bg-muted/20 p-6 sm:p-10">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <Badge variant="secondary" className="mb-4 gap-2 px-3 py-1.5 text-primary">
                <Building2 className="h-4 w-4" /> Coming Soon
              </Badge>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Built for Federations &amp; State Associations</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">A dedicated toolkit for managing multi-event, multi-category races — coming soon.</p>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-muted-foreground">We are shaping RacePass into a shared operating layer for championship calendars, sanctioned events, and regional race series. The capabilities below are designed to help associations maintain continuity across stages while keeping historical results, participant records, and official reporting accessible in one place.</p>
              <Button asChild variant="outline" className="mt-6 gap-2">
                <Link to="/"><ArrowLeft className="h-4 w-4" /> Back to Events</Link>
              </Button>
            </div>
            <div className="hidden shrink-0 rounded-2xl border border-primary/15 bg-card p-8 shadow-sm sm:block lg:mr-8">
              <Building2 className="h-20 w-20 text-primary/50" strokeWidth={1.25} />
            </div>
          </div>
        </section>

        <section>
          <div className="mb-5">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">Future capabilities</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">One connected record for every stage</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">Each capability is planned to reduce manual reconciliation, protect access to previous results, and give federations a clearer view of the people and performance behind an entire race series.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, summary, description }) => (
              <Card key={title} className="border-border/80 bg-card/80">
                <CardHeader className="pb-3">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">Coming Soon</Badge>
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription className="pt-1 font-medium leading-5 text-foreground/70">{summary}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
