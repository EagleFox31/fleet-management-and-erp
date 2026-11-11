/**
 * Séparateur décoratif de la landing : une bande de bitume sur toute la largeur.
 * SVG inline sans viewBox : les coordonnées en % suivent la largeur, les pointillés gardent
 * leur longueur en px quelle que soit la fenêtre. Les pointillés défilent lentement
 * (classe `landing-road-dash`, arrêtée sous prefers-reduced-motion dans index.css).
 */
export function RoadDivider() {
  return (
    <div aria-hidden="true" data-testid="road-divider" className="relative h-7 w-full overflow-hidden md:h-12">
      <svg width="100%" height="100%" focusable="false" className="block">
        {/* Bitume */}
        <rect x="0" y="0" width="100%" height="100%" fill="#24282e" />
        {/* Bas-côtés */}
        <rect x="0" y="0" width="100%" height="3" fill="#14171b" />
        <rect x="0" y="100%" width="100%" height="3" fill="#14171b" transform="translate(0 -3)" />
        {/* Lignes de rive */}
        <line x1="0" x2="100%" y1="16%" y2="16%" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" />
        <line x1="0" x2="100%" y1="84%" y2="84%" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" />
        {/* Ligne centrale */}
        <line
          x1="0"
          x2="100%"
          y1="50%"
          y2="50%"
          stroke="#fb923c"
          strokeOpacity="0.9"
          strokeWidth="3"
          strokeDasharray="28 22"
          className="landing-road-dash"
        />
      </svg>
    </div>
  );
}
