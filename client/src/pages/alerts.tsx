import React from "react";
import { PageHeader } from "@/components/layout/page-header";
import { AlertsPanel } from "@/components/alerts/alerts-panel";

export default function AlertsPage() {
  return (
    <div>
      <PageHeader
        title="Alertes et notifications"
        subtitle="Gestion centralisée des alertes système"
      />
      
      <div className="space-y-6">
        <AlertsPanel />
      </div>
    </div>
  );
}