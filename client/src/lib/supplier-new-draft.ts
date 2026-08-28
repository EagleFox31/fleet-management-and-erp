import type { InsertSupplier } from "@shared/schema";
import { createFormDraftStorage } from "@/lib/form-draft-storage";

export const supplierNewDraftStorage = createFormDraftStorage<InsertSupplier>({
  formId: "supplier-new",
  version: 1,
});

export const SUPPLIER_NEW_DEFAULT_VALUES: InsertSupplier = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  address: "",
  category: "",
  siret: "",
  vatNumber: "",
  paymentTerms: 30,
  deliveryTerms: "",
  notes: "",
  isActive: true,
};

export function isSupplierNewFormEmpty(data: InsertSupplier): boolean {
  return (
    !data.name.trim() &&
    !data.contactName?.trim() &&
    !data.email?.trim() &&
    !data.phone?.trim() &&
    !data.address?.trim() &&
    !data.category?.trim() &&
    !data.siret?.trim() &&
    !data.vatNumber?.trim() &&
    !data.deliveryTerms?.trim() &&
    !data.notes?.trim()
  );
}
