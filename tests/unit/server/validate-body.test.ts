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

  it("corps absent : validé comme objet vide", () => {
    const { passed } = run(undefined);
    expect((passed as AppError).status).toBe(400);
  });
});
