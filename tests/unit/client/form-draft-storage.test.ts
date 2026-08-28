import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFormDraftStorage, formatDraftSavedTime } from "@/lib/form-draft-storage";

type SampleDraft = { name: string; qty: number };
type SampleMeta = { step: number };

function createMemoryStorage() {
  const store = new Map<string, string>();

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

describe("createFormDraftStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  });

  it("sauvegarde et recharge un brouillon par utilisateur", () => {
    const storage = createFormDraftStorage<SampleDraft, SampleMeta>({
      formId: "sample-form",
      version: 1,
    });

    storage.save(42, {
      data: { name: "Filtre", qty: 2 },
      savedAt: "2026-08-28T10:00:00.000Z",
      meta: { step: 3 },
    });

    const draft = storage.load(42);
    expect(draft?.data.name).toBe("Filtre");
    expect(draft?.meta?.step).toBe(3);
    expect(draft?.version).toBe(1);
  });

  it("isole les brouillons par utilisateur", () => {
    const storage = createFormDraftStorage<SampleDraft>({
      formId: "sample-form",
      version: 1,
    });

    storage.save(1, {
      data: { name: "Alice", qty: 1 },
      savedAt: "2026-08-28T10:00:00.000Z",
    });
    storage.save(2, {
      data: { name: "Bob", qty: 5 },
      savedAt: "2026-08-28T11:00:00.000Z",
    });

    expect(storage.load(1)?.data.name).toBe("Alice");
    expect(storage.load(2)?.data.name).toBe("Bob");
  });

  it("ignore un brouillon de version incompatible", () => {
    const storageV1 = createFormDraftStorage<SampleDraft>({
      formId: "sample-form",
      version: 1,
    });
    const storageV2 = createFormDraftStorage<SampleDraft>({
      formId: "sample-form",
      version: 2,
    });

    storageV1.save(7, {
      data: { name: "Ancien", qty: 1 },
      savedAt: "2026-08-28T10:00:00.000Z",
    });

    expect(storageV2.load(7)).toBeNull();
  });

  it("efface un brouillon", () => {
    const storage = createFormDraftStorage<SampleDraft>({
      formId: "sample-form",
      version: 1,
    });

    storage.save(9, {
      data: { name: "Temporaire", qty: 1 },
      savedAt: "2026-08-28T10:00:00.000Z",
    });
    storage.clear(9);

    expect(storage.load(9)).toBeNull();
  });
});

describe("formatDraftSavedTime", () => {
  it("formate une heure locale fr-FR", () => {
    const formatted = formatDraftSavedTime("2026-08-28T14:30:00.000Z");
    expect(formatted).toMatch(/\d{2}:\d{2}/);
  });
});
