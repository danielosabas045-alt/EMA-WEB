'use strict';

// This page runs once at the old file URL and once at the new local HTTPS origin.
// Only the embedded migration page receives the bridge. No data leaves the device.
(async () => {
  const bridge = window.EMAMigration;
  const keys = ['ema_web_12_v3', 'ema_web_12_v2', 'ema_web_12_v1', 'ema_web_robust_v1'];
  const chunkSize = 65536;
  function openStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('ema_mayoreo_db', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('app');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Base local ocupada'));
    });
  }
  function readStore(db) {
    return new Promise((resolve, reject) => {
      const request = db.transaction('app').objectStore('app').get('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function storeIfEmpty(db, state) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('app', 'readwrite');
      const store = transaction.objectStore('app');
      const read = store.get('state');
      read.onsuccess = () => {
        if (read.result === undefined) store.put(state, 'state');
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  try {
    const db = await openStore();
    if (location.protocol === 'file:') {
      let local;
      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (raw) { local = JSON.parse(raw); break; }
      }
      const indexed = await readStore(db);
      db.close();
      // Match the view that users saw in v1.4 when its two copies diverged.
      const state = !local || (indexed?.quotes?.length || 0) > (local.quotes?.length || 0) ? indexed : local;
      if (state && !Array.isArray(state.quotes)) throw new Error('Respaldo local inválido');
      if (state) {
        const text = JSON.stringify(state);
        for (let offset = 0; offset < text.length; offset += chunkSize) {
          bridge.append(text.slice(offset, offset + chunkSize));
        }
      }
      bridge.transfer();
    } else {
      const count = bridge.count();
      if (count) {
        const chunks = Array.from({length: count}, (_, i) => bridge.chunk(i));
        await storeIfEmpty(db, JSON.parse(chunks.join('')));
      }
      db.close();
      bridge.complete();
    }
  } catch (_) {
    bridge.failed();
  }
})();
