import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DRIVER_MANAGER_ROLES } from "../../../shared/constants/roles";
import { isPreventiveDateJobEnabled } from "../../../server/lib/preventive-date-job-config";
import { runPreventiveDateCheck } from "../../../server/jobs/preventive-date-check";

describe("interrupteur PREVENTIVE_DATE_JOB_ENABLED (V5a)", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["1", true],
    ["peut-être", true],
    ["false", false],
    ["FALSE", false],
    [" false ", false],
    ["0", false],
  ])("%j -> %s", (raw, expected) => {
    expect(isPreventiveDateJobEnabled(raw)).toBe(expected);
  });
});

describe("verrou inter-instances du préventif par date", () => {
  it("verrou refusé : aucun passage ; verrou obtenu : libéré même si le contrôle échoue", async () => {
    const check = vi.fn().mockResolvedValue([{ id: 1 }]);
    const refused = { tryLock: vi.fn().mockResolvedValue(false), unlock: vi.fn() };
    expect(await runPreventiveDateCheck({ check, lock: refused })).toBe(0);
    expect(check).not.toHaveBeenCalled();
    expect(refused.unlock).not.toHaveBeenCalled();

    const granted = { tryLock: vi.fn().mockResolvedValue(true), unlock: vi.fn().mockResolvedValue(undefined) };
    expect(await runPreventiveDateCheck({ check, lock: granted })).toBe(1);
    expect(granted.unlock).toHaveBeenCalledTimes(1);

    const failing = vi.fn().mockRejectedValue(new Error("base coupée"));
    const lock = { tryLock: vi.fn().mockResolvedValue(true), unlock: vi.fn().mockResolvedValue(undefined) };
    expect(await runPreventiveDateCheck({ check: failing, lock })).toBe(0);
    expect(lock.unlock).toHaveBeenCalledTimes(1);
  });
});

describe("destinataires des alertes de papiers chauffeur", () => {
  it("dérivés de DRIVER_MANAGER_ROLES, sans liste locale", () => {
    const source = readFileSync("server/services/alert-service.ts", "utf8");
    expect(source).toMatch(/driverDocumentRecipients: AlertRecipientRole\[\] = \[\.\.\.DRIVER_MANAGER_ROLES\]/);
    expect(DRIVER_MANAGER_ROLES).toContain("secretary");
  });
});
