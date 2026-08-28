import React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PartForm } from "@/components/inventory/part-form";

export default function InventoryNew() {
  return (
    <div>
      <PageHeader 
        title="Ajouter une pièce" 
        subtitle="Ajout d'une nouvelle pièce au stock"
      />
      
      <PartForm />
    </div>
  );
}
