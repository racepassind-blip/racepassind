import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Search, Hash, CalendarDays, MapPin, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { usePublicNumberList } from "@/hooks/useAllocations";

const PublicEventNumberList = () => {
  const { eventId } = useParams();
  const { data, isLoading, isError } = usePublicNumberList(eventId || "");

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const numberLabel = data?.numberLabel || "Number";
  const entries = data?.entries ?? [];

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const matchesSearch =
        entry.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.allocationNumber.toString().includes(searchTerm);
      const matchesCategory = filterCategory === "all" || entry.categoryName === filterCategory;
      return matchesSearch && matchesCategory;
    });
  }, [entries, searchTerm, filterCategory]);

  const categories = data?.categories ?? [];

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Loading {numberLabel.toLowerCase()} list…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              This list isn't available. Numbers may not be published yet.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1000px] space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary">{data.event.sport?.replaceAll("_", " ")}</p>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{numberLabel} List</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{data.event.title}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {data.event.date && (
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                {new Date(`${data.event.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
              </span>
            )}
            {data.event.location && (
              <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" />{data.event.location}</span>
            )}
          </div>
        </div>

        {/* Search & filter */}
        <Card>
          <CardHeader>
            <CardTitle>Find your {numberLabel.toLowerCase()}</CardTitle>
            <CardDescription>Search by name or number, or filter by category</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or number..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.name}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Privacy notice */}
        <Alert className="border-l-4 border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertDescription className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="text-xs">
              For privacy, only the first name and last initial are shown. Log in to your account to see your full details.
            </span>
          </AlertDescription>
        </Alert>

        {/* Number list */}
        <Card>
          <CardHeader>
            <CardTitle>{numberLabel} Assignments</CardTitle>
            <CardDescription>
              {filteredEntries.length} of {entries.length} published
              {searchTerm && ` matching "${searchTerm}"`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">
                      <span className="inline-flex items-center gap-2"><Hash className="h-4 w-4" />{numberLabel}</span>
                    </TableHead>
                    <TableHead>Participant</TableHead>
                    <TableHead>Category</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={`${entry.allocationNumber}-${entry.displayName}`}>
                      <TableCell>
                        <span className="font-mono text-lg font-bold">{entry.allocationNumber}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{entry.displayName}</span>
                          {entry.teamName && (
                            <span className="text-xs text-muted-foreground">{entry.teamName}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{entry.categoryName || "Uncategorized"}</TableCell>
                    </TableRow>
                  ))}
                  {filteredEntries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                        {searchTerm ? "No matches found" : "No numbers have been published yet"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicEventNumberList;
