import { describe, it, expect } from "vitest";
import { singleFlight } from "@/lib/single-flight";

type Call = { variables: number; settle: () => void };

function fakeMutate() {
  const calls: Call[] = [];
  const mutate = (variables: number, options: { onSettled: () => void }) => {
    calls.push({ variables, settle: options.onSettled });
  };
  return { calls, mutate };
}

describe("singleFlight", () => {
  it("ignore un second envoi tant que le premier n'est pas terminé (double clic)", () => {
    const { calls, mutate } = fakeMutate();
    const submit = singleFlight(mutate);

    expect(submit(1)).toBe(true);
    expect(submit(1)).toBe(false);

    expect(calls).toHaveLength(1);
  });

  it("rouvre l'envoi une fois la mutation terminée, succès ou erreur", () => {
    const { calls, mutate } = fakeMutate();
    const submit = singleFlight(mutate);

    submit(1);
    calls[0].settle();
    expect(submit(2)).toBe(true);

    expect(calls.map((call) => call.variables)).toEqual([1, 2]);
  });

  it("rouvre l'envoi si le lancement lui-même échoue", () => {
    let attempts = 0;
    const submit = singleFlight<number>(() => {
      attempts++;
      if (attempts === 1) throw new Error("lancement impossible");
    });

    expect(() => submit(1)).toThrow("lancement impossible");
    expect(submit(1)).toBe(true);
    expect(attempts).toBe(2);
  });
});
