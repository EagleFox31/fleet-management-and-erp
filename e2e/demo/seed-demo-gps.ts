/**
 * Seed de la démo « suivi GPS » : deux camions en route, chacun avec un historique de positions réaliste
 * sur un axe camerounais (Douala → Yaoundé par la N3, Douala → Bafoussam par la N5).
 *
 * Les positions passent par le vrai chemin d'écriture du téléphone (`ingestDriverPositions`) : contrôle du
 * chauffeur affecté, fenêtre de la mission, doublons, sauts aberrants, plafond. Aucune insertion SQL directe
 * dans `vehicle_positions`. Idempotent : les missions DEMO-GPS-* d'un passage précédent sont retirées (leurs
 * positions partent en cascade), puis recréées avec des horaires recalés sur l'heure courante.
 *
 * Réutilisable : `seedDemoGps()` (spec logistique, vidéo chauffeur) ou en direct :
 *   node --import tsx e2e/demo/seed-demo-gps.ts
 * Base locale uniquement (`assertLocalDatabase`), serveur lancé avec FEATURE_FLAGS=gps=on pour l'affichage.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { GPS_BATCH_MAX, type GpsPoint } from "../../server/lib/gps-points";
import { ingestDriverPositions } from "../../server/services/vehicle-positions-service";
import { assignments, clients, drivers, missions } from "../../shared/schema";
import { assertLocalDatabase } from "./local-database-guard";
import { DEMO_MISSION, ensureUser, ensureValidPapers, ensureVehicle, isoDayFromNow } from "./seed-demo";

type LatLng = readonly [lat: number, lng: number];

export type DemoGpsTrip = {
  orderNumber: string;
  vehicle: string;
  vehicleModel: string;
  account: { username: string; password: string; name: string; role: "driver" };
  driver: { firstName: string; lastName: string; employeeNumber: string };
  pickup: string;
  delivery: string;
  cargo: string;
  /** Départ, en minutes avant maintenant. */
  startedMinutesAgo: number;
  /** Part du trajet déjà faite à la dernière position (0 à 1). */
  progress: number;
  /** Axe routier, villes traversées dans l'ordre. */
  route: readonly LatLng[];
};

// Coordonnées approchées des villes traversées (axes nationaux).
const N3_DOUALA_YAOUNDE: readonly LatLng[] = [
  [4.0435, 9.6966], // Douala, port
  [4.0102, 9.7781], // Ndokoti
  [4.0006, 9.8402], // Yassa
  [3.9561, 9.9244], // Pont de la Dibamba
  [3.8737, 10.0283], // Ndogbong
  [3.7967, 10.1336], // Edéa
  [3.8158, 10.3227], // Sombo
  [3.8500, 10.5167], // Pouma
  [3.8833, 10.8500], // Boumnyebel
  [3.8361, 11.0750], // Matomb
  [3.7833, 11.3833], // Mbankomo
  [3.8480, 11.5021], // Yaoundé
];

const N5_DOUALA_BAFOUSSAM: readonly LatLng[] = [
  [4.0435, 9.6966], // Douala, port
  [4.0733, 9.6600], // Bonabéri
  [4.3167, 9.6100], // Mbanga (route)
  [4.5000, 9.5667], // Mbanga
  [4.5833, 9.6667], // Njombé
  [4.6833, 9.7333], // Loum
  [4.9500, 9.9333], // Nkongsamba
  [5.1167, 9.9500], // Melong
  [5.1500, 10.0333], // Kekem
  [5.1667, 10.1833], // Bafang
  [5.4781, 10.4176], // Bafoussam
];

export const DEMO_GPS_TRIPS: readonly DemoGpsTrip[] = [
  {
    orderNumber: "DEMO-GPS-001",
    vehicle: "DEMO-GPS-001",
    vehicleModel: "Premium 460",
    account: { username: "chauffeur-gps1", password: "chauffeur123", name: "Martin Ebongue", role: "driver" },
    driver: { firstName: "Martin", lastName: "Ebongue", employeeNumber: "DEMO-EMP-GPS1" },
    pickup: "Douala, port autonome",
    delivery: "Yaoundé, entrepôt central",
    cargo: "Sacs de ciment, 30 tonnes",
    startedMinutesAgo: 170,
    progress: 0.62,
    route: N3_DOUALA_YAOUNDE,
  },
  {
    orderNumber: "DEMO-GPS-002",
    vehicle: "DEMO-GPS-002",
    vehicleModel: "T480",
    account: { username: "chauffeur-gps2", password: "chauffeur123", name: "Alain Fouda", role: "driver" },
    driver: { firstName: "Alain", lastName: "Fouda", employeeNumber: "DEMO-EMP-GPS2" },
    pickup: "Douala, port autonome",
    delivery: "Bafoussam, marché A",
    cargo: "Riz en sacs, 25 tonnes",
    startedMinutesAgo: 115,
    progress: 0.45,
    route: N5_DOUALA_BAFOUSSAM,
  },
];

/** Relevé toutes les 2 minutes, comme le téléphone en mission. */
const SAMPLE_MINUTES = 2;
/** Dernière position, une minute avant maintenant : la carte la montre « à l'instant ». */
const LAST_POINT_MINUTES_AGO = 1;

function haversineKm(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function bearing(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad);
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad);
  return Math.round((((Math.atan2(y, x) / rad) + 360) % 360) * 10) / 10 % 360;
}

/** Point situé à `fraction` de la longueur de l'axe, et le cap du tronçon. */
function pointAlong(route: readonly LatLng[], fraction: number): { at: LatLng; heading: number } {
  const legs = route.slice(1).map((p, i) => haversineKm(route[i], p));
  let remaining = fraction * legs.reduce((s, l) => s + l, 0);
  for (let i = 0; i < legs.length; i++) {
    if (remaining <= legs[i] || i === legs.length - 1) {
      const t = legs[i] === 0 ? 0 : Math.min(1, remaining / legs[i]);
      const [a, b] = [route[i], route[i + 1]];
      return { at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: bearing(a, b) };
    }
    remaining -= legs[i];
  }
  return { at: route[route.length - 1], heading: 0 };
}

/**
 * Historique du trajet : un relevé toutes les 2 minutes entre le départ et maintenant. L'avancement suit une
 * vitesse irrégulière (traversée de ville, bouchon de Ndokoti, route dégagée) mais reste continu : aucun point
 * ne dépasse la vitesse plausible, aucun n'est marqué suspect.
 */
export function buildTrack(trip: DemoGpsTrip, now: Date): GpsPoint[] {
  const start = now.getTime() - trip.startedMinutesAgo * 60_000;
  const end = now.getTime() - LAST_POINT_MINUTES_AGO * 60_000;
  const steps = Math.floor((end - start) / (SAMPLE_MINUTES * 60_000));
  // Poids de vitesse par pas : lent au départ (ville), plus soutenu ensuite, une pause courte au milieu.
  const weights = Array.from({ length: steps + 1 }, (_, i) => {
    if (i === 0) return 0;
    const share = i / steps;
    if (share < 0.12) return 0.45;
    if (share > 0.48 && share < 0.52) return 0.1;
    return 1 + 0.15 * Math.sin(i * 1.7);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  const routeKm = trip.route.slice(1).reduce((s, p, i) => s + haversineKm(trip.route[i], p), 0);
  let covered = 0;
  return weights.map((w, i) => {
    covered += w;
    const fraction = (covered / total) * trip.progress;
    const { at, heading } = pointAlong(trip.route, fraction);
    const speedKmh = i === 0 ? 0 : Math.round(((w / total) * trip.progress * routeKm) / (SAMPLE_MINUTES / 60));
    return {
      clientPointId: randomUUID(),
      recordedAt: new Date(i === steps ? end : start + i * SAMPLE_MINUTES * 60_000),
      lat: Math.round(at[0] * 1e6) / 1e6,
      lng: Math.round(at[1] * 1e6) / 1e6,
      accuracyM: 8 + (i % 5) * 3,
      speedKmh,
      heading,
    };
  });
}

async function ensureDriver(trip: DemoGpsTrip, userId: number): Promise<number> {
  await db.update(drivers).set({ userId: null }).where(and(eq(drivers.userId, userId), ne(drivers.employeeNumber, trip.driver.employeeNumber)));
  await db
    .insert(drivers)
    .values({ userId, ...trip.driver, cpcStatus: "FORMÉ", cpcTrainingDate: isoDayFromNow(-30), licenseExpiry: "2099-12-31", isActive: true })
    .onConflictDoNothing();
  await db.update(drivers).set({ userId, isActive: true }).where(eq(drivers.employeeNumber, trip.driver.employeeNumber));
  const [row] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.employeeNumber, trip.driver.employeeNumber));
  return row.id;
}

export type SeededGpsTrip = { orderNumber: string; missionId: number; vehicleId: number; accepted: number; lastAt: Date };

export async function seedDemoGps(now = new Date()): Promise<SeededGpsTrip[]> {
  assertLocalDatabase();
  // Positions d'un passage précédent : supprimées avec leur mission (cascade sur vehicle_positions.mission_id).
  const old = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, "DEMO-GPS-%"));
  if (old.length > 0) {
    const ids = old.map((m) => m.id);
    await db.delete(assignments).where(inArray(assignments.missionId, ids));
    await db.delete(missions).where(inArray(missions.id, ids));
  }
  await db.insert(clients).values({ name: DEMO_MISSION.clientName, paymentTerms: 30 }).onConflictDoNothing();
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.name, DEMO_MISSION.clientName));

  const seeded: SeededGpsTrip[] = [];
  for (const trip of DEMO_GPS_TRIPS) {
    const userId = await ensureUser(trip.account);
    const driverId = await ensureDriver(trip, userId);
    const vehicleId = await ensureVehicle(trip.vehicle, trip.vehicleModel, null);
    await ensureValidPapers(vehicleId, trip.vehicle);
    const startedAt = new Date(now.getTime() - trip.startedMinutesAgo * 60_000);
    const [mission] = await db
      .insert(missions)
      .values({
        clientId: client.id,
        orderNumber: trip.orderNumber,
        pickupAddress: trip.pickup,
        pickupDate: startedAt,
        deliveryAddress: trip.delivery,
        deliveryDate: new Date(now.getTime() + 3 * 3_600_000),
        cargo: { description: trip.cargo },
        status: "in_progress",
      })
      .returning({ id: missions.id });
    await db.insert(assignments).values({
      missionId: mission.id,
      vehicleId,
      driverId,
      status: "in_progress",
      assignedAt: new Date(startedAt.getTime() - 30 * 60_000),
      acceptedAt: new Date(startedAt.getTime() - 20 * 60_000),
      startedAt,
    });

    // Le téléphone du chauffeur envoie ses relevés par paquets, comme en route.
    const points = buildTrack(trip, now);
    let accepted = 0;
    for (let i = 0; i < points.length; i += GPS_BATCH_MAX) {
      const result = await ingestDriverPositions({ id: userId, role: "driver" }, mission.id, points.slice(i, i + GPS_BATCH_MAX), { now });
      if (result.rejected > 0 || result.suspect > 0) {
        throw new Error(`${trip.orderNumber} : ${result.rejected} relevé(s) refusé(s), ${result.suspect} suspect(s)`);
      }
      accepted += result.accepted;
    }
    seeded.push({ orderNumber: trip.orderNumber, missionId: mission.id, vehicleId, accepted, lastAt: points[points.length - 1].recordedAt });
  }
  return seeded;
}

const isMain = process.argv[1] && /seed-demo-gps\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  seedDemoGps()
    .then(async (trips) => {
      for (const t of trips) console.log(`${t.orderNumber} : mission ${t.missionId}, ${t.accepted} positions`);
      await pool.end();
    })
    .catch(async (error) => {
      console.error("seed GPS de démo en échec :", error instanceof Error ? error.message : error);
      await pool.end();
      process.exit(1);
    });
}
