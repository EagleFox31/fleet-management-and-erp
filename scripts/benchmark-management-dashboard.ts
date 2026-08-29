/**
 * Mesure latence Neon vs agrégation dashboard Direction.
 * Usage : npm run benchmark:management-dashboard
 */
import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { MANAGEMENT_PERIODS, type ManagementPeriod } from "../shared/constants/management-dashboard";
import { db } from "../server/db";
import { initializeDatabase } from "../server/init-database";
import { managementDashboardService } from "../server/services/management-dashboard-service";

async function measurePing(): Promise<number> {
  const start = performance.now();
  await db.execute(sql`SELECT 1`);
  return performance.now() - start;
}

async function benchmarkPeriod(period: ManagementPeriod, runs = 5): Promise<number> {
  for (let index = 0; index < 2; index += 1) {
    await managementDashboardService.getDashboard(period);
  }

  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    await managementDashboardService.getDashboard(period);
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

async function main() {
  await initializeDatabase();

  const pingMs = await measurePing();
  console.log("Latence Neon (SELECT 1)");
  console.log(`ping     ${pingMs.toFixed(1)} ms\n`);

  console.log("Dashboard Direction — médiane sur 5 appels (2 tours de chauffe)\n");

  for (const period of MANAGEMENT_PERIODS) {
    const medianMs = await benchmarkPeriod(period);
    console.log(`${period.padEnd(8)} ${medianMs.toFixed(1)} ms`);
  }

  console.log(
    "\nSi ping ≈ dashboard, le plancher est réseau/région Neon — pas l'agrégation SQL.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
