import { describe, expect, it } from "vitest";
import * as schema from "../../../shared/schema";

/**
 * T4 niveau U : les champs que seul le serveur écrit ne doivent pas être
 * acceptés par les schémas Zod d'insertion.
 *
 * L'état actuel n'est pas propre : certains schémas exposent encore un champ
 * d'identité ou un montant. Ils sont listés ci-dessous, tels quels, pour que
 * la liste ne puisse que rétrécir. Chaque exception doit être couverte par
 * un test de contrat qui prouve que la route écrase la valeur du client
 * (docs/qa/PLAN_COUVERTURE_MODULES.md, T4).
 */

// Identité de l'acteur et horodatage : toujours `req.user` et l'horloge serveur.
const IDENTITY_FIELDS = [
  "id",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "recordedBy",
  "approvedBy",
  "requestedBy",
  "receivedBy",
  "issuedBy",
] as const;

// Montants calculés par le serveur (catalogue, totaux).
const AMOUNT_FIELDS = ["totalAmount", "cost"] as const;

const SERVER_FIELDS: readonly string[] = [...IDENTITY_FIELDS, ...AMOUNT_FIELDS];

// Exceptions constatées le 2026-10-29. Retirer une entrée quand le schéma est corrigé ;
// en ajouter une exige une justification en commentaire.
const KNOWN_EXCEPTIONS: Record<string, string[]> = {
  insertVehicleDocumentSchema: ["updatedBy"],
  insertDocumentRenewalCenterSchema: ["createdBy"],
  insertDocumentRenewalRequestSchema: ["requestedBy"],
  insertWorkOrderSchema: ["createdBy", "updatedBy", "updatedAt", "cost"],
  insertPartsStockMovementSchema: ["createdBy"],
  insertFuelRecordSchema: ["createdBy", "updatedBy", "cost"],
  insertPartRequirementSchema: ["requestedBy"],
  insertFaultCatalogSchema: ["createdBy"],
  insertTireRotationSchema: ["createdBy", "cost"],
  insertSupplierInvoiceSchema: ["approvedBy", "totalAmount"],
  insertMissionSchema: ["createdBy"],
  insertClientInvoiceSchema: ["createdBy"],
  insertClientPaymentSchema: ["recordedBy"],
  insertPurchaseOrderSchema: ["createdBy", "approvedBy"],
};

// AGENTS.md §5 : règle ferme, aucune exception possible.
const STRICT_AUDIT = ["insertPartSchema", "insertTireSchema"];

type ZodLike = { shape?: Record<string, unknown> };

function insertSchemas(): [string, Record<string, unknown>][] {
  return Object.entries(schema)
    .filter(([name]) => /^insert.*Schema$/.test(name))
    .map(([name, value]) => [name, (value as ZodLike).shape ?? {}]);
}

function exposedServerFields(shape: Record<string, unknown>): string[] {
  return SERVER_FIELDS.filter((field) => field in shape);
}

describe("schémas d'insertion : champs écrits par le serveur", () => {
  it("chaque schéma d'insertion expose une forme lisible", () => {
    const opaque = insertSchemas()
      .filter(([, shape]) => Object.keys(shape).length === 0)
      .map(([name]) => name);
    expect(opaque).toEqual([]);
  });

  it.each(STRICT_AUDIT)("%s omet les quatre champs d'audit", (name) => {
    const shape = (schema as unknown as Record<string, ZodLike>)[name].shape ?? {};
    expect(["createdBy", "updatedBy", "createdAt", "updatedAt"].filter((f) => f in shape)).toEqual([]);
  });

  it("aucun nouveau schéma n'accepte un champ serveur", () => {
    const regressions: Record<string, string[]> = {};
    for (const [name, shape] of insertSchemas()) {
      const allowed = new Set(KNOWN_EXCEPTIONS[name] ?? []);
      const extra = exposedServerFields(shape).filter((field) => !allowed.has(field));
      if (extra.length > 0) regressions[name] = extra;
    }
    expect(regressions).toEqual({});
  });

  it("la liste des exceptions ne contient que des écarts encore réels", () => {
    // Un schéma corrigé doit sortir de la liste, sinon elle cesse d'être un cliquet.
    const stale: Record<string, string[]> = {};
    const shapes = Object.fromEntries(insertSchemas());
    for (const [name, fields] of Object.entries(KNOWN_EXCEPTIONS)) {
      const shape = shapes[name];
      const gone = shape ? fields.filter((field) => !(field in shape)) : fields;
      if (gone.length > 0) stale[name] = gone;
    }
    expect(stale).toEqual({});
  });

  it("le parse retire un champ serveur que le schéma omet", () => {
    const result = schema.insertPartSchema.safeParse({
      name: "TEST filtre",
      reference: "TEST-REF",
      quantity: 1,
      createdBy: 999,
      updatedBy: 999,
    });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("createdBy");
    expect(result.data).not.toHaveProperty("updatedBy");
  });
});
