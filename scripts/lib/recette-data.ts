/**
 * Données fictives de recette (T-26b). Toute ligne porte un marqueur reconnaissable
 * (`RCT-` dans la clé naturelle, ou rattachement à un compte `recette_*` / un véhicule `RCT-*`)
 * pour que le reset ne retire que ce que le seed possède. Insertions idempotentes (NOT EXISTS).
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

const reg = (n: number) => `RCT-${String(n).padStart(3, "0")}`;
const vid = `(SELECT id FROM vehicles WHERE registration_number = $1)`;
const uid = (p: string) => `(SELECT id FROM users WHERE username = ${p})`;

/** Codes de pointage valides (feuille Excel). */
export const TIME_CODES = ["JT", "M", "Mi", "C", "A", "R", "Re"] as const;

export async function seedRecetteData(c: Queryable, opts: { pinHash: string | null }): Promise<void> {
  // Fournisseurs et clients fictifs
  for (const name of ["RCT-Fournisseur Pièces", "RCT-Fournisseur Pneus"]) {
    await c.query(`INSERT INTO suppliers (name) SELECT $1::text WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = $1)`, [name]);
  }
  for (const name of ["RCT-Client Alpha", "RCT-Client Beta"]) {
    await c.query(`INSERT INTO clients (name, email) SELECT $1::text, 'rct@recette.invalid' WHERE NOT EXISTS (SELECT 1 FROM clients WHERE name = $1)`, [name]);
  }

  // Pièces : stock sain, stock exactement au seuil (<=), stock sous le seuil
  const parts: [string, string, number, number][] = [
    ["Filtre à huile", "RCT-P-001", 20, 5],
    ["Plaquettes de frein", "RCT-P-002", 5, 5],
    ["Courroie", "RCT-P-003", 2, 5],
    ["Joint de culasse", "RCT-P-004", 0, 2],
    ["Ampoule", "RCT-P-005", 40, 10],
  ];
  for (const [name, ref, qty, min] of parts) {
    await c.query(
      `INSERT INTO parts (name, reference, quantity, min_quantity, real_stock, reorder_alert, unit_price, supplier_id)
       SELECT $1::text, $2::text, $3::int, $4::int, $3::int, ($3::int <= $4::int), 1500, (SELECT id FROM suppliers WHERE name = 'RCT-Fournisseur Pièces')
       WHERE NOT EXISTS (SELECT 1 FROM parts WHERE reference = $2)`,
      [name, ref, qty, min],
    );
  }
  // Pneus (la table n'a pas de référence : marqueur dans le modèle)
  for (const [i, size] of ["315/80R22.5", "295/80R22.5", "11R22.5"].entries()) {
    await c.query(
      `INSERT INTO tires (brand, model, size, stock_quantity, min_stock_level)
       SELECT 'MarqueTest', $1::text, $2::text, $3::int, 4 WHERE NOT EXISTS (SELECT 1 FROM tires WHERE model = $1)`,
      [`RCT-T-${i + 1}`, size, [10, 4, 1][i]],
    );
  }
  // Alertes de stock bas (seuil <=) pour le magasinier
  for (const ref of ["RCT-P-002", "RCT-P-003", "RCT-P-004"]) {
    await c.query(
      `INSERT INTO alerts (user_id, title, message, type, priority, dedupe_key)
       SELECT ${uid("'recette_magasinier'")}, 'Stock bas', $1::text, 'stock', 'high', $1::text
       WHERE NOT EXISTS (SELECT 1 FROM alerts WHERE user_id = ${uid("'recette_magasinier'")} AND dedupe_key = $1)`,
      [`RCT-stock-${ref}`],
    );
  }

  // Ordres de travail : tous statuts ; deux OT pour la même ressource hors créneau (contraintes EXCLUDE)
  const wo: [number, string, string, string, string, string | null][] = [
    // véhicule, titre, statut, technicien, début (J+n), fin (J+n)
    [5, "RCT OT-1 vidange", "pending", "recette_technicien_1", "1", "2"],
    [5, "RCT OT-2 freins", "in_progress", "recette_technicien_1", "3", "4"],
    [6, "RCT OT-3 pneus", "awaiting_parts", "recette_technicien_2", "1", "2"],
    [7, "RCT OT-4 clôturé", "completed", "recette_technicien_2", "-6", "-5"],
    [8, "RCT OT-5 annulé", "cancelled", "recette_technicien_1", "-4", "-3"],
    [9, "RCT OT-6 sans fin", "pending", "recette_technicien_2", "5", null],
  ];
  for (const [n, title, status, tech, from, to] of wo) {
    await c.query(
      `INSERT INTO work_orders (vehicle_id, title, status, priority, technician_id, start_date, end_date, created_by)
       SELECT v.id, $2::text, $3::text, 'medium', ${uid("$4")}, now() + ($5 || ' days')::interval,
              CASE WHEN $6::text IS NULL THEN NULL ELSE now() + ($6 || ' days')::interval END, ${uid("'recette_chef_atelier'")}
       FROM vehicles v WHERE v.registration_number = $1
         AND NOT EXISTS (SELECT 1 FROM work_orders w WHERE w.vehicle_id = v.id AND w.title = $2)`,
      [reg(n), title, status, tech, from, to],
    );
  }

  // Demandes de pièce : chaîne complète pending -> approved -> ordered -> received -> issued, + annulée
  const chain = ["pending", "approved", "ordered", "received", "issued", "cancelled"];
  for (const [i, status] of chain.entries()) {
    const reason = `RCT demande ${status}`;
    await c.query(
      `INSERT INTO part_requirements (part_id, vehicle_id, work_order_id, quantity_needed, reason, status, requested_by)
       SELECT (SELECT id FROM parts WHERE reference = $2), v.id,
              (SELECT w.id FROM work_orders w WHERE w.vehicle_id = v.id ORDER BY w.id LIMIT 1), 1, $3::text, $4::text, ${uid("'recette_technicien_1'")}
       FROM vehicles v WHERE v.registration_number = $1
         AND NOT EXISTS (SELECT 1 FROM part_requirements r WHERE r.vehicle_id = v.id AND r.reason = $3)`,
      [reg(5), `RCT-P-00${(i % 5) + 1}`, reason, status],
    );
  }

  // Pleins : un normal, un à consommation anormale, un bon en attente de validation
  const fuel: [string, number, number, number, string][] = [
    ["RCT plein normal", 120, 90000, 10000, "validated"],
    ["RCT plein anormal", 900, 675000, 10500, "validated"],
    ["RCT bon en attente", 100, 75000, 11000, "pending"],
  ];
  for (const [note, qty, cost, mileage, validation] of fuel) {
    await c.query(
      `INSERT INTO fuel_records (vehicle_id, date, quantity, cost, mileage, notes, validation_status)
       SELECT v.id, now(), $2::real, $3::int, $4::int, $1::text, $5::text FROM vehicles v WHERE v.registration_number = $6
         AND NOT EXISTS (SELECT 1 FROM fuel_records f WHERE f.vehicle_id = v.id AND f.notes = $1)`,
      [note, qty, cost, mileage, validation, reg(1)],
    );
  }

  // Missions et factures (une partiellement payée)
  const missions: [string, string, number, number][] = [
    ["RCT-M-001", "RCT-Client Alpha", 1000000, 1000000],
    ["RCT-M-002", "RCT-Client Beta", 500000, 200000],
  ];
  for (const [order, client, ttc, balance] of missions) {
    await c.query(
      `INSERT INTO missions (client_id, order_number, pickup_address, delivery_address, status)
       SELECT (SELECT id FROM clients WHERE name = $2), $1::text, 'Douala', 'Yaoundé', 'completed'
       WHERE NOT EXISTS (SELECT 1 FROM missions WHERE order_number = $1)`,
      [order, client],
    );
    await c.query(
      `INSERT INTO client_invoices (mission_id, client_id, invoice_number, invoice_date, due_date, amount_ht, amount_ttc, balance, status)
       SELECT m.id, m.client_id, $2::text, now(), now() + interval '30 days', $3::numeric / 1.1925, $3::numeric, $4::numeric, $5::text
       FROM missions m WHERE m.order_number = $1 AND NOT EXISTS (SELECT 1 FROM client_invoices WHERE invoice_number = $2)`,
      [order, order.replace("-M-", "-F-"), ttc, balance, balance < ttc ? "partial" : "sent"],
    );
  }

  // Documents véhicule : les 9 types contractuels, échéances à J+10, J+29 et J+31
  const types = ["carte_grise", "carte_bleue", "visite_technique", "acf", "tae", "vignette", "jaugeage", "assurance", "agrement_pd"];
  const offsets = [10, 29, 31];
  for (const [i, type] of types.entries()) {
    await c.query(
      `INSERT INTO vehicle_documents (vehicle_id, name, type, filename, filesize, file_type, file_path, expiry_date)
       SELECT v.id, $2::text, $2::text, $3::text, 0, 'application/pdf', $4::text, current_date + $5::int
       FROM vehicles v WHERE v.registration_number = $1
         AND NOT EXISTS (SELECT 1 FROM vehicle_documents d WHERE d.vehicle_id = v.id AND d.type = $2)`,
      [reg(2 + (i % 3)), type, `rct-${type}.pdf`, `uploads/recette/rct-${type}.pdf`, offsets[i % 3]],
    );
  }

  // Chauffeurs fictifs et pointage (3 personnes, codes valides)
  const crew = ["recette_chauffeur", "recette_technicien_1", "recette_technicien_2"];
  for (const [i, username] of crew.entries()) {
    await c.query(
      `INSERT INTO drivers (user_id, first_name, last_name, employee_number)
       SELECT ${uid("$1")}, 'Recette', $2::text, $3::text WHERE NOT EXISTS (SELECT 1 FROM drivers WHERE employee_number = $3)`,
      [username, `Chauffeur ${i + 1}`, `RCT-D${i + 1}`],
    );
    for (let d = 1; d <= 7; d++) {
      await c.query(
        `INSERT INTO time_tracking (user_id, date, status, month, year)
         SELECT ${uid("$1")}, (date_trunc('month', current_date) + ($2::int - 1) * interval '1 day')::date, $3::text,
                extract(month from current_date)::int, extract(year from current_date)::int
         WHERE NOT EXISTS (SELECT 1 FROM time_tracking WHERE user_id = ${uid("$1")}
           AND date = (date_trunc('month', current_date) + ($2::int - 1) * interval '1 day')::date)`,
        [username, d, TIME_CODES[(d + i) % TIME_CODES.length]],
      );
    }
  }

  // PIN du compte chauffeur (haché ; jamais dans le dépôt)
  if (opts.pinHash) {
    await c.query(`UPDATE users SET pin = $1 WHERE username = 'recette_chauffeur' AND pin IS NULL`, [opts.pinHash]);
  }
}

/** Retire uniquement les lignes possédées par le seed, dans l'ordre des clés étrangères. */
export async function deleteRecetteData(c: Queryable): Promise<void> {
  const rv = `(SELECT id FROM vehicles WHERE registration_number LIKE 'RCT-%')`;
  const ru = `(SELECT id FROM users WHERE username LIKE 'recette\\_%')`;
  const stmts = [
    // Portée de la transaction (recette-reset ouvre BEGIN) : lève les verrous d'argent pour ce reset seul.
    `select set_config('fleetos.allow_money_override', 'on', true)`,
    `DELETE FROM client_payments WHERE invoice_id IN (SELECT id FROM client_invoices WHERE invoice_number LIKE 'RCT-%')`,
    `DELETE FROM client_invoices WHERE invoice_number LIKE 'RCT-%'`,
    `DELETE FROM missions WHERE order_number LIKE 'RCT-%'`,
    `DELETE FROM clients WHERE name LIKE 'RCT-%'`,
    `DELETE FROM purchase_order_lines WHERE part_requirement_id IN (SELECT id FROM part_requirements WHERE vehicle_id IN ${rv})`,
    `DELETE FROM part_requirements WHERE vehicle_id IN ${rv}`,
    `DELETE FROM parts_stock_movements WHERE part_id IN (SELECT id FROM parts WHERE reference LIKE 'RCT-%')`,
    `DELETE FROM parts_used WHERE part_id IN (SELECT id FROM parts WHERE reference LIKE 'RCT-%')`,
    `DELETE FROM parts WHERE reference LIKE 'RCT-%'`,
    `DELETE FROM tires WHERE model LIKE 'RCT-%'`,
    `DELETE FROM suppliers WHERE name LIKE 'RCT-%'`,
    `DELETE FROM fuel_records WHERE vehicle_id IN ${rv}`,
    `DELETE FROM vehicle_documents WHERE vehicle_id IN ${rv}`,
    `DELETE FROM work_orders WHERE vehicle_id IN ${rv}`,
    `DELETE FROM alerts WHERE user_id IN ${ru}`,
    `DELETE FROM time_tracking WHERE user_id IN ${ru}`,
    `DELETE FROM drivers WHERE employee_number LIKE 'RCT-%'`,
    `DELETE FROM vehicles WHERE registration_number LIKE 'RCT-%'`,
    `DELETE FROM notification_preferences WHERE user_id IN ${ru}`,
    `DELETE FROM users WHERE username LIKE 'recette\\_%'`,
  ];
  for (const s of stmts) await c.query(s);
}
