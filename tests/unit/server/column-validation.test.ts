import { describe, expect, it } from "vitest";
import { columnTypeErrors, prepareColumnUpdate } from "../../../server/lib/column-validation";
import { vehicles, workOrders } from "../../../shared/schema";

/** Contrôle de type dérivé des colonnes Drizzle, niveau U. */

describe("columnTypeErrors", () => {
  it("accepte ce que Postgres accepte : nombres, chaînes numériques, dates ISO, null sur colonne facultative", () => {
    expect(columnTypeErrors(vehicles, { year: 2020, mileage: "125000" })).toEqual([]);
    expect(columnTypeErrors(workOrders, { duration: "90", startDate: "2026-10-29T08:00:00.000Z", endDate: null })).toEqual([]);
    expect(columnTypeErrors(workOrders, { startDate: new Date() })).toEqual([]);
  });

  it("signale chaque champ invalide avec un message lisible", () => {
    expect(columnTypeErrors(vehicles, { year: "deux mille", mileage: 12.5 })).toEqual([
      { field: "year", message: "Doit être un nombre entier." },
      { field: "mileage", message: "Doit être un nombre entier." },
    ]);
    expect(columnTypeErrors(workOrders, { startDate: "demain" })).toEqual([
      { field: "startDate", message: "Doit être une date valide." },
    ]);
  });

  it("refuse null sur une colonne obligatoire et une chaîne vide sur un nombre", () => {
    expect(columnTypeErrors(vehicles, { year: null })).toEqual([{ field: "year", message: "Ce champ est obligatoire." }]);
    expect(columnTypeErrors(vehicles, { mileage: "" })).toHaveLength(1);
  });

  it("contrôle les valeurs d'énumération", () => {
    expect(columnTypeErrors(workOrders, { status: "completed" })).toEqual([]);
    expect(columnTypeErrors(workOrders, { status: "fini" })).toEqual([{ field: "status", message: "Valeur non autorisée." }]);
  });

  it("ignore les clés inconnues de la table et les corps non objets", () => {
    expect(columnTypeErrors(vehicles, { notAColumn: "x", year: undefined })).toEqual([]);
    expect(columnTypeErrors(vehicles, null)).toEqual([]);
    expect(columnTypeErrors(vehicles, [1, 2])).toEqual([]);
  });
});

describe("prepareColumnUpdate", () => {
  it("vide en null une chaîne vide sur date, nombre ou énumération, garde le texte", () => {
    const { data, errors } = prepareColumnUpdate(vehicles, { purchaseDate: "", purchasePrice: "", notes: "", brand: "Volvo" });
    expect(data).toEqual({ purchaseDate: null, purchasePrice: null, notes: "", brand: "Volvo" });
    expect(errors).toEqual([]);
  });

  it("une chaîne vide sur une colonne obligatoire reste une erreur", () => {
    expect(prepareColumnUpdate(vehicles, { year: "" }).errors).toEqual([{ field: "year", message: "Ce champ est obligatoire." }]);
  });
});
