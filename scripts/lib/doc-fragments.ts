/**
 * Journal en fragments : une entrée = un fichier.
 *
 * Un journal tenu dans un seul fichier « en ajout de fin » produit un conflit à
 * chaque fusion de deux PR qui ajoutent chacune leur entrée (GitHub n'applique
 * pas `merge=union`). Un fichier par entrée supprime ce conflit par construction.
 *
 * Module pur (aucun accès disque ni git) : découpe, nommage, index.
 */

export const FRAGMENT_NAME = /^\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
export const SLUG_MAX = 60;

export interface Section {
  /** Ligne de titre, sans le préfixe `## `. */
  heading: string;
  /** Tranche exacte du fichier, de la ligne `## ` incluse à la suivante exclue. */
  text: string;
  /** Numéro (base 1) de la ligne de titre dans le fichier d'origine. */
  line: number;
}

export function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Découpe un journal en préambule + sections `## `. Recoller les morceaux rend le texte d'origine. */
export function splitSections(source: string): { preamble: string; sections: Section[] } {
  const text = toLf(source);
  const lines = text.split("\n");
  const starts: number[] = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) fence = !fence;
    if (!fence && l.startsWith("## ")) starts.push(i);
  });
  const offsets: number[] = [];
  let pos = 0;
  for (const l of lines) {
    offsets.push(pos);
    pos += l.length + 1;
  }
  const cut = (i: number) => (i < offsets.length ? offsets[i] : text.length);
  const preamble = text.slice(0, starts.length ? cut(starts[0]) : text.length);
  const sections = starts.map((s, k) => ({
    heading: lines[s].slice(3).trim(),
    text: text.slice(cut(s), k + 1 < starts.length ? cut(starts[k + 1]) : text.length),
    line: s + 1,
  }));
  return { preamble, sections };
}

/** Date et heure portées par le titre (`2026-11-09 14:30`, `2026-11-09T14:30:00+01:00`), sinon null. */
export function stampFromHeading(heading: string): string | null {
  const m = heading.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}T${m[2]}${m[3]}` : null;
}

/** Horodatage AAAA-MM-JJTHHMM d'une date, en heure de Douala (UTC+1, sans heure d'été). */
export function stampFromDate(date: Date): string {
  const d = new Date(date.getTime() + 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

/** Slug ASCII du titre, sans date, sans sha ni numéro de PR en tête. */
export function slugify(heading: string): string {
  const words = heading
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:\d{2}|Z)?)?/g, " ")
    .replace(/\(#\d+\)|#\d+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // Un sha abrégé en tête (« 6237cb3 - … ») n'est pas un sujet.
  while (words.length > 1 && /^(?=.*\d)[0-9a-f]{7,40}$/.test(words[0])) words.shift();
  if (words[0] === "lot") while (words.length > 2 && /^(?=.*\d)[0-9a-f]{7,40}$/.test(words[1])) words.splice(1, 1);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > SLUG_MAX) break;
    slug = next;
  }
  return slug || (words[0] ?? "entree").slice(0, SLUG_MAX);
}

/** Nom de fragment unique dans `taken` (suffixe -2, -3… en cas de collision). */
export function fragmentName(stamp: string, heading: string, taken: Set<string>): string {
  const base = `${stamp}-${slugify(heading)}`;
  let name = `${base}.md`;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.md`;
  taken.add(name);
  return name;
}

/** Tableau Markdown des fragments, triés par nom (donc par horodatage). */
export function renderIndex(fragments: { name: string; heading: string }[]): string {
  const rows = [...fragments]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `| ${f.name.slice(0, 15)} | [${f.heading.replace(/\|/g, "\\|")}](${f.name}) |`);
  return ["| Horodatage | Entrée |", "|---|---|", ...rows].join("\n");
}
