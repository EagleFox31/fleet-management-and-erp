import { CheckCircle, Info, Package, X } from "lucide-react";

interface PartRequirementStatusHelpProps {
  onClose: () => void;
}

export function PartRequirementStatusHelp({ onClose }: PartRequirementStatusHelpProps) {
  return (
    <div className="rounded-2xl overflow-hidden border border-blue-100 bg-white shadow-sm mb-4">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <Info className="h-3.5 w-3.5 text-blue-600" />
          </div>
          <span className="text-sm font-medium text-gray-700">Comprendre la colonne « Statut demande »</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Fermer l'aide"
          data-testid="close-workflow-help"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="px-5 pb-5">
        <p className="text-sm text-gray-600 mt-4 mb-4">
          La colonne <strong className="text-gray-900">« Statut demande »</strong> indique où en est une demande de pièce en cours (approbation, commande, réception, sortie).{" "}
          <strong className="text-gray-900">Cliquez sur un badge</strong> pour le résumé et la prochaine action. Les détails OT sont disponibles dans la fiche pièce.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl bg-green-50 px-4 py-3 flex items-start gap-2.5">
            <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-green-800">Pièce en stock</p>
                  <p className="text-xs text-green-700 mt-0.5">Souvent aucun badge — pièce disponible, sortie directe</p>
            </div>
          </div>
          <div className="rounded-xl bg-orange-50 px-4 py-3 flex items-start gap-2.5">
            <Package className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold text-orange-800">Pièce en rupture</p>
              <p className="text-xs text-orange-700 mt-0.5">Demande créée → approbation puis commande fournisseur</p>
            </div>
          </div>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2.5">Étapes du workflow</p>
        <div className="grid grid-cols-5 gap-2">
          {[
            { num: "1", label: "En attente", sub: "Chef valide", bg: "bg-yellow-100", fg: "text-yellow-700" },
            { num: "2", label: "Approuvée", sub: "À commander", bg: "bg-blue-100", fg: "text-blue-700" },
            { num: "3", label: "Commandée", sub: "Fournisseur", bg: "bg-purple-100", fg: "text-purple-700" },
            { num: "4", label: "Reçu en stock", sub: "Disponible", bg: "bg-sky-100", fg: "text-sky-700" },
            { num: "5", label: "Terminé", sub: "Demande clôturée", bg: "bg-teal-100", fg: "text-teal-700" },
          ].map(step => (
            <div key={step.num} className="rounded-xl bg-gray-50 border border-gray-100 px-2 py-3 flex flex-col items-center text-center">
              <div className={`w-6 h-6 rounded-full ${step.bg} flex items-center justify-center mb-1.5`}>
                <span className={`${step.fg} text-[10px] font-bold`}>{step.num}</span>
              </div>
              <p className="text-[10px] font-semibold text-gray-700 leading-tight">{step.label}</p>
              <p className="text-[9px] text-gray-400 mt-0.5 leading-tight">{step.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
