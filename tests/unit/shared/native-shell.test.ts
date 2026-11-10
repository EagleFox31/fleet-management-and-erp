import { afterEach, describe, expect, it, vi } from "vitest";
import { renderNativeOfflinePage, resolveNativeServer } from "../../../shared/native-shell";

describe("coquille native : origine du serveur (CAP_SERVER_URL)", () => {
  it("vide ou absente : bundle local", () => {
    expect(resolveNativeServer(undefined)).toBeNull();
    expect(resolveNativeServer("  ")).toBeNull();
  });

  it("origine https : chargée sans trafic en clair, barre finale retirée", () => {
    expect(resolveNativeServer("https://fleet.example.com/")).toEqual({ url: "https://fleet.example.com", cleartext: false });
    expect(resolveNativeServer(" https://fleet.example.com:8443 ")).toEqual({ url: "https://fleet.example.com:8443", cleartext: false });
  });

  it("http : trafic en clair autorisé (serveur de test sur le réseau local)", () => {
    expect(resolveNativeServer("http://192.168.1.20:5000")).toEqual({ url: "http://192.168.1.20:5000", cleartext: true });
  });

  it.each([
    ["fleet.example.com", "illisible"],
    ["ftp://fleet.example.com", "https://"],
    ["https://user:pw@fleet.example.com", "identifiants"],
    ["https://fleet.example.com/app", "origine seule"],
    ["https://fleet.example.com/?x=1", "origine seule"],
  ])("refuse %s avec un message actionnable", (raw, fragment) => {
    expect(() => resolveNativeServer(raw)).toThrow(fragment);
  });

  it("page hors ligne : lien de relance vers l'origine, échappé, sans emoji", () => {
    const html = renderNativeOfflinePage({ url: "https://fleet.example.com", cleartext: false });
    expect(html).toContain('href="https://fleet.example.com/"');
    expect(html).toContain("Serveur injoignable");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    const hostile = renderNativeOfflinePage({ url: 'https://x.example"><script>', cleartext: false });
    expect(hostile).not.toContain("<script>");
  });
});

describe("capacitor.config.ts : verrous de la coquille", () => {
  const loadConfig = async (url: string | undefined) => {
    vi.resetModules();
    if (url === undefined) vi.stubEnv("CAP_SERVER_URL", "");
    else vi.stubEnv("CAP_SERVER_URL", url);
    return (await import("../../../capacitor.config")).default;
  };
  afterEach(() => vi.unstubAllEnvs());

  it("origine https : pas de trafic en clair, page hors ligne, aucune autre origine navigable", async () => {
    const config = await loadConfig("https://fleet.example.com");
    expect(config.server).toMatchObject({ url: "https://fleet.example.com", cleartext: false, errorPath: "offline.html" });
    // Sans allowNavigation, Capacitor ouvre toute autre origine dans le navigateur externe.
    expect(config.server?.allowNavigation).toBeUndefined();
  });

  it("sans origine : configuration de développement inchangée", async () => {
    const config = await loadConfig(undefined);
    expect(config.server).toEqual({ androidScheme: "https", cleartext: true });
  });
});
