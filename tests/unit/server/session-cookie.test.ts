import { describe, expect, it } from "vitest";
import { sessionCookieFlags } from "../../../server/lib/session-cookie";

describe("sessionCookieFlags", () => {
  it("production HTTPS : secure + sameSite none (inchangé)", () => {
    expect(sessionCookieFlags({ NODE_ENV: "production", APP_URL: "https://recette.example" })).toEqual({ secure: true, sameSite: "none" });
    expect(sessionCookieFlags({ NODE_ENV: "production" })).toEqual({ secure: true, sameSite: "none" });
  });

  it("serveur de site en HTTP sur le LAN : cookie accepté par le navigateur", () => {
    expect(sessionCookieFlags({ NODE_ENV: "production", APP_URL: "http://192.168.1.20:5000" })).toEqual({ secure: false, sameSite: "lax" });
    expect(sessionCookieFlags({ ALLOW_CROSS_SITE_COOKIES: "true", APP_URL: "http://10.0.0.5:5000" })).toEqual({ secure: false, sameSite: "lax" });
  });

  it("développement : lax, non secure ; ALLOW_CROSS_SITE_COOKIES force none en HTTPS", () => {
    expect(sessionCookieFlags({ NODE_ENV: "development" })).toEqual({ secure: false, sameSite: "lax" });
    expect(sessionCookieFlags({ ALLOW_CROSS_SITE_COOKIES: "true" })).toEqual({ secure: true, sameSite: "none" });
  });
});

describe("sessionCookieFlags : secure=false seulement si APP_URL commence par http://", () => {
  it.each([
    "https://app.example.com",
    "HTTPS://app.example.com",
    "https://app.example.com/?next=http://x",
    " http://192.168.1.20:5000",
    "ftp://192.168.1.20",
  ])("APP_URL %s en production : cookie secure", (APP_URL) => {
    expect(sessionCookieFlags({ NODE_ENV: "production", APP_URL }).secure).toBe(true);
  });

  it.each(["http://192.168.1.20:5000", "HTTP://10.0.0.5:5000", "http://localhost:5000"])(
    "APP_URL %s en production : cookie non secure, sameSite lax",
    (APP_URL) => {
      expect(sessionCookieFlags({ NODE_ENV: "production", APP_URL })).toEqual({ secure: false, sameSite: "lax" });
    },
  );
});
