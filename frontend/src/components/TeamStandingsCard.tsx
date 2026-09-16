import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizerStandings, type OrganizerEventCategory } from "@/hooks/useEvents";

interface TeamStandingsCardProps {
  eventId: string;
  categories: OrganizerEventCategory[];
}

const TeamStandingsCard = ({ eventId, categories }: TeamStandingsCardProps) => {
  const teamCategories = categories.filter((category) => category.entryType === "team");
  const [categoryId, setCategoryId] = useState(teamCategories[0]?.id ?? "");

  useEffect(() => {
    if (!categoryId && teamCategories[0]) setCategoryId(teamCategories[0].id);
  }, [teamCategories, categoryId]);

  const { data: standings = [], isLoading } = useOrganizerStandings(eventId, categoryId || undefined);

  if (teamCategories.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Standings</CardTitle>
            <CardDescription>League table computed from completed team matches.</CardDescription>
          </div>
          {teamCategories.length > 1 && (
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {teamCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading standings…</p>
        ) : standings.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No completed team matches yet. Standings appear once matches are completed.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-center">P</TableHead>
                  <TableHead className="text-center">W</TableHead>
                  <TableHead className="text-center">D</TableHead>
                  <TableHead className="text-center">L</TableHead>
                  <TableHead className="text-center">BW</TableHead>
                  <TableHead className="text-center">BL</TableHead>
                  <TableHead className="text-center font-bold">Pts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((row) => (
                  <TableRow key={row.registrationId}>
                    <TableCell>
                      <div className="font-medium">{row.teamName}</div>
                      {row.captainName && row.captainName !== row.teamName && (
                        <div className="text-xs text-muted-foreground">Captain: {row.captainName}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{row.matchesPlayed}</TableCell>
                    <TableCell className="text-center">{row.wins}</TableCell>
                    <TableCell className="text-center">{row.draws}</TableCell>
                    <TableCell className="text-center">{row.losses}</TableCell>
                    <TableCell className="text-center">{row.boutsWon}</TableCell>
                    <TableCell className="text-center">{row.boutsLost}</TableCell>
                    <TableCell className="text-center font-bold">{row.points}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">P: played · W: wins · D: draws · L: losses · BW: bouts won · BL: bouts lost · Pts: points</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TeamStandingsCard;
