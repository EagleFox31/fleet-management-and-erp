import net from "net";

/** Barre oblique inverse, construite pour rester lisible dans les chemins de test. */
export const BACKSLASH = String.fromCharCode(92);

export type RawResponse = { status: number; body: string };
export type RawRequestOptions = { body?: unknown; headers?: Record<string, string> };

/**
 * Envoie `method target` tel quel sur la ligne de requete, par socket brut, et renvoie statut et corps.
 * `http.request` et `fetch` normalisent ou refusent certaines cibles (`\`, `#`, forme absolue) :
 * seule une socket montre ce qu'un client hostile peut reellement envoyer au serveur.
 */
export function sendRawResponse(port: number, method: string, target: string, options: RawRequestOptions = {}): Promise<RawResponse> {
  const payload = options.body === undefined ? "" : JSON.stringify(options.body);
  const headers: Record<string, string> = {
    Host: "localhost",
    Connection: "close",
    "Content-Length": String(Buffer.byteLength(payload)),
    ...(payload ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  };
  const head = [`${method} ${target} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join("\r\n");
  return new Promise((resolve, reject) => {
    let response = "";
    // `write` et non `end` : une demi-fermeture peut couper la reponse avant son envoi.
    const socket = net.connect(port, "127.0.0.1", () => socket.write(`${head}\r\n\r\n${payload}`));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    socket.on("error", reject);
    socket.on("close", () => {
      const status = /^HTTP\/1\.[01] (\d{3})/.exec(response);
      if (!status) return reject(new Error(`Reponse HTTP illisible pour ${method} ${target}`));
      const separator = response.indexOf("\r\n\r\n");
      resolve({ status: Number(status[1]), body: separator === -1 ? "" : response.slice(separator + 4) });
    });
  });
}

/** Statut seul de `sendRawResponse`. */
export async function sendRaw(port: number, method: string, target: string, options: RawRequestOptions = {}): Promise<number> {
  return (await sendRawResponse(port, method, target, options)).status;
}
