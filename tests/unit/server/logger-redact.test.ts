import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { loggerOptions } from "../../../server/lib/logger";

function capture() {
  const lines: string[] = [];
  const sink = new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } });
  return { log: pino({ ...loggerOptions, level: "info" }, sink), lines };
}

describe("journal : détail des erreurs Postgres", () => {
  it("ne sort ni err.detail ni err.where (ligne refusée par une CHECK)", () => {
    const { log, lines } = capture();
    const err = Object.assign(new Error("new row violates check constraint"), {
      code: "23514",
      detail: "Failing row contains (12, chauffeur, 1234, $2b$10$abc)",
      where: "valeur 1234",
    });
    log.error({ err }, "écriture refusée");
    log.error({ ctx: { err } }, "imbriquée");
    const out = lines.join("");
    expect(out).not.toContain("1234");
    expect(out).toContain("23514");
    expect(out).toContain("[masqué]");
  });
});
