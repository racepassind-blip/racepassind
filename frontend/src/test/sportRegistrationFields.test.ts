import { transitionSportFields } from "@/lib/sportRegistrationFields";
import type { ParticipantFieldConfig } from "@/data/mockEvents";

const custom = (id: string): ParticipantFieldConfig & { optionsText: string } => ({
  id, label: id, type: "text", required: false, predefined: false, order: 1, optionsText: "",
});

describe("sport registration builder transitions", () => {
  it("adds rider defaults to individual and team participant sections", () => {
    for (const limit of [5, 10]) {
      const fields = transitionSportFields([], "running", "motorcycle", limit);
      expect(fields.map((field) => field.id)).toEqual(["custom_motorcycle_make_model", "custom_motorcycle_registration_number"]);
      expect(fields.every((field) => field.required && field.type === "text")).toBe(true);
      expect(transitionSportFields(fields, "motorcycle", "motorcycle", limit)).toEqual(fields);
    }
  });

  it("rejects overflow before mutating either form section", () => {
    const fields = Array.from({ length: 4 }, (_, i) => custom(`custom_${i}`));
    expect(() => transitionSportFields(fields, "running", "motorcycle")).toThrow("5-field limit");
    expect(fields).toHaveLength(4);
    expect(() => transitionSportFields([], "running", "motorcycle", 1)).toThrow("1-field limit");
    expect(transitionSportFields(fields.slice(0, 3), "running", "motorcycle")).toHaveLength(5);
  });

  it("removes motorcycle defaults when changing sports without removing unrelated questions", () => {
    const original = [custom("custom_meal")];
    const motorcycle = transitionSportFields(original, "running", "motorcycle");
    for (const sport of ["running", "trekking", "cycling", "badminton"]) {
      expect(transitionSportFields(motorcycle, "motorcycle", sport)).toEqual(original);
    }
  });

  it("does not overwrite organizer edits or duplicate existing rider fields", () => {
    const edited = { ...custom("custom_motorcycle_make_model"), label: "Your bike", required: true };
    const fields = transitionSportFields([edited], "running", "motorcycle");
    expect(fields).toHaveLength(2);
    expect(fields[0]).toEqual(edited);
  });
});
