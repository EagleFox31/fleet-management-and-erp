import { describe, expect, it, vi } from "vitest";
import { BCRYPT_HASH_RE, passwordForRestore } from "../../../server/lib/user-password";

const bcryptHash = "$2b$10$" + "a".repeat(53);
const sha256 = "a".repeat(64);

describe("passwordForRestore", () => {
  it("hash bcrypt complet et SHA-256 hérité (hex minuscule) : repris tels quels", async () => {
    expect(await passwordForRestore(bcryptHash)).toBe(bcryptHash);
    expect(await passwordForRestore(sha256)).toBe(sha256);
  });

  it("clair conforme : haché bcrypt", async () => {
    const out = await passwordForRestore("clair-123");
    expect(out).toMatch(BCRYPT_HASH_RE);
    expect(out).not.toContain("clair-123");
  });

  it("préfixe bcrypt sans hash valide ou SHA-256 majuscule : traité comme clair, donc haché", async () => {
    for (const v of ["$2b$" + "x".repeat(56), "$2b$10$" + "!".repeat(53), "A".repeat(64)]) {
      const out = await passwordForRestore(v);
      expect(out).not.toBe(v);
      expect(out).toMatch(BCRYPT_HASH_RE);
    }
  });

  it("vide, absent, trop court ou non textuel : hash aléatoire inutilisable, onInvalid sans argument", async () => {
    const onInvalid = vi.fn();
    for (const v of ["", "abc", undefined, null, 123456]) {
      expect(await passwordForRestore(v, onInvalid)).toMatch(BCRYPT_HASH_RE);
    }
    expect(onInvalid).toHaveBeenCalledTimes(5);
    for (const call of onInvalid.mock.calls) expect(call).toEqual([]);
  });
});
