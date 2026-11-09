/**
 * Journal en fragments (docs/qa/journal/).
 *
 *   tsx scripts/doc-fragments.ts index [dossier]
 *     Affiche l'index des entrées, à la demande. Rien n'est écrit : un index
 *     commité redeviendrait un fichier unique en conflit à chaque fusion.
 *
 *   tsx scripts/doc-fragments.ts migrate <source.md> <dossier> <manifeste.json>
 *     Découpe un journal à fichier unique, un fragment par section `## `.
 *     Idempotent : refuse si le manifeste existe déjà (migration faite une fois).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FRAGMENT_NAME, fragmentName, renderIndex, splitSections, stampFromDate, stampFromHeading, toLf } from "./lib/doc-fragments";

const DEFAULT_DIR = "docs/qa/journal";

function headingOf(file: string): string {
  const first = toLf(readFileSync(file, "utf8")).split("\n").find((l) => l.startsWith("## "));
  return first ? first.slice(3).trim() : path.basename(file, ".md");
}

function index(dir: string): void {
  const names = readdirSync(dir).filter((n) => FRAGMENT_NAME.test(n));
  process.stdout.write(`${renderIndex(names.map((name) => ({ name, heading: headingOf(path.join(dir, name)) })))}\n`);
}

/** Horodatage du commit qui a écrit chaque ligne (git blame), pour les titres sans date. */
function blameTimes(file: string): Map<number, Date> {
  const out = execFileSync("git", ["blame", "--line-porcelain", "--", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const times = new Map<number, Date>();
  const commitTime = new Map<string, number>();
  let sha = "";
  let line = 0;
  for (const l of out.split("\n")) {
    const head = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (head) {
      sha = head[1];
      line = Number(head[2]);
      continue;
    }
    const t = l.match(/^committer-time (\d+)/);
    if (t) commitTime.set(sha, Number(t[1]));
    if (l.startsWith("\t")) times.set(line, new Date((commitTime.get(sha) ?? 0) * 1000));
  }
  return times;
}

function migrate(source: string, dir: string, manifestPath: string): void {
  if (existsSync(manifestPath)) {
    process.stdout.write(`Déjà migré (${manifestPath} existe) : rien à faire.\n`);
    return;
  }
  const original = toLf(readFileSync(source, "utf8"));
  const { preamble, sections } = splitSections(original);
  const blame = blameTimes(source);
  const taken = new Set(existsSync(dir) ? readdirSync(dir) : []);
  mkdirSync(dir, { recursive: true });
  const fragments = sections.map((s) => {
    const stamp = stampFromHeading(s.heading) ?? stampFromDate(blame.get(s.line) ?? new Date());
    const name = fragmentName(stamp, s.heading, taken);
    writeFileSync(path.join(dir, name), s.text);
    return name;
  });
  const manifest = {
    source,
    note: "Manifeste figé de la migration : ne jamais le réécrire ni modifier les fragments listés.",
    sha256: createHash("sha256").update(original).digest("hex"),
    preamble,
    fragments,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${fragments.length} fragments écrits dans ${dir}.\n`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "index") index(args[0] ?? DEFAULT_DIR);
else if (cmd === "migrate" && args.length === 3) migrate(args[0], args[1], args[2]);
else {
  process.stderr.write("Usage : doc-fragments.ts index [dossier] | migrate <source.md> <dossier> <manifeste.json>\n");
  process.exit(1);
}
