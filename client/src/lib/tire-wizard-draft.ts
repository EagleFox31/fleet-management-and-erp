import type { TireFormData } from "@shared/tire-form";
import {
  createFormDraftStorage,
  type FormDraftPayload,
  type FormDraftSaveInput,
} from "@/lib/form-draft-storage";

export type TireWizardDraftMeta = { step: number };
export type TireWizardDraft = FormDraftPayload<TireFormData, TireWizardDraftMeta>;

export const tireWizardDraftStorage = createFormDraftStorage<TireFormData, TireWizardDraftMeta>({
  formId: "tire-wizard-draft",
  version: 1,
});

export function loadTireWizardDraft(userId?: number | string): TireWizardDraft | null {
  return tireWizardDraftStorage.load(userId);
}

export function saveTireWizardDraft(
  userId: number | string | undefined,
  draft: { step: number; data: TireFormData; savedAt: string },
): void {
  const payload: FormDraftSaveInput<TireFormData, TireWizardDraftMeta> = {
    data: draft.data,
    savedAt: draft.savedAt,
    meta: { step: draft.step },
  };
  tireWizardDraftStorage.save(userId, payload);
}

export function clearTireWizardDraft(userId?: number | string): void {
  tireWizardDraftStorage.clear(userId);
}
