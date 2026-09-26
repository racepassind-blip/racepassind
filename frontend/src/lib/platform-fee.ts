// Central SportPass platform-fee pricing helper (frontend mirror of the backend
// platform_fee_service.compute_participant_pricing). Keep this in sync with the
// backend so the participant total is computed identically everywhere.

export type PlatformFeeBearer = "ORGANIZER" | "PARTICIPANT";

export const DEFAULT_FEE_PERCENTAGE_BASIS_POINTS = 400;
export const DEFAULT_FEE_MINIMUM_PAISE = 2000;
export const DEFAULT_FEE_MAXIMUM_PAISE = 6000;

export interface FeeConfig {
  percentageBasisPoints: number;
  minimumFeePaise: number;
  maximumFeePaise: number;
}

/**
 * SportPass fee for a single registration, in paise.
 * Free registrations (base <= 0) never accrue a fee. Otherwise the fee is
 * min(max(base × percentage, minimum), maximum), rounded half up.
 */
export function computeSportPassFeePaise(baseAmountPaise: number, config?: Partial<FeeConfig>): number {
  if (baseAmountPaise <= 0) return 0;
  const bps = config?.percentageBasisPoints ?? DEFAULT_FEE_PERCENTAGE_BASIS_POINTS;
  const minimum = config?.minimumFeePaise ?? DEFAULT_FEE_MINIMUM_PAISE;
  const maximum = config?.maximumFeePaise ?? DEFAULT_FEE_MAXIMUM_PAISE;
  const percentageComponent = Math.floor((baseAmountPaise * bps + 5000) / 10000);
  return Math.min(Math.max(percentageComponent, minimum), maximum);
}

export interface ParticipantPricing {
  baseAmountPaise: number;
  platformFeePaise: number;
  participantTotalPaise: number;
  feeBorneByParticipant: boolean;
}

/**
 * Single source of truth for the participant-facing total.
 * When the participant bears the fee, it is added on top of the base amount;
 * otherwise the participant pays only the base amount.
 */
export function computeParticipantPricing(
  baseAmountPaise: number,
  feeBearer: PlatformFeeBearer,
  config?: Partial<FeeConfig>,
): ParticipantPricing {
  const platformFeePaise = computeSportPassFeePaise(baseAmountPaise, config);
  const feeBorneByParticipant = feeBearer === "PARTICIPANT";
  return {
    baseAmountPaise,
    platformFeePaise,
    participantTotalPaise: baseAmountPaise + (feeBorneByParticipant ? platformFeePaise : 0),
    feeBorneByParticipant,
  };
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
