import { getSportConfig } from "@/data/sportConfig";
import type { ParticipantFieldConfig } from "@/data/mockEvents";

type FieldEditor = ParticipantFieldConfig & { optionsText: string };

/** Apply adapter defaults to either builder section without changing stored field IDs. */
export function transitionSportFields(
  fields: FieldEditor[], previousSport: string, nextSport: string, maxCustom = 5,
): FieldEditor[] {
  const previous = getSportConfig(previousSport).registration_field_defaults ?? [];
  const defaults = getSportConfig(nextSport).registration_field_defaults ?? [];
  const removedIds = new Set(previous.filter((field) => !defaults.some((next) => next.id === field.id)).map((field) => field.id));
  const next = fields.filter((field) => !removedIds.has(field.id));
  for (const field of defaults) {
    if (!next.some((existing) => existing.id === field.id)) {
      next.push({ ...field, type: "text", required: true, predefined: false, order: next.length + 1, optionsText: "" });
    }
  }
  if (next.filter((field) => !field.predefined).length > maxCustom) {
    throw new Error(`Remove custom questions before changing sport: the rider fields must fit within the ${maxCustom}-field limit.`);
  }
  return next.map((field, index) => ({ ...field, order: index + 1 }));
}
