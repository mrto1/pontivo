/** Lokaler Speicher der Offline-Kasse (IndexedDB), je Betrieb eine Datenbank. Nur im Browser. */
export type Store = {
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  put(store: string, value: unknown, key?: IDBValidKey): Promise<void>;
  del(store: string, key: IDBValidKey): Promise<void>;
  all<T>(store: string): Promise<T[]>;
  clear(store: string): Promise<void>;
  /** Inhalt eines Speichers in einem Schritt ersetzen (alles oder nichts) */
  replace(store: string, values: unknown[]): Promise<void>;
};

const STORES = ["kv", "orders", "queue", "rejected"] as const;

export function openStore(hotelId: string): Promise<Store> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`pontivo-kasse-${hotelId}`, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("kv");
      db.createObjectStore("orders", { keyPath: "id" });
      db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("rejected", { keyPath: "id" });
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = <T,>(name: (typeof STORES)[number], mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) =>
        new Promise<T>((res, rej) => { const r = f(db.transaction(name, mode).objectStore(name)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      resolve({
        get: (s, k) => tx(s as never, "readonly", (o) => o.get(k)),
        put: async (s, v, k) => { await tx(s as never, "readwrite", (o) => o.put(v, k)); },
        del: async (s, k) => { await tx(s as never, "readwrite", (o) => o.delete(k)); },
        all: (s) => tx(s as never, "readonly", (o) => o.getAll()),
        clear: async (s) => { await tx(s as never, "readwrite", (o) => o.clear()); },
        replace: (s, values) => new Promise<void>((res, rej) => {
          const t = db.transaction(s, "readwrite");
          const o = t.objectStore(s);
          o.clear();
          for (const v of values) o.put(v);
          t.oncomplete = () => res();
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error);
        }),
      });
    };
  });
}
