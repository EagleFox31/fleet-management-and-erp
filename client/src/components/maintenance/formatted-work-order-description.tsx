import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Wrench,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Zap,
  Tag,
  Info,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from "lucide-react";

interface FormattedWorkOrderDescriptionProps {
  description?: string | null;
  className?: string;
}

interface ParsedWorkOrderContext {
  mainText: string[];
  interventionType?: string;
  failureReason?: string;
  operationalImpact?: string;
  requestedAction?: string;
  checklist: {
    safetyCritical?: boolean;
    immobilized?: boolean;
    operationalUrgency?: boolean;
  };
  otherKeyValues: Array<{ key: string; value: string }>;
}

/**
 * Analyse et structure le texte brut de description d'un OT (incluant le contexte guidé et la checklist)
 */
function parseWorkOrderDescription(raw: string): ParsedWorkOrderContext {
  if (!raw || !raw.trim()) {
    return { mainText: [], checklist: {}, otherKeyValues: [] };
  }

  // Normalise les séparateurs (remplace les concaténations sans saut de ligne)
  const normalized = raw
    .replace(/(Type d'intervention\s*:)/gi, "\n$1")
    .replace(/(Motif\s*:)/gi, "\n$1")
    .replace(/(Checklist\s*:)/gi, "\n$1")
    .replace(/(Impact op[ée]rationnel\s*:)/gi, "\n$1")
    .replace(/(Action demand[ée]e\s*:)/gi, "\n$1");

  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const mainTextLines: string[] = [];
  let interventionType: string | undefined;
  let failureReason: string | undefined;
  let operationalImpact: string | undefined;
  let requestedAction: string | undefined;
  const checklist: ParsedWorkOrderContext["checklist"] = {};
  const otherKeyValues: Array<{ key: string; value: string }> = [];

  for (const line of lines) {
    if (/^Type d'intervention\s*:/i.test(line)) {
      const val = line.replace(/^Type d'intervention\s*:/i, "").trim();
      if (val && !interventionType) interventionType = val;
    } else if (/^Motif\s*:/i.test(line)) {
      const val = line.replace(/^Motif\s*:/i, "").trim();
      if (val && !failureReason) failureReason = val;
    } else if (/^Impact op[ée]rationnel\s*:/i.test(line)) {
      const val = line.replace(/^Impact op[ée]rationnel\s*:/i, "").trim();
      if (val && !operationalImpact) operationalImpact = val;
    } else if (/^Action demand[ée]e\s*:/i.test(line)) {
      const val = line.replace(/^Action demand[ée]e\s*:/i, "").trim();
      if (val && !requestedAction) requestedAction = val;
    } else if (/^Checklist\s*:/i.test(line)) {
      const checklistStr = line.replace(/^Checklist\s*:/i, "").trim();
      
      if (/S[ée]curit[ée]\s*critique\s*=\s*Oui/i.test(checklistStr)) checklist.safetyCritical = true;
      else if (/S[ée]curit[ée]\s*critique\s*=\s*Non/i.test(checklistStr) && checklist.safetyCritical === undefined) checklist.safetyCritical = false;

      if (/Immobilisation\s*=\s*Oui/i.test(checklistStr)) checklist.immobilized = true;
      else if (/Immobilisation\s*=\s*Non/i.test(checklistStr) && checklist.immobilized === undefined) checklist.immobilized = false;

      if (/Urgence\s*op[ée]rationnelle\s*=\s*Oui/i.test(checklistStr)) checklist.operationalUrgency = true;
      else if (/Urgence\s*op[ée]rationnelle\s*=\s*Non/i.test(checklistStr) && checklist.operationalUrgency === undefined) checklist.operationalUrgency = false;
    } else {
      // Vérifie si c'est un format Clé: Valeur générique
      const kvMatch = line.match(/^([^:]+):\s*(.+)$/);
      if (kvMatch && kvMatch[1].length < 30) {
        // Évite les doublons stricts
        if (!otherKeyValues.some((item) => item.key.toLowerCase() === kvMatch[1].trim().toLowerCase())) {
          otherKeyValues.push({ key: kvMatch[1].trim(), value: kvMatch[2].trim() });
        }
      } else {
        // Texte principal libre (évite les doublons de phrases répétés)
        if (!mainTextLines.includes(line)) {
          mainTextLines.push(line);
        }
      }
    }
  }

  return {
    mainText: mainTextLines,
    interventionType,
    failureReason,
    operationalImpact,
    requestedAction,
    checklist,
    otherKeyValues,
  };
}

export function FormattedWorkOrderDescription({
  description,
  className = "",
}: FormattedWorkOrderDescriptionProps) {
  if (!description || !description.trim()) {
    return <span className="italic text-muted-foreground text-sm">Aucune description fournie.</span>;
  }

  const parsed = parseWorkOrderDescription(description);
  const hasChecklist =
    parsed.checklist.safetyCritical !== undefined ||
    parsed.checklist.immobilized !== undefined ||
    parsed.checklist.operationalUrgency !== undefined;

  const hasContextDetails =
    parsed.interventionType ||
    parsed.failureReason ||
    parsed.operationalImpact ||
    parsed.requestedAction ||
    parsed.otherKeyValues.length > 0;

  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* 1. Texte Principal / Objet de l'intervention */}
      {parsed.mainText.length > 0 && (
        <div className="p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-sm leading-relaxed text-slate-800 dark:text-slate-200 font-medium space-y-1.5">
          {parsed.mainText.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      )}

      {/* 2. Cartouche Contexte Métier & Motif */}
      {hasContextDetails && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {parsed.interventionType && (
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-blue-500" /> Type d'intervention
              </span>
              <Badge
                variant="outline"
                className={
                  parsed.interventionType.toLowerCase().includes("prév")
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-amber-50 text-amber-700 border-amber-200"
                }
              >
                {parsed.interventionType}
              </Badge>
            </div>
          )}

          {parsed.failureReason && (
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-emerald-500" /> Motif constaté
              </span>
              <span className="font-semibold text-foreground text-right truncate max-w-[180px]">
                {parsed.failureReason}
              </span>
            </div>
          )}

          {parsed.operationalImpact && (
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs sm:col-span-2">
              <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Impact opérationnel
              </span>
              <span className="font-semibold text-foreground text-right">{parsed.operationalImpact}</span>
            </div>
          )}

          {parsed.requestedAction && (
            <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs sm:col-span-2">
              <span className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                <Zap className="h-3.5 w-3.5 text-emerald-500" /> Action demandée
              </span>
              <span className="font-semibold text-foreground text-right">{parsed.requestedAction}</span>
            </div>
          )}

          {parsed.otherKeyValues.map((kv, i) => (
            <div
              key={i}
              className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs"
            >
              <span className="text-muted-foreground">{kv.key}</span>
              <span className="font-semibold text-foreground">{kv.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* 3. Cartouche Checklist Criticité & Statut Atelier */}
      {hasChecklist && (
        <div className="p-3 rounded-2xl bg-gradient-to-r from-slate-50 to-slate-100/70 dark:from-slate-900/60 dark:to-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5" /> Checklist de diagnostic &amp; criticité
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Sécurité Critique */}
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                parsed.checklist.safetyCritical
                  ? "bg-rose-50/90 text-rose-900 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/50"
                  : "bg-white/80 text-slate-700 border-slate-200/80 dark:bg-slate-900/80 dark:text-slate-300"
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium">
                {parsed.checklist.safetyCritical ? (
                  <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
                ) : (
                  <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
                )}
                Sécurité critique
              </span>
              <span
                className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${
                  parsed.checklist.safetyCritical
                    ? "bg-rose-600 text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {parsed.checklist.safetyCritical ? "OUI" : "Non"}
              </span>
            </div>

            {/* Immobilisation Véhicule */}
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                parsed.checklist.immobilized
                  ? "bg-orange-50/90 text-orange-900 border-orange-200 dark:bg-orange-950/30 dark:text-orange-200 dark:border-orange-900/50"
                  : "bg-white/80 text-slate-700 border-slate-200/80 dark:bg-slate-900/80 dark:text-slate-300"
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Truck className={`h-4 w-4 shrink-0 ${parsed.checklist.immobilized ? "text-orange-600" : "text-slate-400"}`} />
                Immobilisation
              </span>
              <span
                className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${
                  parsed.checklist.immobilized
                    ? "bg-orange-600 text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {parsed.checklist.immobilized ? "OUI (À l'arrêt)" : "Non (Roulant)"}
              </span>
            </div>

            {/* Urgence Opérationnelle */}
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                parsed.checklist.operationalUrgency
                  ? "bg-amber-50/90 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/50"
                  : "bg-white/80 text-slate-700 border-slate-200/80 dark:bg-slate-900/80 dark:text-slate-300"
              }`}
            >
              <span className="flex items-center gap-1.5 font-medium">
                <Zap className={`h-4 w-4 shrink-0 ${parsed.checklist.operationalUrgency ? "text-amber-600" : "text-slate-400"}`} />
                Urgence opération
              </span>
              <span
                className={`font-bold px-2 py-0.5 rounded-full text-[10px] ${
                  parsed.checklist.operationalUrgency
                    ? "bg-amber-600 text-white shadow-xs"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                }`}
              >
                {parsed.checklist.operationalUrgency ? "OUI" : "Non"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
