import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  rejectedAccounts,
  rejectedAccountsMessage,
  type PreflightAccount,
} from "../../../e2e/helpers/account-preflight";

const admin: PreflightAccount = { username: "admin", password: "admin123", label: "admin" };
const manager: PreflightAccount = { username: "terry", password: "workshop123", label: "chef d'atelier" };
const viewer: PreflightAccount = { username: "fatou", password: "warehouse123", label: "magasinier" };

describe("contrôle des comptes e2e avant la suite", () => {
  it("retient les comptes refusés en 401 ou 403", async () => {
    const statuses: Record<string, number> = { admin: 401, terry: 200, fatou: 403 };
    const rejected = await rejectedAccounts([admin, manager, viewer], async (a) => statuses[a.username]);
    expect(rejected.map((a) => a.username)).toEqual(["admin", "fatou"]);
  });

  it("n'impute pas au compte un serveur muet ou en panne", async () => {
    const statuses: Record<string, number | null> = { admin: null, terry: 503, fatou: 500 };
    expect(await rejectedAccounts([admin, manager, viewer], async (a) => statuses[a.username])).toEqual([]);
  });

  it("ne sonde qu'une fois un même compte", async () => {
    const probed: string[] = [];
    await rejectedAccounts([admin, { ...admin, label: "autre" }], async (a) => {
      probed.push(a.username);
      return 200;
    });
    expect(probed).toEqual(["admin"]);
  });

  it("nomme les comptes sans jamais citer de mot de passe", () => {
    const message = rejectedAccountsMessage([admin, viewer]);
    expect(message).toContain("admin (admin)");
    expect(message).toContain("magasinier (fatou)");
    expect(message).not.toContain("admin123");
    expect(message).not.toContain("warehouse123");
  });

  it("est branché dans le global-setup de Playwright", () => {
    const setup = readFileSync("e2e/global-setup.ts", "utf8");
    expect(setup).toMatch(/rejectedAccounts\(/);
    expect(setup).toMatch(/throw new Error\(rejectedAccountsMessage\(/);
  });
});
