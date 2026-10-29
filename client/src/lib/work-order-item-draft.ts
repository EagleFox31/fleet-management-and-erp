import { createFormDraftStorage } from "@/lib/form-draft-storage";

/** Champs du formulaire en chaînes: les Select et Input renvoient du texte. */
export type WorkOrderItemFormValues = {
  laborCatalogId: string;
  customLabel: string;
  technicianId: string;
  estimatedHours: string;
  actualHours: string;
  status: string;
  notes: string;
};

/** Un brouillon par OT: une saisie commencée sur un camion ne réapparaît pas sur un autre. */
export function workOrderItemDraftStorage(workOrderId: number) {
  return createFormDraftStorage<WorkOrderItemFormValues>({
    formId: `work-order-item-${workOrderId}`,
    version: 1,
  });
}

export const WORK_ORDER_ITEM_DEFAULT_VALUES: WorkOrderItemFormValues = {
  laborCatalogId: "",
  customLabel: "",
  technicianId: "",
  estimatedHours: "",
  actualHours: "",
  status: "done",
  notes: "",
};

export function isWorkOrderItemFormEmpty(data: WorkOrderItemFormValues): boolean {
  return (
    !data.laborCatalogId &&
    !data.customLabel.trim() &&
    !data.technicianId &&
    !data.estimatedHours.trim() &&
    !data.actualHours.trim() &&
    !data.notes.trim()
  );
}
