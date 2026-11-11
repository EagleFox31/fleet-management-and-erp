import type { CSSProperties } from "react";

/** Fondu vertical : la route naît et se perd dans le dégradé, sans bord net. */
const SOFT_EDGES = "linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)";
const softEdges: CSSProperties = { WebkitMaskImage: SOFT_EDGES, maskImage: SOFT_EDGES };

/** Tracé en S doux : viewBox 1440 x 96, mis à l'échelle sans déformation (slice), les pointillés gardent leurs proportions. */
const ROAD_PATH = "M -60 62 C 260 18, 560 84, 840 52 S 1240 20, 1500 46";

/**
 * Route décorative de la landing, posée dans la zone où le haut de page se fond dans la section profils.
 * Bitume légèrement flou et translucide, bas-côtés plus clairs, ligne centrale orange en pointillés qui
 * suivent la courbe et défilent lentement (classe `landing-road-dash`, arrêtée sous prefers-reduced-motion
 * dans index.css). Le parent la positionne ; aucune interaction, ignorée des lecteurs d'écran.
 */
export function RoadDivider({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid="road-divider"
      className={`pointer-events-none w-full overflow-hidden opacity-70 ${className}`}
      style={softEdges}
    >
      <svg viewBox="0 0 1440 96" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" focusable="false" className="block">
        <defs>
          <filter id="road-divider-haze" x="-5%" y="-50%" width="110%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <g filter="url(#road-divider-haze)" fill="none" strokeLinecap="round">
          {/* Bas-côtés, puis bitume */}
          <path d={ROAD_PATH} stroke="#5a616b" strokeWidth="36" />
          <path d={ROAD_PATH} stroke="#353a42" strokeWidth="31" />
        </g>
        {/* Ligne centrale */}
        <path
          d={ROAD_PATH}
          fill="none"
          stroke="#fb923c"
          strokeOpacity="0.9"
          strokeWidth="2.5"
          strokeDasharray="28 22"
          className="landing-road-dash"
        />
      </svg>
    </div>
  );
}
