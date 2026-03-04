const DB_NAME = "ocd_runtime_cache_v1";
const STORE_NAME = "runtime";
const DB_VERSION = 1;

const canUseIndexedDb = () => typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

const openDb = () =>
  new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
  });

const buildKey = (scope, workspaceId) => `${scope || "unknown"}::${workspaceId || ""}`;

const runStoreRequest = (mode, id, payload = null) =>
  new Promise(async (resolve, reject) => {
    const db = await openDb();
    if (!db) {
      resolve(null);
      return;
    }
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let request;
    if (mode === "get") {
      request = store.get(id);
    } else if (mode === "delete") {
      request = store.delete(id);
    } else {
      request = store.put({
        id,
        updatedAt: Date.now(),
        payload
      });
    }
    request.onsuccess = () => {
      if (mode === "get") {
        resolve(request.result?.payload || null);
      } else {
        resolve(true);
      }
    };
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });

export const loadRuntimeFromIndexedDb = async (scope, workspaceId) => {
  const id = buildKey(scope, workspaceId);
  if (!workspaceId) return null;
  try {
    return await runStoreRequest("get", id);
  } catch (_error) {
    return null;
  }
};

export const saveRuntimeToIndexedDb = async (scope, workspaceId, payload) => {
  const id = buildKey(scope, workspaceId);
  if (!workspaceId || !payload) return false;
  try {
    await runStoreRequest("put", id, payload);
    return true;
  } catch (_error) {
    return false;
  }
};

export const clearRuntimeFromIndexedDb = async (scope, workspaceId) => {
  const id = buildKey(scope, workspaceId);
  if (!workspaceId) return false;
  try {
    await runStoreRequest("delete", id);
    return true;
  } catch (_error) {
    return false;
  }
};
