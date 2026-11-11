import { useId, type CSSProperties, type ReactNode } from "react";

/**
 * Séparateurs de la landing : chaque frontière de section devient un fondu « brumeux » portant un motif métier.
 *
 * - `SectionBackdrop` : fond translucide d'une section, masqué en dégradé en haut et en bas. Deux sections
 *   voisines descendent au même plancher à leur jonction : aucun bord horizontal net.
 * - `SectionDivider` : motif décoratif posé dans le haut de la section suivante. Masque, flou, opacité et
 *   cadrage sont communs ; seule la variante change le dessin. Animation lente, au plus une par motif, coupée
 *   sous prefers-reduced-motion (index.css).
 *
 * Tout est en SVG inline, sans texte, ignoré des lecteurs d'écran.
 */

export type SectionDividerVariant = "road" | "gps" | "tire" | "chart" | "finish";

/** Opacité du fond à la jonction de deux sections (fraction de son opacité pleine). */
const JUNCTION_FLOOR = "rgba(0,0,0,0.3)";
const FADE_PX = 140;

const mask = (image: string): CSSProperties => ({ WebkitMaskImage: image, maskImage: image });

/**
 * Fond d'une section. `top="clear"` : la section part de rien (sous le haut de page, qui n'a pas de fond) ;
 * `"haze"` : elle rejoint le plancher commun ; `bottom="solid"` : pas de fondu en bas (dernière section).
 */
export function SectionBackdrop({
  top = "haze",
  bottom = "haze",
  fadePx = FADE_PX,
  className = "",
}: {
  top?: "clear" | "haze";
  bottom?: "haze" | "solid";
  /** Hauteur des fondus ; réduite pour une section basse (pied de page). */
  fadePx?: number;
  className?: string;
}) {
  const start = top === "clear" ? "transparent 0, #000 180px" : `${JUNCTION_FLOOR} 0, #000 ${fadePx}px`;
  const end = bottom === "haze" ? `, #000 calc(100% - ${fadePx}px), ${JUNCTION_FLOOR} 100%` : "";
  return (
    <div
      aria-hidden="true"
      data-testid="section-backdrop"
      className={`absolute inset-0 -z-10 ${className}`}
      style={mask(`linear-gradient(to bottom, ${start}${end})`)}
    />
  );
}

/** Fondu vertical du motif : il naît et se perd dans la brume. */
const SOFT_EDGES = mask("linear-gradient(to bottom, transparent 0%, #000 22%, #000 78%, transparent 100%)");

const ORANGE = "#fb923c";
const WHITE = "#ffffff";
const ASPHALT_EDGE = "#5a616b";
const ASPHALT = "#353a42";

/** Route du haut de page : S doux sur toute la largeur. */
const ROAD_PATH = "M -60 62 C 260 18, 560 84, 840 52 S 1240 20, 1500 46";
/** Route qui revient et s'arrête au centre, tangente horizontale à l'arrivée. */
const FINISH_ROAD_PATH = "M -60 30 C 220 80, 420 80, 560 58 C 640 46, 680 48, 720 48";
const FINISH_X = 720;
const FINISH_Y = 48;

/** Trace GPS : les extrémités de chaque segment sont sur la courbe, d'où les points de passage. */
const GPS_PATH = "M -40 58 C 80 30, 160 30, 240 44 S 420 76, 560 60 S 760 26, 880 40 S 1080 72, 1200 56 S 1400 34, 1480 40";
const GPS_WAYPOINTS: Array<[number, number]> = [[240, 44], [560, 60], [1200, 56]];
const GPS_POSITION: [number, number] = [880, 40];

/** Courbe d'indicateur qui monte, façon ligne de tableau de bord. */
const CHART_POINTS: Array<[number, number]> = [
  [0, 78], [180, 72], [360, 75], [540, 62], [720, 64], [900, 48], [1080, 44], [1260, 30], [1440, 22],
];

/** Point animé : centré, donc visible aussi en mobile où les côtés sont rognés. */
const CHART_PULSE = CHART_POINTS[5];

/** Sculptures de pneu : chevrons orientés selon une courbe légère, comme une trace au sol. */
const TREAD_STEP = 26;
const treadY = (x: number) => 48 + 9 * Math.sin((x / 1440) * Math.PI * 2);
const TREAD = Array.from({ length: Math.ceil(1500 / TREAD_STEP) }, (_, i) => {
  const x = i * TREAD_STEP - 20;
  const slope = (treadY(x + 1) - treadY(x - 1)) / 2;
  return { x, y: treadY(x), angle: (Math.atan(slope) * 180) / Math.PI };
});
const CHEVRON = "M -8 -15 L 3 0 L -8 15 L -2 15 L 9 0 L -2 -15 Z";

function RoadStrokes({ d, haze, butt = false }: { d: string; haze: string; butt?: boolean }) {
  return (
    <>
      <g filter={`url(#${haze})`} fill="none" strokeLinecap={butt ? "butt" : "round"}>
        <path d={d} stroke={ASPHALT_EDGE} strokeWidth="36" />
        <path d={d} stroke={ASPHALT} strokeWidth="31" />
      </g>
      <path
        d={d}
        fill="none"
        stroke={ORANGE}
        strokeOpacity="0.9"
        strokeWidth="2.5"
        strokeDasharray="28 22"
        className="landing-road-dash"
      />
    </>
  );
}

function PulsingPoint({ at }: { at: [number, number] }) {
  return (
    <>
      <circle cx={at[0]} cy={at[1]} r="6" fill="none" stroke={ORANGE} strokeWidth="1.5" className="landing-divider-pulse" />
      <circle cx={at[0]} cy={at[1]} r="5" fill={ORANGE} />
    </>
  );
}

function Motif({ variant, haze }: { variant: SectionDividerVariant; haze: string }): ReactNode {
  switch (variant) {
    case "road":
      return <RoadStrokes d={ROAD_PATH} haze={haze} />;
    case "finish": {
      const half = 15.5;
      const cell = (2 * half) / 5;
      return (
        <>
          <RoadStrokes d={FINISH_ROAD_PATH} haze={haze} butt />
          {Array.from({ length: 10 }, (_, i) => {
            const column = i % 2;
            const row = Math.floor(i / 2);
            return (
              <rect
                key={i}
                x={FINISH_X + column * cell}
                y={FINISH_Y - half + row * cell}
                width={cell}
                height={cell}
                fill={(row + column) % 2 === 0 ? WHITE : ASPHALT}
                fillOpacity={(row + column) % 2 === 0 ? 0.85 : 1}
              />
            );
          })}
        </>
      );
    }
    case "gps":
      return (
        <>
          <path d={GPS_PATH} fill="none" stroke={WHITE} strokeOpacity="0.55" strokeWidth="2" strokeDasharray="6 8" strokeLinecap="round" />
          {GPS_WAYPOINTS.map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="4" fill="#1e2228" stroke={WHITE} strokeOpacity="0.7" strokeWidth="1.5" />
          ))}
          <PulsingPoint at={GPS_POSITION} />
        </>
      );
    case "tire":
      return (
        <g filter={`url(#${haze})`} fill={WHITE} fillOpacity="0.4">
          {TREAD.map(({ x, y, angle }) => (
            <path key={x} d={CHEVRON} transform={`translate(${x} ${y.toFixed(1)}) rotate(${angle.toFixed(1)})`} />
          ))}
        </g>
      );
    case "chart": {
      const line = CHART_POINTS.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
      return (
        <>
          {[30, 54, 78].map((y) => (
            <line key={y} x1="0" x2="1440" y1={y} y2={y} stroke={WHITE} strokeOpacity="0.12" strokeDasharray="4 6" />
          ))}
          <path d={`${line} L 1440 96 L 0 96 Z`} fill={ORANGE} fillOpacity="0.1" filter={`url(#${haze})`} />
          <path d={line} fill="none" stroke={ORANGE} strokeOpacity="0.85" strokeWidth="2.5" strokeLinejoin="round" />
          {CHART_POINTS.filter((point) => point !== CHART_PULSE).map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="3.5" fill={WHITE} fillOpacity="0.75" />
          ))}
          <PulsingPoint at={CHART_PULSE} />
        </>
      );
    }
  }
}

/**
 * Motif décoratif pleine largeur. viewBox 1440 x 96 en `slice` : mis à l'échelle sans déformation, centré,
 * rogné sur les côtés en mobile. `strong` (route du haut de page) est plus présent que les autres frontières.
 */
export function SectionDivider({
  variant,
  strength = "soft",
  className = "",
}: {
  variant: SectionDividerVariant;
  strength?: "strong" | "soft";
  className?: string;
}) {
  const haze = `section-divider-haze-${useId().replace(/:/g, "")}`;
  return (
    <div
      aria-hidden="true"
      data-testid="section-divider"
      data-variant={variant}
      className={`pointer-events-none w-full overflow-hidden ${strength === "strong" ? "opacity-70" : "opacity-[0.45]"} ${className}`}
      style={SOFT_EDGES}
    >
      <svg viewBox="0 0 1440 96" preserveAspectRatio="xMidYMid slice" width="100%" height="100%" focusable="false" className="block">
        <defs>
          <filter id={haze} x="-5%" y="-50%" width="110%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <Motif variant={variant} haze={haze} />
      </svg>
    </div>
  );
}
