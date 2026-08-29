import { useState } from "react";
import { Download, Smartphone, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export function PwaInstallBanner() {
  const { isInstallable, isInstalled, installPwa } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  if (isInstalled || !isInstallable || dismissed) {
    return null;
  }

  return (
    <div className="mx-4 mb-4 p-4 rounded-3xl bg-gradient-to-r from-emerald-950/90 to-slate-900 border border-emerald-500/30 text-white shadow-xl flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="space-y-0.5">
          <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
            <span>Installer FleetOS Tech</span>
            <span className="text-[10px] bg-emerald-500 text-slate-950 px-1.5 py-0.2 rounded-full font-black">PWA</span>
          </h4>
          <p className="text-[11px] text-slate-300 line-clamp-1">
            Accès 1-clic depuis l'écran d'accueil &amp; mode hors-ligne atelier
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          size="sm"
          onClick={() => installPwa()}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs h-8 px-3 rounded-xl shadow-md cursor-pointer"
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          Installer
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-slate-400 hover:text-white p-1 rounded-lg"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
