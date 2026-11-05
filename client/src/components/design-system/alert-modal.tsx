import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  HelpCircle,
  ArrowRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertModalVariant = "error" | "warning" | "success" | "info" | "confirm";

export interface AlertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: AlertModalVariant;
  title: string;
  /** Texte introductif optionnel au-dessus des détails. */
  description?: string;
  /** Liste d'éléments à corriger / à faire — affichés en checklist. */
  details?: string[];
  /** Label du bouton de confirmation / action principale. Défaut selon le variant. */
  confirmLabel?: string;
  /** Label du bouton d'annulation (affiché seulement pour "confirm"). */
  cancelLabel?: string;
  /** Callback à l'appui du bouton principal. */
  onConfirm?: () => void;
}

// ── Config par variant ────────────────────────────────────────────────────────

const VARIANT_CONFIG = {
  error: {
    icon: XCircle,
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive-text",
    ring: "ring-destructive/20",
    detailsBg: "bg-destructive/10",
    detailsBorder: "border-destructive/20",
    detailsDot: "bg-destructive",
    confirmClass: "bg-gray-100 hover:bg-gray-200 text-gray-800",
    defaultConfirmLabel: "Fermer",
    hasCancel: false,
  },
  warning: {
    icon: AlertTriangle,
    iconBg: "bg-warning/10",
    iconColor: "text-warning-text",
    ring: "ring-warning/20",
    detailsBg: "bg-warning/10",
    detailsBorder: "border-warning/20",
    detailsDot: "bg-warning",
    confirmClass: "bg-warning hover:bg-warning/90 text-white",
    defaultConfirmLabel: "Compris",
    hasCancel: false,
  },
  success: {
    icon: CheckCircle2,
    iconBg: "bg-success/10",
    iconColor: "text-success",
    ring: "ring-success/20",
    detailsBg: "bg-success/10",
    detailsBorder: "border-success/20",
    detailsDot: "bg-success",
    confirmClass: "bg-success hover:bg-success/90 text-white",
    defaultConfirmLabel: "Super",
    hasCancel: false,
  },
  info: {
    icon: Info,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-500",
    ring: "ring-blue-100",
    detailsBg: "bg-blue-50/60",
    detailsBorder: "border-blue-100",
    detailsDot: "bg-blue-400",
    confirmClass: "bg-blue-600 hover:bg-blue-700 text-white",
    defaultConfirmLabel: "OK",
    hasCancel: false,
  },
  confirm: {
    icon: HelpCircle,
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive-text",
    ring: "ring-destructive/20",
    detailsBg: "bg-destructive/10",
    detailsBorder: "border-destructive/20",
    detailsDot: "bg-destructive",
    confirmClass: "bg-destructive hover:bg-destructive/90 text-white",
    defaultConfirmLabel: "Confirmer",
    hasCancel: true,
  },
} satisfies Record<AlertModalVariant, {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  ring: string;
  detailsBg: string;
  detailsBorder: string;
  detailsDot: string;
  confirmClass: string;
  defaultConfirmLabel: string;
  hasCancel: boolean;
}>;

// ── Composant ─────────────────────────────────────────────────────────────────

export function AlertModal({
  open,
  onOpenChange,
  variant = "info",
  title,
  description,
  details,
  confirmLabel,
  cancelLabel = "Annuler",
  onConfirm,
}: AlertModalProps) {
  const cfg = VARIANT_CONFIG[variant];
  const Icon = cfg.icon;
  const label = confirmLabel ?? cfg.defaultConfirmLabel;
  const hasDetails = details && details.length > 0;

  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange(false);
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        {/* Overlay */}
        <AlertDialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/35 backdrop-blur-[3px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />

        {/* Content */}
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100vw-2rem)] max-w-[400px]",
            "rounded-2xl bg-card border border-gray-100/80 shadow-2xl",
            "p-6 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%]",
            "duration-150"
          )}
        >
          {/* Icône */}
          <div className="flex justify-center mb-4">
            <div
              className={cn(
                "w-[52px] h-[52px] rounded-full flex items-center justify-center ring-4",
                cfg.iconBg,
                cfg.ring
              )}
            >
              <Icon className={cn("h-6 w-6", cfg.iconColor)} strokeWidth={2} />
            </div>
          </div>

          {/* Titre */}
          <AlertDialogPrimitive.Title className="text-[17px] font-bold text-gray-900 text-center leading-snug">
            {title}
          </AlertDialogPrimitive.Title>

          {/* Description */}
          {description && (
            <AlertDialogPrimitive.Description
              className={cn(
                "mt-1.5 text-[13px] text-gray-500 text-center leading-relaxed",
                hasDetails && "mb-3"
              )}
            >
              {description}
            </AlertDialogPrimitive.Description>
          )}

          {/* Liste des points à corriger */}
          {hasDetails && (
            <div
              className={cn(
                "mt-3 rounded-xl border px-4 py-3 space-y-2",
                cfg.detailsBg,
                cfg.detailsBorder
              )}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">
                À corriger avant de continuer
              </p>
              {details!.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <ArrowRight
                    className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cfg.iconColor)}
                    strokeWidth={2.5}
                  />
                  <span className="text-[13px] text-gray-700 leading-snug">{item}</span>
                </div>
              ))}
            </div>
          )}

          {/* Boutons */}
          <div className={cn("mt-5 flex gap-2.5", cfg.hasCancel ? "flex-row" : "flex-col")}>
            {cfg.hasCancel && (
              <AlertDialogPrimitive.Cancel
                className={cn(
                  "flex-1 h-10 rounded-xl text-sm font-semibold transition-colors outline-none",
                  "bg-gray-100 hover:bg-gray-200 text-gray-700",
                  "focus-visible:ring-2 focus-visible:ring-gray-300"
                )}
              >
                {cancelLabel}
              </AlertDialogPrimitive.Cancel>
            )}

            <AlertDialogPrimitive.Action
              onClick={handleConfirm}
              className={cn(
                "flex-1 h-10 rounded-xl text-sm font-semibold transition-colors outline-none",
                cfg.confirmClass,
                "focus-visible:ring-2 focus-visible:ring-offset-1"
              )}
            >
              {label}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
