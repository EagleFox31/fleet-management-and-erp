import ts from "typescript";
import { scopeOf } from "./alert-emission-scan";

/**
 * Recense les accès disque côté serveur qui lisent, servent, copient ou suppriment un fichier
 * (AGENTS.md §9) et dit si leur portée borne le chemin à `uploads/`.
 *
 * Accès : appel de `sendFile`, `download`, `createReadStream`, `readFile(Sync)`, `copyFile(Sync)`,
 * `unlink(Sync)`, `rm` ou `rmSync`.
 * Borné : la portée (fonction nommée ou `METHODE /chemin`, cf. `scopeOf`) appelle
 * `uploadedFileCandidates`, `existingUploadedFile` ou `isInsideDirectory`.
 */

export type FileAccessSite = { file: string; scope: string; call: string; line: number; bounded: boolean };

const ACCESS_CALLS = new Set([
  "sendFile",
  "download",
  "createReadStream",
  "readFile",
  "readFileSync",
  "copyFile",
  "copyFileSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
]);
const BOUND_MARKER = /\b(uploadedFileCandidates|existingUploadedFile|isInsideDirectory)\s*\(/;

function calleeName(node: ts.CallExpression): string | null {
  const callee = node.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return ts.isIdentifier(callee) ? callee.text : null;
}

export function scanFileAccesses(file: string, text: string): FileAccessSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: FileAccessSite[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const call = calleeName(node);
      if (call && ACCESS_CALLS.has(call)) {
        const scope = scopeOf(node);
        sites.push({
          file,
          scope: scope?.name ?? "<module>",
          call,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          bounded: BOUND_MARKER.test((scope?.node ?? source).getText()),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

export const fileAccessKey = (site: Pick<FileAccessSite, "file" | "scope" | "call">) => `${site.file}:${site.scope}:${site.call}`;
