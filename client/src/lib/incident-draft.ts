import { createFormDraftStorage } from "@/lib/form-draft-storage";
import type { CreateIncidentRequest } from "@shared/contracts/incidents";

export type IncidentFormValues = Pick<CreateIncidentRequest, "description" | "severity">;

export const incidentDraftStorage = createFormDraftStorage<IncidentFormValues>({
  formId: "incident-new",
  version: 1,
});

export const INCIDENT_DEFAULT_VALUES: IncidentFormValues = { description: "", severity: "medium" };

export function isIncidentFormEmpty(data: IncidentFormValues): boolean {
  return !data.description.trim();
}
