import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface RegistrationStatusDetails {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: LucideIcon;
}

export const registrationStatusDetails: Record<string, RegistrationStatusDetails> = {
  awaiting_payment: { label: "Awaiting payment", variant: "secondary", icon: Clock3 },
  pending_verification: { label: "Pending verification", variant: "secondary", icon: Clock3 },
  confirmed: { label: "Confirmed", variant: "default", icon: CheckCircle2 },
  checked_in: { label: "Checked in", variant: "default", icon: CheckCircle2 },
  rejected: { label: "Rejected", variant: "destructive", icon: XCircle },
  expired: { label: "Expired", variant: "destructive", icon: XCircle },
};

export function formatRegistrationDate(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function registrationDateValue(date: string): number {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? Number.MAX_SAFE_INTEGER : parsed.getTime();
}

export function formatRegistrationAmount(amountPaise: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR" }).format(amountPaise / 100);
  } catch {
    return `${currency || "INR"} ${(amountPaise / 100).toFixed(2)}`;
  }
}
