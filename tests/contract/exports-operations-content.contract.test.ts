import { eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, fuelRecords, missions, vehicles, workOrders } from "../../shared/schema";
import {
  createTestClient,
  createTestClientInvoice,
  createTestSupplier,
  createTestSupplierInvoice,
  createTestUser,
  createTestVehicle,
} from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";
import { readZip } from "../support/zip-read";

/**
 * DIR3 : contenu exact des exports qui restaient a couvrir : missions clients, rapport
 * mensuel, vehicules, ordres de travail, utilisateurs (classeurs Excel) et export complet
 * (ZIP). Les droits sont dans `lot-exports-roles`. Donnees au jeton unique, retrouvees par
 * leur cle (immatriculation, numero de commande, login) dans des classeurs qui portent
 * aussi les donnees de la base partagee. Dates fixees a midi UTC : stables dans tout
 * fuseau d'Europe ou d'Afrique, ou tourne le serveur.
 *
 * Defauts figes en `it.fails` (le code produit n'est pas corrige ici) :
 *  - DIR3-1 : le role d'un utilisateur est exporte en identifiant technique ("warehouse")
 *  - DIR3-2 : le statut d'OT "awaiting_parts" est exporte brut
 *  - DIR3-3 : la priorite d'OT "critical" est exportee brute
 */
type Actor = "admin";
type Row = Record<string, string | number>;
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

const missionIds: number[] = [];
const workOrderIds: number[] = [];
const MONTH = { year: 2031, month: 7 };
let clientA = { id: 0, name: "" };
let clientB = { id: 0, name: "" };
let vehicleFull = { id: 0, registrationNumber: "" };
let vehicleBare = { id: 0, registrationNumber: "" };
const orders = { delivered: "", planned: "", other: "" };
const wo = { completed: 0, awaiting: 0 };
const people: Record<string, { username: string; name: string }> = {};
const invoiceNumbers = { supplier: "", client: "" };

async function workbook(path: string): Promise<{ wb: XLSX.WorkBook; disposition: string; type: string }> {
  const res = await session.raw("GET", path, "admin");
  expect(res.status).toBe(200);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  return { wb, disposition: res.headers.get("content-disposition") ?? "", type: res.headers.get("content-type") ?? "" };
}
const rowsOf = (wb: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<Row>(wb.Sheets[name]);
const headersOf = (wb: XLSX.WorkBook, name: string) => (XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1 })[0] ?? []) as string[];

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin" });

  const a = await createTestClient();
  const b = await createTestClient();
  session.ids.clientIds.push(a.id, b.id);
  clientA = { id: a.id, name: a.name };
  clientB = { id: b.id, name: b.name };

  const full = await createTestVehicle({ mileage: 123456 });
  const bare = await createTestVehicle();
  session.ids.vehicleIds.push(full.id, bare.id);
  await db
    .update(vehicles)
    .set({
      status: "maintenance",
      vin: "VINDIR3000000001",
      tonnage: 12.5,
      axleCount: 3,
      purchaseDate: "2024-03-05",
      purchasePrice: "45000000.00",
      insuranceExpiry: "2027-01-31",
      technicalInspectionDate: "2026-12-01",
    })
    .where(eq(vehicles.id, full.id));
  vehicleFull = { id: full.id, registrationNumber: full.registrationNumber };
  vehicleBare = { id: bare.id, registrationNumber: bare.registrationNumber };

  // Missions : une livree avec vehicule, une planifiee sans vehicule ni date de livraison, une autre cliente.
  orders.delivered = uniqueTestToken("cmd-liv");
  orders.planned = uniqueTestToken("cmd-plan");
  orders.other = uniqueTestToken("cmd-autre");
  const [m1] = await db
    .insert(missions)
    .values({
      clientId: a.id,
      orderNumber: orders.delivered,
      pickupAddress: "Douala Port",
      deliveryAddress: "Yaounde Mvan",
      deliveryDate: new Date("2026-02-10T12:00:00Z"),
      actualFuelQuantity: 120.5,
      actualFuelCost: "99000.00",
      actualDistance: 250,
      estimatedDistance: 240,
      status: "delivered",
      createdAt: new Date("2026-02-01T12:00:00Z"),
    })
    .returning();
  const [m2] = await db
    .insert(missions)
    .values({
      clientId: a.id,
      orderNumber: orders.planned,
      pickupAddress: "Kribi",
      deliveryAddress: "Edea",
      estimatedDistance: 80,
      status: "planned",
      createdAt: new Date("2026-03-04T12:00:00Z"),
    })
    .returning();
  const [m3] = await db
    .insert(missions)
    .values({ clientId: b.id, orderNumber: orders.other, pickupAddress: "Limbe", deliveryAddress: "Buea", status: "draft" })
    .returning();
  missionIds.push(m1.id, m2.id, m3.id);
  await db.insert(assignments).values({ missionId: m1.id, vehicleId: full.id, status: "completed" });

  // Rapport mensuel : carburant (une carte creditee, un plein debite), facture fournisseur et facture client du mois.
  const [credit, debit] = await db
    .insert(fuelRecords)
    .values([
      { date: "2031-07-03", quantity: 0, cost: "0", creditAmount: "500000.00", debitAmount: "0", balance: "500000.00", year: MONTH.year, month: MONTH.month, stationName: "TEST-Carte", notes: uniqueTestToken("fuel") },
      { vehicleId: full.id, date: "2031-07-12", quantity: 100, cost: "82800.00", creditAmount: "0", debitAmount: "82800.00", balance: "417200.00", year: MONTH.year, month: MONTH.month, stationName: "TEST-Station", notes: uniqueTestToken("fuel") },
    ])
    .returning();
  session.ids.fuelRecordIds.push(credit.id, debit.id);
  const supplier = await createTestSupplier();
  session.ids.supplierIds.push(supplier.id);
  const si = await createTestSupplierInvoice({ supplierId: supplier.id, invoiceDate: "2031-07-15", amountHT: "100000.00", vatAmount: "19250.00", totalTTC: "119250.00", balance: "19250.00" });
  session.ids.invoiceIds.push(si.id);
  invoiceNumbers.supplier = si.invoiceNumber;
  const ci = await createTestClientInvoice({ clientId: a.id, invoiceDate: "2031-07-20", amountHT: "200000.00", vatAmount: "38500.00", amountTTC: "238500.00", balance: "138500.00" });
  session.ids.clientInvoiceIds.push(ci.id);
  invoiceNumbers.client = ci.invoiceNumber;

  // Ordres de travail.
  const technician = await createTestUser({ role: "technician" });
  session.ids.userIds.push(technician.id);
  const [w1, w2] = await db
    .insert(workOrders)
    .values([
      { vehicleId: full.id, technicianId: technician.id, title: uniqueTestToken("ot-prev"), description: "Vidange complete", diagnosis: "RAS", status: "completed", priority: "high", isPreventive: true, startDate: new Date("2026-04-10T12:00:00Z"), endDate: new Date("2026-04-11T12:00:00Z"), duration: 90, cost: "125000.00" },
      { vehicleId: bare.id, title: uniqueTestToken("ot-corr"), description: "Frein", status: "awaiting_parts", priority: "critical" },
    ])
    .returning();
  workOrderIds.push(w1.id, w2.id);
  wo.completed = w1.id;
  wo.awaiting = w2.id;
  people.technician = { username: technician.username, name: technician.name };

  // Utilisateurs : un role traduit, deux roles sans libelle francais.
  for (const role of ["workshop_manager", "warehouse", "management"] as const) {
    const u = await createTestUser({ role });
    session.ids.userIds.push(u.id);
    people[role] = { username: u.username, name: u.name };
  }
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  await session.stop();
}, 60000);

const OPERATIONS_HEADERS = ["Date", "N° Commande", "Client", "Véhicule", "Départ", "Destination", "Carburant (L)", "Coût Carburant", "Distance (km)", "Statut"];

describe("DIR3 : export missions clients", { timeout: 60000 }, () => {
  it("en-tetes et cellules exactes : mission livree avec vehicule, puis mission planifiee sans vehicule", async () => {
    const { wb, type } = await workbook(`/api/exports/client-missions?client=${encodeURIComponent(clientA.name)}`);
    expect(type).toContain("spreadsheetml.sheet");
    expect(wb.SheetNames).toEqual(["Opérations"]);
    expect(headersOf(wb, "Opérations")).toEqual(OPERATIONS_HEADERS);
    const rows = rowsOf(wb, "Opérations");
    expect(rows.find((r) => r["N° Commande"] === orders.delivered)).toEqual({
      Date: "10/02/2026",
      "N° Commande": orders.delivered,
      Client: clientA.name,
      Véhicule: vehicleFull.registrationNumber,
      Départ: "Douala Port",
      Destination: "Yaounde Mvan",
      "Carburant (L)": 120.5,
      "Coût Carburant": 99000,
      "Distance (km)": 250,
      Statut: "delivered",
    });
    // Sans date de livraison : date de creation ; sans affectation : N/A ; distance reelle absente : estimee ; carburant : 0.
    expect(rows.find((r) => r["N° Commande"] === orders.planned)).toEqual({
      Date: "04/03/2026",
      "N° Commande": orders.planned,
      Client: clientA.name,
      Véhicule: "N/A",
      Départ: "Kribi",
      Destination: "Edea",
      "Carburant (L)": 0,
      "Coût Carburant": 0,
      "Distance (km)": 80,
      Statut: "planned",
    });
  });

  it("le filtre par client est une cloison : aucune mission de l'autre client, nom de fichier sur", async () => {
    const { wb, disposition } = await workbook(`/api/exports/client-missions?client=${encodeURIComponent(clientA.name)}`);
    const rows = rowsOf(wb, "Opérations");
    expect(rows.map((r) => r["N° Commande"]).sort()).toEqual([orders.delivered, orders.planned].sort());
    expect(rows.every((r) => r.Client === clientA.name)).toBe(true);
    expect(disposition).toMatch(/^attachment; filename="missions_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.xlsx"$/);
  });

  it("l'alias client-operations (parametre clientName) rend les memes lignes", async () => {
    const viaMissions = rowsOf((await workbook(`/api/exports/client-missions?client=${encodeURIComponent(clientB.name)}`)).wb, "Opérations");
    const { wb, disposition } = await workbook(`/api/exports/client-operations?clientName=${encodeURIComponent(clientB.name)}`);
    expect(rowsOf(wb, "Opérations")).toEqual(viaMissions);
    expect(viaMissions.map((r) => r["N° Commande"])).toEqual([orders.other]);
    expect(disposition).toMatch(/^attachment; filename="operations_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.xlsx"$/);
  });

  it("sans filtre : les missions des deux clients y figurent chacune une fois", async () => {
    const rows = rowsOf((await workbook("/api/exports/client-missions")).wb, "Opérations");
    for (const order of Object.values(orders)) expect(rows.filter((r) => r["N° Commande"] === order)).toHaveLength(1);
  });

  it("client inconnu : classeur valide, aucune ligne ; nom trop long : 400, jamais 500", async () => {
    const { wb } = await workbook("/api/exports/client-missions?client=TEST-aucun-client-dir3");
    expect(rowsOf(wb, "Opérations")).toHaveLength(0);
    const tooLong = await session.raw("GET", `/api/exports/client-missions?client=${"a".repeat(121)}`, "admin");
    expect(tooLong.status).toBe(400);
  });
});

describe("DIR3 : rapport mensuel", { timeout: 60000 }, () => {
  const path = (year: number | string, month: number | string) => `/api/exports/monthly-report?year=${year}&month=${month}`;

  it("quatre feuilles pour un mois plein ; synthese = credits, debits et solde exacts", async () => {
    const { wb, disposition } = await workbook(path(MONTH.year, MONTH.month));
    expect(wb.SheetNames).toEqual(["Synthèse", "Factures Fournisseurs", "Factures Clients", "Carburant"]);
    expect(rowsOf(wb, "Synthèse")).toEqual([
      { Période: "7/2031", "Carburant - Crédits": 500000, "Carburant - Débits": 82800, "Carburant - Solde": 417200 },
    ]);
    expect(disposition).toBe('attachment; filename="rapport_mensuel_7_2031.xlsx"');
  });

  it("facture fournisseur, facture client et lignes carburant du mois : cellules exactes", async () => {
    const { wb } = await workbook(path(MONTH.year, MONTH.month));
    expect(headersOf(wb, "Factures Fournisseurs")).toEqual(["N° Facture", "Fournisseur", "Date", "Montant HT", "TVA", "TTC", "Solde"]);
    expect(rowsOf(wb, "Factures Fournisseurs")).toEqual([
      { "N° Facture": invoiceNumbers.supplier, Fournisseur: expect.stringContaining("TEST-supplier"), Date: "15/07/2031", "Montant HT": 100000, TVA: 19250, TTC: 119250, Solde: 19250 },
    ]);
    expect(headersOf(wb, "Factures Clients")).toEqual(["N° Facture", "Client", "Date", "Montant HT", "TVA", "TTC", "Solde"]);
    expect(rowsOf(wb, "Factures Clients")).toEqual([
      { "N° Facture": invoiceNumbers.client, Client: clientA.name, Date: "20/07/2031", "Montant HT": 200000, TVA: 38500, TTC: 238500, Solde: 138500 },
    ]);
    expect(headersOf(wb, "Carburant")).toEqual(["Date", "Véhicule", "Crédit", "Débit", "Quantité (L)", "Solde"]);
    const fuel = rowsOf(wb, "Carburant");
    expect(fuel).toHaveLength(2);
    expect(fuel).toContainEqual({ Date: "03/07/2031", Véhicule: "CARTE", Crédit: 500000, Débit: 0, "Quantité (L)": 0, Solde: 500000 });
    expect(fuel).toContainEqual({ Date: "12/07/2031", Véhicule: vehicleFull.registrationNumber, Crédit: 0, Débit: 82800, "Quantité (L)": 100, Solde: 417200 });
  });

  it("mois sans donnee : la synthese seule, a zero", async () => {
    const { wb } = await workbook(path(MONTH.year, 8));
    expect(wb.SheetNames).toEqual(["Synthèse"]);
    expect(rowsOf(wb, "Synthèse")).toEqual([{ Période: "8/2031", "Carburant - Crédits": 0, "Carburant - Débits": 0, "Carburant - Solde": 0 }]);
  });

  it("annee ou mois absent, hors bornes ou illisible : 400, jamais 500", async () => {
    for (const q of ["", "?year=2031", "?month=7", "?year=1999&month=7", "?year=2031&month=13", "?year=2031&month=0", "?year=abc&month=7", "?year=2031&month=1.5"]) {
      const res = await session.raw("GET", `/api/exports/monthly-report${q}`, "admin");
      expect(res.status, q).toBe(400);
    }
  });
});

describe("DIR3 : export vehicules", { timeout: 60000 }, () => {
  it("en-tetes dans l'ordre, puis cellules exactes d'un vehicule renseigne et d'un vehicule minimal", async () => {
    const { wb } = await workbook("/api/exports/vehicles");
    expect(wb.SheetNames).toEqual(["Véhicules"]);
    expect(headersOf(wb, "Véhicules")).toEqual([
      "Immatriculation", "Marque", "Modèle", "Année", "Kilométrage", "Statut", "Type de véhicule", "Type de carburant", "Tonnage",
      "Nombre d'essieux", "Numéro VIN", "Date d'achat", "Prix d'achat (XAF)", "Expiration assurance", "Contrôle technique", "Date de création",
    ]);
    const rows = rowsOf(wb, "Véhicules");
    expect(rows.find((r) => r.Immatriculation === vehicleFull.registrationNumber)).toMatchObject({
      Marque: "Renault",
      Modèle: "T480",
      Année: 2021,
      Kilométrage: 123456,
      Statut: "En maintenance",
      "Type de véhicule": "porteur",
      "Type de carburant": "diesel",
      Tonnage: 12.5,
      "Nombre d'essieux": 3,
      "Numéro VIN": "VINDIR3000000001",
      "Date d'achat": "05/03/2024",
      "Prix d'achat (XAF)": "45000000.00",
      "Expiration assurance": "31/01/2027",
      "Contrôle technique": "01/12/2026",
    });
    const bare = rows.find((r) => r.Immatriculation === vehicleBare.registrationNumber)!;
    expect(bare).toMatchObject({ Statut: "Opérationnel" });
    for (const empty of ["Tonnage", "Nombre d'essieux", "Numéro VIN", "Date d'achat", "Prix d'achat (XAF)", "Expiration assurance", "Contrôle technique"]) {
      expect(bare[empty] ?? "", empty).toBe("");
    }
  });

  it("une immatriculation n'apparait qu'une fois, et la date de creation est une date fr-FR", async () => {
    const rows = rowsOf((await workbook("/api/exports/vehicles")).wb, "Véhicules");
    expect(rows.filter((r) => r.Immatriculation === vehicleFull.registrationNumber)).toHaveLength(1);
    expect(String(rows.find((r) => r.Immatriculation === vehicleFull.registrationNumber)!["Date de création"])).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("DIR3 : export ordres de travail", { timeout: 60000 }, () => {
  const numero = (id: number) => `OT-${String(id).padStart(4, "0")}`;

  it("en-tetes dans l'ordre, puis OT preventif termine : toutes les cellules", async () => {
    const { wb } = await workbook("/api/exports/work-orders");
    expect(wb.SheetNames).toEqual(["Ordres de travail"]);
    expect(headersOf(wb, "Ordres de travail")).toEqual([
      "N° OT", "ID Véhicule", "ID Technicien", "Titre", "Description", "Diagnostic", "Statut", "Priorité", "Type",
      "Date de début", "Date de fin", "Durée (h)", "Coût (XAF)", "Date de création",
    ]);
    const row = rowsOf(wb, "Ordres de travail").find((r) => r["N° OT"] === numero(wo.completed))!;
    expect(row).toMatchObject({
      "ID Véhicule": vehicleFull.id,
      Description: "Vidange complete",
      Diagnostic: "RAS",
      Statut: "Terminé",
      Priorité: "Élevée",
      Type: "Préventive",
      "Date de début": "10/04/2026",
      "Date de fin": "11/04/2026",
      "Durée (h)": 90,
      "Coût (XAF)": "125000.00",
    });
    expect(row["Titre"]).toMatch(/^TEST-ot-prev-/);
  });

  it("OT correctif sans technicien : cellules vides, type Corrective", async () => {
    const row = rowsOf((await workbook("/api/exports/work-orders")).wb, "Ordres de travail").find((r) => r["N° OT"] === numero(wo.awaiting))!;
    expect(row).toMatchObject({ "ID Véhicule": vehicleBare.id, Type: "Corrective", Description: "Frein" });
    for (const empty of ["ID Technicien", "Diagnostic", "Date de début", "Date de fin"]) expect(row[empty] ?? "", empty).toBe("");
  });

  // DIR3-2 : la table de statuts du service n'a pas `awaiting_parts` (statut reel de l'OT) ; la cellule porte l'identifiant technique.
  it.fails("DIR3-2 : un OT en attente de pieces est exporte avec un libelle francais", async () => {
    const row = rowsOf((await workbook("/api/exports/work-orders")).wb, "Ordres de travail").find((r) => r["N° OT"] === numero(wo.awaiting))!;
    expect(row.Statut).not.toBe("awaiting_parts");
  });

  // DIR3-3 : la table de priorites connait `urgent`, alors que l'enum du schema dit `critical`.
  it.fails("DIR3-3 : un OT de priorite critique est exporte avec un libelle francais", async () => {
    const row = rowsOf((await workbook("/api/exports/work-orders")).wb, "Ordres de travail").find((r) => r["N° OT"] === numero(wo.awaiting))!;
    expect(row.Priorité).not.toBe("critical");
  });
});

describe("DIR3 : export utilisateurs", { timeout: 60000 }, () => {
  it("six colonnes seulement, aucun secret : ni mot de passe, ni PIN, ni empreinte", async () => {
    const { wb } = await workbook("/api/exports/users");
    expect(wb.SheetNames).toEqual(["Utilisateurs"]);
    expect(headersOf(wb, "Utilisateurs")).toEqual(["ID", "Nom complet", "Nom d'utilisateur", "Rôle", "Email", "Date de création"]);
    expect(JSON.stringify(rowsOf(wb, "Utilisateurs"))).not.toMatch(/\$2[aby]\$/);
  });

  it("cellules exactes d'un chef d'atelier et d'un technicien, roles en francais", async () => {
    const rows = rowsOf((await workbook("/api/exports/users")).wb, "Utilisateurs");
    const chief = rows.find((r) => r["Nom d'utilisateur"] === people.workshop_manager.username)!;
    expect(chief).toMatchObject({ "Nom complet": people.workshop_manager.name, Rôle: "Chef d'atelier", Email: `${people.workshop_manager.username}@fleet.test` });
    expect(String(chief["Date de création"])).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(rows.find((r) => r["Nom d'utilisateur"] === people.technician.username)).toMatchObject({ Rôle: "Technicien" });
  });

  // DIR3-1 : translateUserRole ne connait ni warehouse, ni secretary, ni logistics, ni management (« manager » n'est pas un role).
  it.fails("DIR3-1 : le role magasinier est exporte avec un libelle francais, pas l'identifiant technique", async () => {
    const rows = rowsOf((await workbook("/api/exports/users")).wb, "Utilisateurs");
    const keeper = rows.find((r) => r["Nom d'utilisateur"] === people.warehouse.username)!;
    expect(keeper.Rôle).not.toBe("warehouse");
  });
});

describe("DIR3 : export complet (ZIP)", { timeout: 60000 }, () => {
  async function archive() {
    const res = await session.raw("GET", "/api/exports/complete", "admin");
    expect(res.status).toBe(200);
    return { entries: readZip(Buffer.from(await res.arrayBuffer())), type: res.headers.get("content-type"), disposition: res.headers.get("content-disposition") ?? "" };
  }
  const json = (entries: Map<string, Buffer>, name: string) => JSON.parse(entries.get(name)!.toString("utf8")) as Record<string, unknown>[];

  it("sept fichiers exactement, type zip, nom de fichier date", async () => {
    const { entries, type, disposition } = await archive();
    expect(type).toBe("application/zip");
    expect(disposition).toMatch(/^attachment; filename="?sauvegarde_complete_\d{4}-\d{2}-\d{2}\.zip"?$/);
    expect([...entries.keys()].sort()).toEqual(["README.txt", "fuel_records.json", "parts.json", "stock_movements.json", "users.json", "vehicles.json", "work_orders.json"]);
    expect(entries.get("README.txt")!.toString("utf8")).toContain("Sauvegarde de la base de données");
  });

  it("les donnees du test y sont, une fois chacune, avec leurs champs reels", async () => {
    const { entries } = await archive();
    const vehiclesJson = json(entries, "vehicles.json");
    expect(vehiclesJson.filter((v) => v.registrationNumber === vehicleFull.registrationNumber)).toHaveLength(1);
    expect(vehiclesJson.find((v) => v.id === vehicleFull.id)).toMatchObject({ status: "maintenance", vin: "VINDIR3000000001", mileage: 123456 });
    expect(json(entries, "work_orders.json").find((w) => w.id === wo.completed)).toMatchObject({ status: "completed", isPreventive: true, vehicleId: vehicleFull.id });
    expect(json(entries, "fuel_records.json").filter((f) => f.stationName === "TEST-Station" && f.vehicleId === vehicleFull.id)).toHaveLength(1);
  });

  it("users.json ne contient aucun secret : ni mot de passe, ni PIN, ni empreinte", async () => {
    const { entries } = await archive();
    const usersJson = json(entries, "users.json");
    expect(usersJson.find((u) => u.username === people.warehouse.username)).toMatchObject({ role: "warehouse" });
    for (const user of usersJson) expect(Object.keys(user).sort()).toEqual(["createdAt", "email", "id", "name", "role", "username"]);
    expect(entries.get("users.json")!.toString("utf8")).not.toMatch(/\$2[aby]\$/);
  });

  it("idempotence : deux exports successifs portent les memes enregistrements du test", async () => {
    const first = json((await archive()).entries, "work_orders.json").filter((w) => workOrderIds.includes(w.id as number));
    const second = json((await archive()).entries, "work_orders.json").filter((w) => workOrderIds.includes(w.id as number));
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
  });
});
