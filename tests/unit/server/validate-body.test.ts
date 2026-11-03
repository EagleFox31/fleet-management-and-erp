import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SERVER_FIELDS } from "../../../shared/constants/server-fields";
import { AppError } from "../../../server/lib/app-error";
import { validateBody } from "../../../server/middleware/validate-body";

/** Brique `validateBody` (niveau U) : champs serveur retirés, corps remplacé, 400 lisible par champ. */

const schema = z.object({ label: z.string().min(1), quantity: z.coerce.number().int().positive(), cost: z.number().optional() });

function run(body: unknown, options?: Parameters<typeof validateBody>[1]) {
  const req = { body, requestId: "req-1", method: "POST", path: "/api/x" } as never as { body: unknown };
  let passed: unknown = "pas appelé";
  validateBody(schema, options)(req as never, {} as never, (err?: unknown) => {
    passed = err;
  });
  return { req, passed };
}

describe("validateBody", () => {
  it("corps valide : next() sans erreur, req.body devient la sortie du schéma", () => {
    const { req, passed } = run({ label: "Filtre", quantity: "3", inconnu: "x" });
    expect(passed).toBeUndefined();
    expect(req.body).toEqual({ label: "Filtre", quantity: 3 });
  });

  it("champs serveur retirés en silence, même déclarés par le schéma (cost)", () => {
    const sent = Object.fromEntries(SERVER_FIELDS.map((f) => [f, 1]));
    const { req, passed } = run({ ...sent, label: "Filtre", quantity: 2 });
    expect(passed).toBeUndefined();
    expect(req.body).toEqual({ label: "Filtre", quantity: 2 });
  });

  it("keep : le champ serveur nommé passe jusqu'au schéma", () => {
    const { req } = run({ label: "Filtre", quantity: 2, cost: 15, createdBy: 9 }, { keep: ["cost"] });
    expect(req.body).toEqual({ label: "Filtre", quantity: 2, cost: 15 });
  });

  it("serverFields : champ propre à la route retiré en plus", () => {
    const strict = z.object({ label: z.string() }).strict();
    const req = { body: { label: "a", status: "approved" } } as { body: unknown };
    let passed: unknown = "pas appelé";
    validateBody(strict, { serverFields: ["status"] })(req as never, {} as never, (err?: unknown) => (passed = err));
    expect(passed).toBeUndefined();
    expect(req.body).toEqual({ label: "a" });
  });

  it("corps invalide : AppError 400 VALIDATION, errors[] par champ, req.body intact", () => {
    const body = { label: "", quantity: -1 };
    const { req, passed } = run(body);
    expect(passed).toBeInstanceOf(AppError);
    const err = passed as AppError;
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION");
    expect(err.fieldErrors?.map((e) => e.field).sort()).toEqual(["label", "quantity"]);
    expect(err.message).not.toMatch(/zod|issues|\{/i);
    expect(req.body).toBe(body);
  });

  it("schéma permissif refusé à la déclaration (passthrough, catchall, any, record)", () => {
    for (const permissive of [schema.passthrough(), schema.catchall(z.string()), z.any(), z.record(z.string()), schema.passthrough().optional()]) {
      expect(() => validateBody(permissive)).toThrow(/permissif/);
    }
    expect(() => validateBody(schema.strict())).not.toThrow();
  });

  it("schéma permissif refusé jusque dans union, and, lazy, pipe et brand", () => {
    const open = schema.passthrough();
    const nested = [
      z.union([schema, open]),
      z.discriminatedUnion("k", [z.object({ k: z.literal("a") }), z.object({ k: z.literal("b") }).passthrough()]),
      schema.and(open),
      z.intersection(schema, z.record(z.string())),
      z.lazy(() => open),
      schema.pipe(open),
      open.brand<"X">(),
      schema.refine(() => true).or(z.any()),
      open.transform((v) => v).optional(),
    ];
    for (const permissive of nested) {
      expect(() => validateBody(permissive)).toThrow(/permissif/);
    }
    const strictOnes = [z.union([schema, schema.strict()]), schema.and(z.object({ b: z.number() })), z.lazy(() => schema), schema.brand<"Y">()];
    for (const strict of strictOnes) {
      expect(() => validateBody(strict)).not.toThrow();
    }
    // Schéma récursif : pas de boucle infinie.
    type Node = { name: string; children?: Node[] };
    const node: z.ZodType<Node> = z.lazy(() => z.object({ name: z.string(), children: z.array(node).optional() }));
    expect(() => validateBody(node)).not.toThrow();
  });

  it("corps absent : validé comme objet vide", () => {
    const { passed } = run(undefined);
    expect((passed as AppError).status).toBe(400);
  });
});
