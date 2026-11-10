import { isSessionGuard } from "../../server/middleware/auth";

/**
 * Parcours statique de la pile Express : liste « METHODE /chemin » de chaque route déclarée et
 * indique si une garde de session (`sessionGuard`) la précède. Aucun handler n'est exécuté.
 * Partagé par les contrats api-auth-guard et viewer-read-only.
 */
export type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  handle: ((...args: unknown[]) => unknown) & { stack?: Layer[] };
  regexp: RegExp & { fast_slash?: boolean };
  name?: string;
};

export function mountPath(layer: Layer): string {
  if (layer.regexp.fast_slash) return "";
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ":param")
    .replace(/\\\//g, "/");
}

export function collectRoutes(
  stack: Layer[],
  prefix: string,
  inheritedGuards: string[],
  out: { key: string; guarded: boolean }[],
) {
  const guards = [...inheritedGuards];
  for (const layer of stack) {
    if (layer.route) {
      const path = prefix + layer.route.path;
      const guarded =
        guards.some((g) => path === g || path.startsWith(g + "/") || g === "") ||
        layer.route.stack.some((l) => isSessionGuard(l.handle));
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ key: `${method.toUpperCase()} ${path}`, guarded });
      }
    } else if (layer.handle.stack) {
      collectRoutes(layer.handle.stack, prefix + mountPath(layer), guards, out);
    } else if (isSessionGuard(layer.handle)) {
      // Garde posée par app.use / router.use: couvre les routes suivantes du préfixe.
      guards.push(prefix + mountPath(layer));
    }
  }
}
