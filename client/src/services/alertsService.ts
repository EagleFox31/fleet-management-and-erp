import { alertsApi } from "@/lib/api-calls";

export interface Alert {
  id: number;
  type: 'maintenance' | 'fuel' | 'document' | 'stock' | 'work_order' | 'tire';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  vehicleId?: number;
  vehicleRegistration?: string;
  isRead: boolean;
  createdAt: string;
  expiresAt?: string;
}

export interface AlertCount {
  total: number;
  unread: number;
  byType: {
    maintenance: number;
    fuel: number;
    document: number;
    stock: number;
    work_order: number;
    tire: number;
  };
  bySeverity: {
    info: number;
    warning: number;
    error: number;
    critical: number;
  };
}

export const alertsService = {
  async getAll(): Promise<Alert[]> {
    const response = await alertsApi.getAll();
    const data = await response.json();
    return data;
  },

  async getActive(): Promise<Alert[]> {
    const response = await alertsApi.getActive();
    const data = await response.json();
    return data;
  },

  async getByType(type: string): Promise<Alert[]> {
    const response = await alertsApi.getByType(type);
    const data = await response.json();
    return data;
  },

  async markAsRead(id: number): Promise<void> {
    await alertsApi.markAsRead(id);
  },

  async dismiss(id: number): Promise<void> {
    await alertsApi.dismiss(id);
  },

  async getCount(): Promise<AlertCount> {
    const response = await alertsApi.getCount();
    const data = await response.json();
    return data;
  },

  getTypeLabel(type: 'maintenance' | 'fuel' | 'document' | 'stock' | 'work_order' | 'tire'): string {
    const labels: Record<string, string> = {
      maintenance: 'Maintenance',
      fuel: 'Carburant',
      document: 'Document',
      stock: 'Stock',
      work_order: 'Ordre de travail',
      tire: 'Pneumatique',
    };
    return labels[type] || type;
  },

  getTypeIcon(type: 'maintenance' | 'fuel' | 'document' | 'stock' | 'work_order' | 'tire'): string {
    const icons: Record<string, string> = {
      maintenance: 'wrench',
      fuel: 'fuel',
      document: 'file-text',
      stock: 'package',
      work_order: 'clipboard-list',
      tire: 'circle',
    };
    return icons[type] || 'bell';
  },

  getSeverityLabel(severity: 'info' | 'warning' | 'error' | 'critical'): string {
    const labels: Record<string, string> = {
      info: 'Information',
      warning: 'Avertissement',
      error: 'Erreur',
      critical: 'Critique',
    };
    return labels[severity] || severity;
  },

  getSeverityColor(severity: 'info' | 'warning' | 'error' | 'critical'): string {
    switch (severity) {
      case 'info':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'error':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'critical':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    }
  },

  getSeverityBadgeVariant(severity: 'info' | 'warning' | 'error' | 'critical'): 'default' | 'secondary' | 'destructive' | 'outline' {
    switch (severity) {
      case 'info':
        return 'default';
      case 'warning':
        return 'secondary';
      case 'error':
      case 'critical':
        return 'destructive';
    }
  },

  isExpired(expiresAt?: string): boolean {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  },

  sortByPriority(alerts: Alert[]): Alert[] {
    const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
    return [...alerts].sort((a, b) => {
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[a.severity] - severityOrder[b.severity];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  },
};
