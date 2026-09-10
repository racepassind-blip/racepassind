import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  change?: string;
}

export function StatCard({ icon: Icon, label, value, change }: StatCardProps) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      {change && <p className="text-xs text-accent font-medium">{change}</p>}
    </div>
  );
}
