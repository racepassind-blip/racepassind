import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ParticipantFieldConfig, ParticipantFieldType } from "@/data/mockEvents";

export interface TeamFieldEditorItem extends ParticipantFieldConfig {
  optionsText: string;
}

export const DEFAULT_MAIN_REGISTRANT_FIELDS: TeamFieldEditorItem[] = [
  { id: "team_name", label: "Team name", type: "text", required: true, predefined: true, order: 1, optionsText: "" },
  { id: "captain_name", label: "Captain name", type: "text", required: true, predefined: true, order: 2, optionsText: "" },
  { id: "captain_phone", label: "Captain phone", type: "phone", required: true, predefined: true, order: 3, optionsText: "" },
  { id: "captain_email", label: "Captain email", type: "email", required: true, predefined: true, order: 4, optionsText: "" },
];

export const DEFAULT_PARTICIPANT_FIELDS: TeamFieldEditorItem[] = [
  { id: "full_name", label: "Full name", type: "text", required: true, predefined: true, order: 1, optionsText: "" },
  { id: "date_of_birth", label: "Date of birth", type: "date", required: true, predefined: true, order: 2, optionsText: "" },
  { id: "blood_group", label: "Blood group", type: "dropdown", required: false, predefined: true, order: 3, optionsText: "A+, A-, B+, B-, O+, O-, AB+, AB-", options: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] },
  { id: "jersey_size", label: "Jersey size", type: "dropdown", required: false, predefined: true, order: 4, optionsText: "XS, S, M, L, XL, XXL", options: ["XS", "S", "M", "L", "XL", "XXL"] },
];

const CUSTOM_FIELD_TYPES: ParticipantFieldType[] = ["text", "date", "dropdown", "number"];

interface SectionProps {
  title: string;
  description: string;
  fields: TeamFieldEditorItem[];
  lockedId: string;
  onChange: (fields: TeamFieldEditorItem[]) => void;
  customIdPrefix: string;
  totalCustomCount: number;
  maxCustom: number;
}

function Section({ title, description, fields, lockedId, onChange, customIdPrefix, totalCustomCount, maxCustom }: SectionProps) {
  const update = (id: string, patch: Partial<TeamFieldEditorItem>) => {
    onChange(fields.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  };

  const remove = (id: string) => {
    if (id === lockedId) return;
    onChange(fields.filter((field) => field.id !== id));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((field, i) => ({ ...field, order: i + 1 })));
  };

  const addCustom = () => {
    if (totalCustomCount >= maxCustom) return;
    const id = `${customIdPrefix}_${Date.now().toString(36)}`;
    onChange([
      ...fields,
      { id, label: "", type: "text", required: false, predefined: false, order: fields.length + 1, optionsText: "" },
    ]);
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-col gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" disabled={index === fields.length - 1} onClick={() => move(index, 1)} aria-label="Move down">
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-w-[10rem] flex-1 space-y-1">
                <Label className="text-xs">Label {field.required ? "*" : ""}</Label>
                {field.predefined ? (
                  <Input value={field.label} disabled />
                ) : (
                  <Input value={field.label} onChange={(e) => update(field.id, { label: e.target.value })} placeholder="Field label" />
                )}
              </div>
              <div className="w-32 space-y-1">
                <Label className="text-xs">Type</Label>
                {field.predefined ? (
                  <Input value={field.type} disabled />
                ) : (
                  <Select value={field.type} onValueChange={(value) => update(field.id, { type: value as ParticipantFieldType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CUSTOM_FIELD_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.required}
                  disabled={field.id === lockedId}
                  onChange={(e) => update(field.id, { required: e.target.checked })}
                />
                Required
              </label>
              {field.id !== lockedId && (
                <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(field.id)} aria-label="Remove field">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            {(field.type === "dropdown" || field.type === "select") && (
              <div className="mt-3 space-y-1">
                <Label className="text-xs">Options (comma separated) *</Label>
                <Input
                  value={field.optionsText}
                  disabled={field.predefined}
                  onChange={(e) => update(field.id, { optionsText: e.target.value })}
                  placeholder="Option 1, Option 2, Option 3"
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addCustom} disabled={totalCustomCount >= maxCustom}>
        <Plus className="mr-1 h-4 w-4" /> Add field
      </Button>
    </div>
  );
}

interface TeamFieldEditorProps {
  mainFields: TeamFieldEditorItem[];
  participantFields: TeamFieldEditorItem[];
  onMainChange: (fields: TeamFieldEditorItem[]) => void;
  onParticipantChange: (fields: TeamFieldEditorItem[]) => void;
  maxCustom?: number;
}

export function TeamFieldEditor({
  mainFields,
  participantFields,
  onMainChange,
  onParticipantChange,
  maxCustom = 10,
}: TeamFieldEditorProps) {
  const totalCustom = mainFields.filter((f) => !f.predefined).length + participantFields.filter((f) => !f.predefined).length;
  return (
    <div className="space-y-4">
      <Section
        title="Main registrant fields"
        description="Collected once per team, from the captain."
        fields={mainFields}
        lockedId="team_name"
        onChange={onMainChange}
        customIdPrefix="custom_main"
        totalCustomCount={totalCustom}
        maxCustom={maxCustom}
      />
      <Section
        title="Per-participant fields"
        description="Collected once for every team member."
        fields={participantFields}
        lockedId="full_name"
        onChange={onParticipantChange}
        customIdPrefix="custom_member"
        totalCustomCount={totalCustom}
        maxCustom={maxCustom}
      />
      <p className="text-xs text-muted-foreground">
        Up to {maxCustom} custom fields across both sections. {totalCustom}/{maxCustom} used.
      </p>
    </div>
  );
}
