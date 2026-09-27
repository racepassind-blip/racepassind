import { useEffect, useState } from "react";
import { ArrowRight, Calculator, HelpCircle, Trophy, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TournamentFormat = "league" | "knockout";

interface TournamentSetupGuideProps {
  eventId: string;
  initialFormat: TournamentFormat;
}

export const leagueFixtureCount = (competitors: number) => competitors * (competitors - 1) / 2;

export function knockoutSuggestion(competitors: number) {
  const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(2, competitors)));
  const byes = bracketSize - competitors;
  const firstRoundMatches = competitors - bracketSize / 2;
  const labels: Record<number, string> = { 2: "Final", 4: "Semifinals", 8: "Quarterfinals" };
  const rounds = [];
  for (let remaining = bracketSize; remaining >= 2; remaining /= 2) {
    const firstRound = remaining === bracketSize;
    rounds.push({
      name: labels[remaining] ?? `Round of ${remaining}`,
      matches: firstRound ? firstRoundMatches : remaining / 2,
      byes: firstRound ? byes : 0,
      advances: remaining / 2,
    });
  }
  return { bracketSize, byes, firstRoundMatches, rounds };
}

type PreviewMatch = { label: string; left: string; right: string };
type PreviewStage = { name: string; matches: PreviewMatch[] };
const MAX_FULL_PREVIEW_BRACKET = 16;

function stageMatchLabel(name: string, index: number) {
  if (name === "Final") return "Final";
  const singular = name === "Semifinals" ? "Semifinal" : name === "Quarterfinals" ? "Quarterfinal" : "Match";
  return `${singular} ${index + 1}`;
}

function stageReference(name: string, index: number) {
  if (name === "Semifinals") return `SF${index + 1}`;
  if (name === "Quarterfinals") return `QF${index + 1}`;
  const roundNumber = name.match(/\d+/)?.[0];
  return roundNumber ? `R${roundNumber}-${index + 1}` : `M${index + 1}`;
}

export function dummyBracketPreview(competitors: number): PreviewStage[] {
  const suggestion = knockoutSuggestion(competitors);
  if (suggestion.bracketSize > MAX_FULL_PREVIEW_BRACKET) return [];

  let competitor = 1;
  const firstRoundSlots = suggestion.bracketSize / 2;
  const byeMatches = new Set(Array.from({ length: suggestion.byes }, (_, index) => Math.floor(index * firstRoundSlots / suggestion.byes)));
  const stages: PreviewStage[] = suggestion.rounds.map((round) => ({ name: round.name, matches: [] }));
  stages[0].matches = Array.from({ length: firstRoundSlots }, (_, index) => ({
    label: `Match ${index + 1}`,
    left: `Competitor ${competitor++}`,
    right: byeMatches.has(index) ? "BYE" : `Competitor ${competitor++}`,
  }));

  for (let stageIndex = 1; stageIndex < stages.length; stageIndex += 1) {
    const previous = stages[stageIndex - 1];
    stages[stageIndex].matches = Array.from({ length: previous.matches.length / 2 }, (_, index) => {
      const sourceA = stageIndex === 1 ? `M${index * 2 + 1}` : stageReference(previous.name, index * 2);
      const sourceB = stageIndex === 1 ? `M${index * 2 + 2}` : stageReference(previous.name, index * 2 + 1);
      return { label: stageMatchLabel(stages[stageIndex].name, index), left: `Winner ${sourceA}`, right: `Winner ${sourceB}` };
    });
  }
  return stages;
}

const leagueSteps = [
  ["1", "Choose League", "Save the format in Tournament Setup."],
  ["2", "Create matches", "Create each fixture and select both competitors."],
  ["3", "Schedule and score", "Set the court and time, then enter the game scores."],
  ["4", "Standings and results", "Standings update after completion. Approve results when they are ready for the public."],
];

const knockoutSteps = [
  ["1", "Choose Knockout", "Add the rounds you need, such as Semifinals and Final."],
  ["2", "Create the first round", "Select both competitors for every match. Byes are managed manually."],
  ["3", "Complete paired matches", "Enter valid scores. Winners advance when automatic advancement is enabled."],
  ["4", "Schedule the next round", "Review the new matchup, assign its time, then continue to the Final."],
];

const TournamentSetupGuide = ({ initialFormat }: TournamentSetupGuideProps) => {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<TournamentFormat>(initialFormat);
  const [participantCount, setParticipantCount] = useState(4);

  useEffect(() => {
    if (open) {
      setFormat(initialFormat);
      setParticipantCount(4);
    }
  }, [initialFormat, open]);

  const count = Math.max(2, Math.min(256, Math.trunc(participantCount || 2)));
  const knockout = knockoutSuggestion(count);

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="outline" className="gap-2"><HelpCircle className="h-4 w-4" />How tournament setup works</Button></DialogTrigger>
    <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto p-0">
      <DialogHeader className="border-b p-6 pr-12">
        <DialogTitle className="text-xl">Tournament setup guide</DialogTitle>
        <DialogDescription>Choose a format, create the matches and record the results.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Tournament format guide">
          <FormatTab active={format === "league"} onClick={() => setFormat("league")} icon={Users} title="League" detail="Everyone keeps playing" />
          <FormatTab active={format === "knockout"} onClick={() => setFormat("knockout")} icon={Trophy} title="Knockout" detail="Winners move forward" />
        </div>

        <section className="rounded-xl border p-4 sm:p-5">
          <h3 className="font-semibold">{format === "league" ? "League flow" : "Knockout flow"}</h3>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(format === "league" ? leagueSteps : knockoutSteps).map(([number, title, description]) => <li key={number} className="rounded-lg bg-muted/35 p-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{number}</span><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></li>)}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">Scores decide whether the selected winner is valid. Publishing is a separate approval step.</p>
        </section>

        <section className="rounded-xl border bg-muted/20 p-4 sm:p-5">
          <div className="flex items-start gap-3"><Calculator className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><h3 className="font-semibold">Quick calculator</h3><p className="mt-1 text-sm text-muted-foreground">For planning only. Nothing is created or saved.</p></div></div>
          <div className="mt-4 max-w-xs space-y-2"><Label htmlFor="guide-participants">Players, pairs or teams</Label><Input id="guide-participants" type="number" min={2} max={256} value={participantCount} onChange={(event) => setParticipantCount(Number(event.target.value))} /></div>
          {format === "league" ? <LeagueCalculation count={count} /> : <KnockoutCalculation count={count} suggestion={knockout} />}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
};

const FormatTab = ({ active, onClick, icon: Icon, title, detail }: { active: boolean; onClick: () => void; icon: typeof Users; title: string; detail: string }) => <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`rounded-lg px-4 py-3 text-left ${active ? "bg-background shadow-sm" : "text-muted-foreground"}`}><span className="flex items-center gap-2 font-semibold"><Icon className="h-4 w-4" />{title}</span><span className="mt-1 block text-xs">{detail}</span></button>;

const LeagueCalculation = ({ count }: { count: number }) => <div className="mt-4 rounded-lg bg-background p-4"><p className="font-semibold">{count} competitors need {leagueFixtureCount(count)} matches</p><p className="mt-1 text-xs text-muted-foreground">Formula: n × (n - 1) / 2. Create these fixtures manually.</p></div>;

const KnockoutCalculation = ({ count, suggestion }: { count: number; suggestion: ReturnType<typeof knockoutSuggestion> }) => <div className="mt-4 space-y-3">
  <div className="grid gap-3 rounded-lg bg-background p-4 sm:grid-cols-3"><Metric label="Competitors" value={count} /><Metric label="Bracket size" value={suggestion.bracketSize} /><Metric label="Byes" value={suggestion.byes} /></div>
  <div className="grid gap-2 sm:grid-cols-2" aria-label="Knockout stage plan">{suggestion.rounds.map((round, index) => <div key={round.name} className="rounded-lg border bg-background p-3"><p className="text-sm font-semibold">{round.name}</p>{index === 0 && round.byes > 0 ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{round.matches} matches played · {round.byes} byes · {round.advances} advance</p> : <p className="mt-1 text-xs text-muted-foreground">{round.matches} {round.matches === 1 ? "match" : "matches"}</p>}</div>)}</div>
  {suggestion.byes > 0 && <p className="text-xs text-muted-foreground">Byes are not assigned automatically. Set up the first round manually.</p>}
  <DummyBracketPreview competitors={count} suggestion={suggestion} />
</div>;

const Metric = ({ label, value }: { label: string; value: number }) => <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>;

const DummyBracketPreview = ({ competitors, suggestion }: { competitors: number; suggestion: ReturnType<typeof knockoutSuggestion> }) => {
  const stages = dummyBracketPreview(competitors);
  return <details className="rounded-lg border bg-background p-4" aria-label="Example bracket preview">
    <summary className="cursor-pointer text-sm font-semibold">Show example bracket</summary>
    <p className="mt-2 text-xs text-muted-foreground">Example only. Actual competitors, matches and byes are configured manually.</p>
    {stages.length > 0 ? <div className="mt-4 flex gap-3 overflow-x-auto pb-2">{stages.map((stage, stageIndex) => <div key={stage.name} className="flex shrink-0 items-center gap-3"><div className="w-48"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{stage.name}</p><div className="space-y-2">{stage.matches.map((match) => <div key={match.label} className="rounded-md border bg-muted/20 p-2.5 text-xs"><p className="font-semibold">{match.label}</p><p className="mt-1">{match.left}</p><p className="text-muted-foreground">vs</p><p className={match.right === "BYE" ? "font-semibold text-amber-700" : ""}>{match.right}</p></div>)}</div></div>{stageIndex < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}</div>)}</div> : <div className="mt-4 grid gap-2 sm:grid-cols-2">{suggestion.rounds.map((round, index) => <div key={round.name} className="rounded-md bg-muted/40 p-3 text-sm"><p className="font-medium">{round.name}</p><p className="mt-1 text-xs text-muted-foreground">{index === 0 && round.byes > 0 ? `${round.matches} played · ${round.byes} byes` : `${round.matches} ${round.matches === 1 ? "match" : "matches"}`}</p></div>)}</div>}
    {suggestion.bracketSize > MAX_FULL_PREVIEW_BRACKET && <p className="mt-3 text-xs text-muted-foreground">A compact preview is shown for brackets larger than 16 places.</p>}
  </details>;
};

export default TournamentSetupGuide;
