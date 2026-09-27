import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizerStandings, type OrganizerEventCategory } from "@/hooks/useEvents";

interface TeamStandingsCardProps {
  eventId: string;
  categories: OrganizerEventCategory[];
  includeIndividualStandings?: boolean;
}

const TeamStandingsCard = ({ eventId, categories, includeIndividualStandings = false }: TeamStandingsCardProps) => {
  const teamCategories = categories.filter((category) => category.entryType === "team" || (includeIndividualStandings && ["singles", "doubles"].includes(category.entryType)));
  const [categoryId, setCategoryId] = useState(teamCategories[0]?.id ?? "");

  useEffect(() => {
    if (!teamCategories.some((category) => category.id === categoryId)) setCategoryId(teamCategories[0]?.id ?? "");
  }, [teamCategories, categoryId]);

  const { data: standings = [], isLoading } = useOrganizerStandings(eventId, categoryId || undefined);
  const isTeam = teamCategories.find((category) => category.id === categoryId)?.entryType === "team";

  if (teamCategories.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Standings</CardTitle>
            <CardDescription>{isTeam ? "League table computed from completed team matches." : "Completed League results. Win: 2 points · Loss: 0 points."}</CardDescription>
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
            No completed results yet. Standings appear once matches have a winner.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{isTeam ? "Team" : "Player / Pair"}</TableHead>
                  <TableHead className="text-center">{isTeam ? "P" : "Played"}</TableHead>
                  <TableHead className="text-center">{isTeam ? "W" : "Won"}</TableHead>
                  {isTeam && <TableHead className="text-center">D</TableHead>}
                  <TableHead className="text-center">{isTeam ? "L" : "Lost"}</TableHead>
                  <TableHead className="text-center font-bold">{isTeam ? "Pts" : "Points"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((row) => (
                  <TableRow key={row.registrationId}>
                    <TableCell>
                      <div className="font-medium">{row.displayName ?? row.teamName}</div>
                      {isTeam && row.captainName && row.captainName !== row.teamName && (
                        <div className="text-xs text-muted-foreground">Captain: {row.captainName}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{row.matchesPlayed}</TableCell>
                    <TableCell className="text-center">{row.wins}</TableCell>
                    {isTeam && <TableCell className="text-center">{row.draws}</TableCell>}
                    <TableCell className="text-center">{row.losses}</TableCell>
                    <TableCell className="text-center font-bold">{row.points}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {isTeam && <p className="mt-3 text-xs text-muted-foreground">P: played · W: wins · D: draws · L: losses · Pts: points</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TeamStandingsCard;
