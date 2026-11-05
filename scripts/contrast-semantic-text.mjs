// Contraste WCAG des jetons de texte semantiques sur fond compose (couleur/10 sur surface).
// Usage : node scripts/contrast-semantic-text.mjs
function hsl([h, s, l]) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

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
if (process.argv[1]?.endsWith("contrast-semantic-text.mjs")) {
  for (const [k, v] of Object.entries(compute())) console.log(k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, b.toFixed(2)])));
}
