/**
 * Placeholder for race-time (running/cycling) results.
 *
 * Replace the body of this component when timed results are implemented.
 * The props contract is intentionally identical to what PublicEventResults
 * would receive so swapping in real data is a drop-in replacement.
 */
import { Timer, ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";

const RaceTimeResultsPlaceholder = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  return (
    <Layout>
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Timer className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-tight">
          Race results coming soon
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Finish-time results for running and cycling events are not yet
          available on this board. Check back after the event.
        </p>
        <Button
          variant="outline"
          className="mt-6 gap-2"
          onClick={() => navigate(id ? `/event/${encodeURIComponent(id)}` : "/")}
        >
          <ArrowLeft className="h-4 w-4" /> Back to event
        </Button>
      </div>
    </Layout>
  );
};

export default RaceTimeResultsPlaceholder;
