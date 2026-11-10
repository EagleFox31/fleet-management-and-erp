import { describe, expect, it, vi } from "vitest";
import { createControllerChangeHandler, hasNonEmptyDraft } from "@/lib/pwa-update";

function memoryStorage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null };
}

const deps = (over: Partial<Parameters<typeof createControllerChangeHandler>[0]> = {}) => ({
  hadController: true,
  hasDraft: () => false,
  reload: vi.fn(),
  onUpdateAvailable: vi.fn(),
  ...over,
});

describe("mise à jour du service worker : controllerchange", () => {
  it("rechargement unique, même si l'événement se répète", () => {
    const d = deps();
    const handle = createControllerChangeHandler(d);
    handle();
    handle();
    handle();
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.onUpdateAvailable).not.toHaveBeenCalled();
  });

  it("brouillon non vide : bandeau, aucun rechargement", () => {
    const d = deps({ hasDraft: () => true });
    const handle = createControllerChangeHandler(d);
    handle();
    handle();
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it("première prise de contrôle (aucun worker avant) : ni rechargement ni bandeau", () => {
    const d = deps({ hadController: false });
    createControllerChangeHandler(d)();
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.onUpdateAvailable).not.toHaveBeenCalled();
  });
});

describe("détection d'un brouillon de formulaire non vide", () => {
  it("clé de brouillon avec données : vrai", () => {
    const s = memoryStorage({ "fleetos-supplier-new-v1-12": JSON.stringify({ version: 1, data: { name: "A" }, savedAt: "x" }) });
    expect(hasNonEmptyDraft(s)).toBe(true);
  });

  it("données nulles, JSON illisible, autre clé : faux", () => {
    expect(hasNonEmptyDraft(memoryStorage({ "fleetos-x-v1-12": JSON.stringify({ version: 1, data: null }) }))).toBe(false);
    expect(hasNonEmptyDraft(memoryStorage({ "fleetos-x-v1-12": "{pas du json" }))).toBe(false);
    expect(hasNonEmptyDraft(memoryStorage({ theme: JSON.stringify({ data: 1 }) }))).toBe(false);
    expect(hasNonEmptyDraft(null)).toBe(false);
  });
});
