import { useQuery } from "@tanstack/react-query";
import { SupplierCombobox } from "@/components/procurement/supplier-combobox";

interface TireSupplierComboboxProps {
  value: string;
  onChange: (supplierName: string) => void;
  disabled?: boolean;
}

export function TireSupplierCombobox({ value, onChange, disabled }: TireSupplierComboboxProps) {
  const { data: suppliers = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/suppliers", { isActive: true }],
    staleTime: 5 * 60 * 1000,
  });

  const selectedId = suppliers.find((supplier) => supplier.name === value)?.id ?? null;

  return (
    <SupplierCombobox
      value={selectedId}
      legacyName={selectedId ? null : value || null}
      disabled={disabled}
      onChange={(_supplierId, supplierName) => onChange(supplierName)}
    />
  );
}
