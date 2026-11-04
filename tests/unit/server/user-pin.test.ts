import { describe, expect, it, vi } from "vitest";

vi.mock("../../../server/db", () => ({ db: {} }));
import { pinForRestore } from "../../../server/lib/user-pin";

describe("pinForRestore", () => {
  const hash = "$2b$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234";
  it("PIN clair a 4 chiffres (chaine ou nombre) : haché bcrypt", async () => {
    expect(await pinForRestore("1234")).toMatch(/^\$2[aby]\$/);
    expect(await pinForRestore(1234)).toMatch(/^\$2[aby]\$/);
  });
  it("hash bcrypt : inchangé ; vide ou absent : null", async () => {
    expect(await pinForRestore(hash)).toBe(hash);
    for (const v of ["", "  ", null, undefined]) expect(await pinForRestore(v)).toBeNull();
  });
  it("non conforme : null et onInvalid appelé sans la valeur", async () => {
    const onInvalid = vi.fn();
    expect(await pinForRestore("12345", onInvalid)).toBeNull();
    expect(await pinForRestore("abcd", onInvalid)).toBeNull();
    expect(onInvalid).toHaveBeenCalledTimes(2);
    expect(onInvalid.mock.calls[0]).toEqual([]);
  });
});
