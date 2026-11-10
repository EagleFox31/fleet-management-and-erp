import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FUEL_RECORD_BUDGET_SETTLED_MESSAGE,
  FUEL_RECORD_VALIDATED_DELETE_MESSAGE,
  FUEL_RECORD_VALIDATED_EDIT_MESSAGE,
  canCancelFuelRecord,
  fuelRecordCancelSchema,
  isFuelRecordValidated,
  isMissionBudgetSettled,
} from "../../../shared/constants/fuel-record-cancel";
import { fuelValidationLabel } from "../../../client/src/lib/fuel-record-status";
import { fuelRecords, insertFuelRecordSchema } from "../../../shared/schema";

const norm = (s: string) => s.replace(/\r\n/g, "\n");

describe("Plein validé : messages", () => {
  it("disent quoi faire à la place, sans jargon technique", () => {
    expect(FUEL_RECORD_VALIDATED_EDIT_MESSAGE).toBe(
      "Ce plein est validé : il ne se modifie plus. Annulez-le avec un motif, puis saisissez-en un nouveau.",
    );
    expect(FUEL_RECORD_VALIDATED_DELETE_MESSAGE).toBe("Un plein validé ne se supprime pas : annulez-le avec un motif.");
    expect(FUEL_RECORD_BUDGET_SETTLED_MESSAGE).toBe("Budget de la mission soldé : rouvrez le budget ou passez une régularisation.");
  });
});

describe("Annulation d'un plein : motif", () => {
  it("refuse un motif absent, vide ou de moins de 3 caractères", () => {
    for (const body of [{}, { reason: "" }, { reason: "  a " }, { reason: "ab" }, { reason: 12 }]) {
      expect(fuelRecordCancelSchema.safeParse(body).success).toBe(false);
    }
  });
  it("accepte et rogne un motif valide", () => {
    expect(fuelRecordCancelSchema.parse({ reason: "  Doublon de saisie  " })).toEqual({ reason: "Doublon de saisie" });
  });
});

describe("Annulation d'un plein : rôles (mêmes que la suppression)", () => {
  const moved = { debitAmount: "100.00", creditAmount: "0" };
  const physical = { debitAmount: "0", creditAmount: "0" };
  it("plein qui a mouvementé la carte : admin, logistique, secrétariat", () => {
    for (const role of ["admin", "logistics", "secretary"]) expect(canCancelFuelRecord(role, moved)).toBe(true);
    for (const role of ["workshop_manager", "technician", "warehouse", "client", null, undefined]) {
      expect(canCancelFuelRecord(role, moved)).toBe(false);
    }
  });
  it("plein physique : admin et chef d'atelier", () => {
    for (const role of ["admin", "workshop_manager"]) expect(canCancelFuelRecord(role, physical)).toBe(true);
    for (const role of ["logistics", "secretary", "technician", "client"]) expect(canCancelFuelRecord(role, physical)).toBe(false);
  });
});

describe("Plein validé : statut et affichage", () => {
  it("isFuelRecordValidated ne reconnaît que 'validated'", () => {
    expect(isFuelRecordValidated({ validationStatus: "validated" })).toBe(true);
    expect(isFuelRecordValidated({ validationStatus: "pending" })).toBe(false);
    expect(isFuelRecordValidated({})).toBe(false);
  });
  it("« Validé (reprise) » quand le valideur est NULL", () => {
    expect(fuelValidationLabel({ validationStatus: "validated", validatedBy: null })).toBe("Validé (reprise)");
    expect(fuelValidationLabel({ validationStatus: "validated", validatedBy: 4 })).toBe("Validé");
    expect(fuelValidationLabel({ validationStatus: "pending", validatedBy: null })).toBe("En attente");
  });
});

describe("cancellation_reason : colonne, jumelle SQL, jamais écrite par le client", () => {
  it("schéma Drizzle, init-database et migration portent la même colonne idempotente", () => {
    expect(fuelRecords.cancellationReason.name).toBe("cancellation_reason");
    const alter = "ALTER TABLE fuel_records ADD COLUMN IF NOT EXISTS cancellation_reason text";
    expect(norm(readFileSync("server/init-database.ts", "utf8"))).toContain(alter);
    expect(norm(readFileSync("server/db/migrations/20261110_fuel_cancellation_reason.sql", "utf8"))).toContain(alter);
  });
  it("omise de insertFuelRecordSchema : un corps client qui la porte est ignoré", () => {
    expect(Object.keys(insertFuelRecordSchema.shape)).not.toContain("cancellationReason");
  });
});

describe("Annulation d'un plein : motif limité à 500 caractères", () => {
  it("accepte 500 caractères, refuse 501", () => {
    expect(fuelRecordCancelSchema.safeParse({ reason: "a".repeat(500) }).success).toBe(true);
    expect(fuelRecordCancelSchema.safeParse({ reason: "a".repeat(501) }).success).toBe(false);
  });
  it("compte après rognage : 500 caractères entourés d'espaces passent", () => {
    expect(fuelRecordCancelSchema.safeParse({ reason: ` ${"a".repeat(500)} ` }).success).toBe(true);
  });
});

describe("Règle « budget de mission soldé »", () => {
  it("n'est soldé que si settledAt est posé", () => {
    expect(isMissionBudgetSettled({ settledAt: new Date() })).toBe(true);
    expect(isMissionBudgetSettled({ settledAt: "2026-11-10T10:00:00.000Z" })).toBe(true);
    expect(isMissionBudgetSettled({ settledAt: null })).toBe(false);
    expect(isMissionBudgetSettled({})).toBe(false);
  });
});
