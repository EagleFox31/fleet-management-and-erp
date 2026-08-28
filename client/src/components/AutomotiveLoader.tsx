import { useEffect, useState } from 'react';
import { Truck, Wrench, CheckCircle2 } from 'lucide-react';

const STEPS = [
  { icon: Truck,         text: "Chargement de la flotte...",    color: "text-green-500" },
  { icon: Wrench,        text: "Initialisation du système...",   color: "text-blue-500" },
  { icon: CheckCircle2,  text: "Prêt !",                        color: "text-emerald-500" },
];

// Position max du camion dans le conteneur (en %) — garde une marge à droite
const TRUCK_MAX_LEFT = 80;

export default function AutomotiveLoader() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) { clearInterval(interval); return 100; }
        // Vitesse naturelle : rapide au début, ralentit vers la fin
        const increment = prev < 40 ? 2.5 : prev < 75 ? 1.5 : prev < 90 ? 0.8 : 0.3;
        return Math.min(prev + increment, 100);
      });
    }, 60);

    return () => clearInterval(interval);
  }, []);

  const currentStep = progress < 40 ? 0 : progress < 80 ? 1 : 2;
  const CurrentIcon = STEPS[currentStep].icon;

  // Le camion occupe au max TRUCK_MAX_LEFT % du conteneur → ne sort jamais
  const truckLeft = Math.min((progress / 100) * TRUCK_MAX_LEFT, TRUCK_MAX_LEFT);
  // La barre de progression couvre toute la largeur
  const progressPct = Math.round(progress);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-green-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8">

        {/* Logo */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500/10 rounded-2xl mb-4 backdrop-blur-sm border border-green-500/20">
            <Truck className="w-10 h-10 text-green-500" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Yaro FleetOS</h1>
          <p className="text-slate-400">CMMS & Fleet Management</p>
        </div>

        {/* Scène animée */}
        <div className="relative h-24 bg-slate-800/50 rounded-xl overflow-hidden border border-slate-700/50 backdrop-blur-sm">

          {/* Route */}
          <div className="absolute bottom-0 left-0 right-0 h-2 bg-slate-700">
            <div className="h-full flex items-center justify-around">
              {[0, 1, 2, 3, 4].map(i => (
                <div key={i} className="w-8 h-0.5 bg-yellow-500/50" />
              ))}
            </div>
          </div>

          {/* Camion */}
          <div
            className="absolute bottom-4 transition-all duration-200 ease-linear"
            style={{ left: `${truckLeft}%` }}
          >
            <div className="relative">
              <div className="flex items-end">
                {/* Cabine */}
                <div className="w-8 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-tl-lg relative">
                  <div className="absolute top-1 left-1 right-1 h-3 bg-green-300/30 rounded-tl-lg" />
                </div>
                {/* Remorque */}
                <div className="w-16 h-8 bg-gradient-to-br from-green-600 to-green-700 rounded-tr-lg" />
              </div>

              {/* Roues */}
              <div className="absolute -bottom-2 left-1 flex gap-10">
                {[0, 1].map(i => (
                  <div
                    key={i}
                    className="w-4 h-4 bg-slate-900 rounded-full border-2 border-slate-600 animate-spin"
                    style={{ animationDuration: '0.4s' }}
                  >
                    <div className="w-1 h-1 bg-slate-400 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                ))}
              </div>

              {/* Fumée d'échappement */}
              {progress > 5 && progress < 98 && (
                <div className="absolute -left-3 top-3 flex gap-1">
                  <div className="w-2 h-2 bg-slate-500/40 rounded-full animate-ping"
                       style={{ animationDuration: '0.9s' }} />
                </div>
              )}
            </div>
          </div>

          {/* Nuages décoratifs */}
          <div className="absolute inset-0 pointer-events-none opacity-20">
            {[{ base: 20, speed: 0.3, size: 'w-6 h-6', top: 'top-2' }, { base: 60, speed: 0.5, size: 'w-8 h-8', top: 'top-4' }].map((cloud, i) => (
              <div
                key={i}
                className={`absolute ${cloud.top} animate-pulse`}
                style={{ left: `${Math.max(0, cloud.base - progress * cloud.speed)}%`, animationDuration: `${2 + i}s` }}
              >
                <div className={`${cloud.size} bg-slate-600/30 rounded-full`} />
              </div>
            ))}
          </div>
        </div>

        {/* Barre de progression */}
        <div className="space-y-3">
          <div className="h-3 bg-slate-800/50 rounded-full overflow-hidden border border-slate-700/50">
            <div
              className="h-full bg-gradient-to-r from-green-500 via-green-400 to-emerald-500 transition-all duration-200 ease-linear relative overflow-hidden"
              style={{ width: `${progressPct}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                   style={{ backgroundSize: '200% 100%', animation: 'shimmer 2s infinite' }} />
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <CurrentIcon className={`w-5 h-5 ${STEPS[currentStep].color} animate-pulse`} />
              <span className="text-slate-300">{STEPS[currentStep].text}</span>
            </div>
            <span className="text-green-400 font-mono font-semibold">{progressPct}%</span>
          </div>
        </div>

        {/* Points d'étape */}
        <div className="flex justify-center gap-2">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i <= currentStep ? 'w-2 h-2 bg-green-500' : 'w-1.5 h-1.5 bg-slate-700'
              }`}
            />
          ))}
        </div>

      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
