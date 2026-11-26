'use strict';

// Native actions use the same operations as the page. User documents stay on device.
window.EMAAndroid = {
  home: () => setTab('resumen'),
  newOrder: () => editOrder(),
  history: () => setTab('historial'),
  openImport: () => document.getElementById('fileInput').click(),
  customers: () => openCatalog('cliente'),
  sellers: () => openCatalog('vendedor'),
  print: () => document.getElementById('btnPrint').click(),
  async reload() {
    if (document.querySelector('dialog[open]') || cancelImport) return;
    await saveQueue;
    if (storeConflict || $('systemStatusText').dataset.state === 'error') return;
    location.reload();
  },
  save(blob, filename) {
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = String(reader.result);
      window.AndroidBridge.saveBase64(filename, blob.type || 'application/octet-stream',
        encoded.slice(encoded.indexOf(',') + 1));
    };
    reader.onerror = () => toast('No se pudo leer el documento para guardarlo.', 'err');
    reader.readAsDataURL(blob);
  }
};
