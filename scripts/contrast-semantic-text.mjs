// Contraste WCAG des jetons de texte semantiques sur fond compose (couleur/10 sur surface).
// Usage : node scripts/contrast-semantic-text.mjs
export function hsl([h, s, l]) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
export const over = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const css = readFileSync(fileURLToPath(new URL("../client/src/index.css", import.meta.url)), "utf8");
const tokens = (txt) => Object.fromEntries([...txt.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g)].map((m) => [m[1], [+m[2], +m[3], +m[4]]]));
const darkAt = css.indexOf(".dark {");
export const THEMES = { clair: tokens(css.slice(0, darkAt)), sombre: tokens(css.slice(darkAt)) };
export function compute() {
  const out = {};
  for (const [name, t] of Object.entries(THEMES)) {
    const surf = hsl(t.background);
    const dBg = over(hsl(t.destructive), surf, 0.1);
    const wBg = over(hsl(t.warning), surf, 0.1);
    out[name] = {
      destructiveAvant: ratio(hsl(t.destructive), dBg),
      destructiveTexte: ratio(hsl(t["destructive-text"]), dBg),
      destructiveTexteSurPage: ratio(hsl(t["destructive-text"]), surf),
      warningTexte: ratio(hsl(t["warning-text"]), wBg),
    };
  }
  return out;
}
// Couples texte/fond reellement employes. [libelle, texte, fond, alpha, surface, source]
// source = [fichier, motif de classes] : le test verifie que le motif existe encore dans le code.
// surface : nom de jeton, ou { clair: [h,s,l], sombre: [h,s,l] } pour une couleur fixe (ex. carte CPC).
const CPC = "client/src/components/drivers/cpc-update-form.tsx";
const MIS = "client/src/pages/missions/new.tsx";
const EB = "client/src/components/ui/error-boundary.tsx";
const CARTE_CPC = { clair: [0, 0, 100], sombre: [222, 47, 11] }; // bg-white / dark:bg-slate-900
export const COUPLES = [
  ["fond plein destructive : destructive-foreground sur destructive (bouton, badge, toast)", "destructive-foreground", "destructive", 1, "background", ["client/src/components/ui/button.tsx", "bg-destructive text-destructive-foreground"]],
  ["badge CPC expire apres (destructive-text sur destructive/10)", "destructive-text", "destructive", 0.1, "background", [CPC, "bg-destructive/10 text-destructive-text"]],
  ["muted-foreground sur muted (badge neutre, secondary, accent)", "muted-foreground", "muted", 1, "background", ["client/src/components/ui/tabs.tsx", "bg-muted p-1 text-muted-foreground"]],
  ["muted-foreground sur muted/50 dans une carte destructive/5 (Suggestions)", "muted-foreground", "muted", 0.5, { sous: [["destructive", 0.05]] }, [EB, "bg-muted/50"]],
  ["badge CPC neutre apres (foreground sur muted)", "foreground", "muted", 1, "background", [CPC, "bg-muted text-foreground"]],
  ["badge CPC valide (success sur success/10)", "success", "success", 0.1, "background", [CPC, "bg-success/10 text-success"]],
  ["warning-text sur warning/10 (page)", "warning-text", "warning", 0.1, "background", [CPC, "bg-warning/10 text-warning-text"]],
  ["warning-text sur warning/10 (carte muted)", "warning-text", "warning", 0.1, "muted", [MIS, "bg-warning/10 text-warning-text"]],
  ["destructive-text sur destructive/10 (page)", "destructive-text", "destructive", 0.1, "background", [MIS, "bg-destructive/10 text-destructive-text"]],
  ["statut CPC eligible mission (success sur page)", "success", "background", 0, "background", [MIS, "bg-background text-success"]],
  ["success-foreground sur success", "success-foreground", "success", 1, "background", [MIS, "bg-success text-success-foreground"]],
  ["muted-foreground sur page", "muted-foreground", "background", 1, "background", null],
  ["primary-foreground sur primary (Button, Badge, calendrier, pagination)", "primary-foreground", "primary", 1, "background", ["client/src/components/ui/button.tsx", "bg-primary text-primary-foreground"]],
  ["primary-text sur primary/20 (pastille, badge)", "primary-text", "primary", 0.2, "background", ["client/src/components/management/management-profitability-bento.tsx", "bg-primary/20 text-primary-text"]],
  ["primary-text sur primary/10 (alerte basse)", "primary-text", "primary", 0.1, "background", ["client/src/components/dashboard/alerts-panel.tsx", "bg-primary/10 text-primary-text"]],
  ["primary-text sur page", "primary-text", "background", 0, "background", null],
  ["carte CPC : foreground sur carte (bg-white / dark:bg-slate-900)", "foreground", "background", 0, CARTE_CPC, null],
  ["carte CPC : muted-foreground sur carte (bg-white / dark:bg-slate-900)", "muted-foreground", "background", 0, CARTE_CPC, null],
  ["carte CPC : success-foreground sur success (bouton)", "success-foreground", "success", 1, CARTE_CPC, [CPC, "bg-success text-success-foreground"]],
];
// Libelles exclus du seuil 4,5 : liste fixe, vide a ce jour (les deux couples historiques sans lien au code ont ete supprimes). Une ligne ajoutee ici doit etre justifiee en revue.
export const EXCLUS_HISTORIQUE = [
];
// surface : jeton, couleur fixe { clair, sombre }, ou { sous: [[jeton, alpha], ...] } = couches posees sur --background.
const surfaceOf = (t, name, surf) => {
  if (typeof surf === "string") return hsl(t[surf]);
  if (surf.sous) return surf.sous.reduce((acc, [tok, a]) => over(hsl(t[tok]), acc, a), hsl(t.background));
  return hsl(surf[name]);
};
export function computeCouples() {
  return COUPLES.map(([label, fg, bg, a, surf, source]) => ({
    label,
    source,
    ...Object.fromEntries(Object.entries(THEMES).map(([n, t]) => [n, ratio(hsl(t[fg]), over(hsl(t[bg]), surfaceOf(t, n, surf), a))])),
  }));
}
if (process.argv[1]?.endsWith("contrast-semantic-text.mjs")) {
  for (const r of computeCouples()) console.log(r.label.padEnd(68), r.clair.toFixed(2), r.sombre.toFixed(2));
}
if (process.argv[1]?.endsWith("contrast-semantic-text.mjs")) {
  for (const [k, v] of Object.entries(compute())) console.log(k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, b.toFixed(2)])));
}
