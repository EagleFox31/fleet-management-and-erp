/**
 * IndexedDB factice pour les tests du stockage hors ligne : énumère les bases du faux `idb-keyval`
 * (une Map par base) et accepte leur suppression. Sans lui, la purge (`indexedDB.databases()`,
 * `deleteDatabase`) lève « indexedDB is not defined » et le bruit part sur stderr.
 * Usage : `vi.stubGlobal("indexedDB", fakeIndexedDb(idb.dbs))` dans le `beforeEach`.
 */
export function fakeIndexedDb(dbs: Map<string, unknown>) {
  return {
    databases: async () => Array.from(dbs.keys()).map((name) => ({ name })),
    deleteDatabase: (name: string) => {
      dbs.delete(name);
      const request: { onsuccess?: () => void } = {};
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}
