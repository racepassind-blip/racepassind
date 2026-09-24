/**
 * ResultAdapter — routes the public /event/:id/results URL to the correct
 * result UI based on the event's sport (result_type).
 *
 * match_score  → PublicEventResults        (badminton, tennis, squash — unchanged)
 * race_time    → PublicRaceTimeResults     (running, cycling)
 * none/unknown → fallback placeholder
 *
 * Adding a new sport result type:
 *   1. Set result_type in sportConfig.ts
 *   2. Create a new result component
 *   3. Add a case below — existing types are never touched.
 */
import { useParams } from "react-router-dom";
import { usePublicEventResults } from "@/hooks/useEvents";
import { getSportConfig } from "@/data/sportConfig";
import type { ResultType } from "@/data/sportConfig";

// Existing tournament result UI — imported but never modified here.
import PublicEventResults from "@/pages/PublicEventResults";
// Race-time result UI (running / cycling)
import PublicRaceTimeResults from "./PublicRaceTimeResults";
// Fallback placeholder for sports with no result UI yet
import RaceTimeResultsPlaceholder from "./RaceTimeResultsPlaceholder";

/** Select the correct result component for a given result_type. */
function resolveResultComponent(resultType: ResultType): React.ComponentType {
  switch (resultType) {
    case "match_score":
      return PublicEventResults;
    case "race_time":
      return PublicRaceTimeResults;
    case "none":
    default:
      return RaceTimeResultsPlaceholder;
  }
}

const ResultAdapter = () => {
  const { id } = useParams();

  // We use the same hook PublicEventResults uses. When result_type is
  // match_score we hand off to PublicEventResults which calls this hook again
  // — React Query deduplicates the network request.
  const { data } = usePublicEventResults(id);

  const sport = data?.event.category ?? null;
  const resultType = getSportConfig(sport).result_type;
  const ResultComponent = resolveResultComponent(resultType);

  // Render the selected component. Each component reads its own
  // params/hooks independently, keeping them fully self-contained.
  return <ResultComponent />;
};

export default ResultAdapter;
