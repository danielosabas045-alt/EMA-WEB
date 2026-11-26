'use strict';
/* =========================================================
   EMA MAYOREO ELECTRÓNICO · Aplicación principal (v12.4)
========================================================= */
const STORAGE_KEY = 'ema_web_12_v3';
const DB_NAME = 'ema_mayoreo_db';
const DB_VERSION = 1;
const DB_STORE = 'app';
const COMPANY_ADDRESS = 'Ciudad de Guatemala, Guatemala';
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const ACCEPTED_EXT = /\.(xls|xlsx|xlsm|xlsb|json|csv|html|htm)$/i;

// Icono de impresora inline (autocontenido, no depende de sprite)
const PRINT_ICON =
  '<svg class="ico" width="16" height="16" aria-hidden="true" focusable="false" ' +
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="6 9 6 2 18 2 18 9"/>' +
  '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>' +
  '<rect x="6" y="14" width="12" height="8"/></svg>';

const state = {
  quotes: [],
  catalog: {}, audit: [],
  importHistory: [],
  meta: { lastFile: '', lastImportedAt: null, reportTotal: 0 }
};

let filtered = [];
let selected = 0;
let pendingImport = null;
let modalAction = null;
let sellerFilterValue = 'todo';
let sellerPreviewIndex = 0;
let toastTimer = null;
let dbPromise = null;

/* =========================================================
   DOM
========================================================= */
const $ = (id) => document.getElementById(id);

function esc(value) {
  return cleanText(value).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])
  );
}

/* =========================================================
   NOTIFICACIONES
========================================================= */
function toast(message, type = '') {
  const element = $('toast');
  if (!element) return;
  clearTimeout(toastTimer);
  element.textContent = message;
  element.className = `toast show${type ? ` ${type}` : ''}`;
  element.hidden = false;
  toastTimer = setTimeout(() => {
    element.className = 'toast';
    element.hidden = true;
  }, 4200);
}

/* =========================================================
   ESTADO DEL SISTEMA
========================================================= */
function setSystemStatus(text, type = 'success') {
  const textElement = $('systemStatusText');
  if (textElement) {
    textElement.textContent = text;
    textElement.dataset.state = type;
  }
}
function setImportStatus(text) {
  const status = $('importStatus');
  if (status) status.textContent = text;
}

/* =========================================================
   MONEDA / NÚMEROS
========================================================= */
function money(value) {
  const number = Number(value);
  return 'Q ' + (Number.isFinite(number) ? number : 0).toLocaleString('es-GT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
function startOfTodayTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* =========================================================
   CÓDIGOS / NOMBRES
========================================================= */
/* =========================================================
   NORMALIZAR QUOTE
========================================================= */
function normalizeQuote(quote) {
  return {
    ...quote,
    numero: cleanText(quote.numero),
    cliente: cleanText(quote.cliente),
    direccion: cleanText(quote.direccion),
    fecha: cleanText(quote.fecha),
    vendedor: cleanText(quote.vendedor),
    sucursal: cleanText(quote.sucursal),
    fechaTs: quote.fechaTs ?? parseDate(quote.fecha),
    items: Array.isArray(quote.items)
      ? quote.items.map((item) => ({
          ...item,
          codigo: cleanText(item.codigo),
          descripcion: cleanText(item.descripcion),
          cantidad: Number(item.cantidad) || 0,
          precio: Number(item.precio) || 0,
          total: Number(item.total) || 0
        }))
      : [],
    monto: Number(quote.monto) || 0
  };
}

/* =========================================================
   INDEXEDDB
========================================================= */
function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) { resolve(null); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}
async function saveIndexedDB(snapshot, previousRevision) {
  const db = await openDatabase();
  if (!db) return 'unavailable';
  return new Promise(resolve => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      const read = store.get('state');
      let conflict = false;
      read.onsuccess = () => {
        if ((read.result?.revision || 0) > previousRevision) { conflict = true; tx.abort(); }
        else store.put(snapshot, 'state');
      };
      tx.oncomplete = () => resolve('saved');
      tx.onabort = tx.onerror = () => resolve(conflict ? 'conflict' : 'unavailable');
    } catch (_) { resolve('unavailable'); }
  });
}
async function loadIndexedDB() {
  const db = await openDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).get('state');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}

/* =========================================================
   STORAGE
========================================================= */
let saveQueue = Promise.resolve();
let storeConflict = false;
function saveState() {
  const previousRevision = state.revision || 0;
  state.revision = Math.max(Date.now(), previousRevision + 1);
  const snapshot = typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
  saveQueue = saveQueue.then(async () => {
    if (!storeConflict) {
      const result = await saveIndexedDB(snapshot, previousRevision);
      storeConflict = result === 'conflict';
      let saved = result === 'saved';
      if (!storeConflict) {
        try {
          const previous = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
          if (!saved && (previous?.revision || 0) > previousRevision) storeConflict = true;
          else if (!previous || (previous.revision || 0) <= snapshot.revision) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            saved = true;
          }
        } catch (_) {}
        if (!storeConflict) {
          setSystemStatus(saved ? 'Guardado en este dispositivo' : 'Sin guardar · descarga un respaldo', saved ? 'success' : 'error');
          if (!saved) toast('Almacenamiento lleno o bloqueado. Descargá un respaldo antes de cerrar.', 'err');
          return;
        }
      }
    }
    setSystemStatus('Cambios sin guardar en esta pestaña', 'error');
    toast('Otra pestaña guardó cambios. Respaldá esta sesión desde Actividad y recargá.', 'err');
  });
  document.dispatchEvent(new Event('ema-change'));
}
function applyState(value) {
  if (!value) return false;
  state.catalog = validCatalog(value.catalog);
  state.audit = Array.isArray(value.audit) ? value.audit.slice(0, 120) : [];
  if (Array.isArray(value.quotes)) state.quotes = value.quotes.map(normalizeQuote);
  if (Array.isArray(value.importHistory)) {
    state.importHistory = value.importHistory.map((entry) => ({
      id: cleanText(entry.id) || `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      fileName: cleanText(entry.fileName),
      importedAt: Number(entry.importedAt) || Date.now(),
      mode: entry.mode === 'append' ? 'append' : 'replace',
      count: Number(entry.count) || 0,
      total: Number(entry.total) || 0,
      preview: Array.isArray(entry.preview) ? entry.preview.map(normalizeQuote) : []
    }));
  } else {
    state.importHistory = [];
  }
  state.meta = { lastFile: '', lastImportedAt: null, reportTotal: 0, ...value.meta };
  return true;
}
async function loadState() {
  let local;
  for (const key of [STORAGE_KEY, 'ema_web_12_v2', 'ema_web_12_v1', 'ema_web_robust_v1']) {
    try { const raw = localStorage.getItem(key); if (raw) { local = JSON.parse(raw); break; } } catch (_) {}
  }
  const indexed = await loadIndexedDB();
  const saved = indexed && (!local || (indexed.revision || 0) > (local.revision || 0)) ? indexed : local;
  if (saved) { applyState(saved); state.revision = Number(saved.revision) || 0; }
}
/* =========================================================
   IMPORTACIÓN / HISTORIAL DE CARGAS
========================================================= */
function pushImportHistory(quotes, reportTotal, fileName, mode) {
  const normalized = quotes.map(normalizeQuote);
  const total = normalized.reduce((sum, q) => sum + Number(q.monto || 0), 0);
  state.importHistory = Array.isArray(state.importHistory) ? state.importHistory : [];
  state.importHistory.unshift({
    id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    fileName: fileName || normalized[0]?.archivo || 'Archivo sin nombre',
    importedAt: Date.now(),
    mode: mode === 'append' ? 'append' : 'replace',
    count: normalized.length,
    total: Number(reportTotal) > 0 ? Number(reportTotal) : total,
    // Se conserva una muestra suficiente para consultar la carga sin inflar el almacenamiento.
    preview: normalized.slice(0, 200)
  });
  state.importHistory = state.importHistory.slice(0, 20);
}

function finalizeImported(quotes, reportTotal, fileName, mode) {
  const normalized = quotes.map(quote => {
    const q = normalizeQuote(quote);
    q.id ||= 'q_' + crypto.randomUUID();
    q.createdAt ||= Date.now();
    return q;
  });

  if (mode === 'append') {
    const map = new Map(state.quotes.map(q => [q.numero, q]));
    normalized.forEach((quote) => {
      if (!quote.numero) return;
      const existing = map.get(quote.numero);
      map.set(quote.numero, {
        ...(existing || {}),
        ...quote,
        id: existing?.id || quote.id,
        createdAt: existing?.createdAt || quote.createdAt
      });
    });
    state.quotes = [...map.values()];
  } else {
    state.quotes = normalized.filter((q) => q.numero);
  }

  state.meta.lastFile = fileName || normalized[0]?.archivo || '';
  state.meta.lastImportedAt = Date.now();
  state.meta.reportTotal = Number(reportTotal) || normalized.reduce((sum, q) => sum + Number(q.monto || 0), 0);
  pushImportHistory(normalized, reportTotal, fileName, mode);
  saveState();
  selected = 0;
  sellerFilterValue = 'todo';
  populateSellers();
  renderHistory();
  renderImportHistory();
  renderQuote();
}

function replaceImported(quotes, reportTotal, fileName) {
  finalizeImported(quotes, reportTotal, fileName, 'replace');
}

function mergeImported(quotes, reportTotal, fileName) {
  finalizeImported(quotes, reportTotal, fileName, 'append');
}

function renderImportHistory() {
  const entries = Array.isArray(state.importHistory) ? state.importHistory : [];
  const body = $('importHistoryBody');
  const empty = $('importHistoryEmpty');
  const count = $('importHistoryCount');
  if (!body || !empty || !count) return;
  count.textContent = `${entries.length} ${entries.length === 1 ? 'carga' : 'cargas'}`;
  empty.hidden = entries.length > 0;
  body.innerHTML = entries.map((entry) => `
    <tr>
      <td>${esc(new Date(entry.importedAt).toLocaleString('es-GT'))}</td>
      <td><b>${esc(entry.fileName || '—')}</b></td>
      <td><span class="import-mode ${entry.mode === 'append' ? 'append' : 'replace'}">${entry.mode === 'append' ? 'Agregado' : 'Reemplazado'}</span></td>
      <td>${entry.count.toLocaleString('es-GT')}</td>
      <td>${esc(money(entry.total))}</td>
      <td><button type="button" class="btn small secondary" data-import-act="view" data-id="${esc(entry.id)}">Ver</button></td>
    </tr>
  `).join('');
}

function openImportHistoryPreview(id) {
  const entry = state.importHistory.find((item) => item.id === id);
  if (!entry) return;
  $('importHistoryPreviewTitle').textContent = entry.fileName || 'Detalle de la carga';
  $('importHistoryPreviewInfo').innerHTML = [
    ['Fecha', new Date(entry.importedAt).toLocaleString('es-GT')],
    ['Modo', entry.mode === 'append' ? 'Agregado a la base' : 'Reemplazó la base'],
    ['Pedidos', entry.count],
    ['Total', money(entry.total)],
    ['Muestra', `Primeros ${Math.min(entry.preview.length, 200)} pedidos`]
  ].map(([label, value]) => `<div class="preview-chip"><b>${esc(label)}</b><span>${esc(value)}</span></div>`).join('');
  $('importHistoryPreviewTable').innerHTML = `
    <table>
      <thead><tr><th>N. pedido</th><th>Cliente</th><th>Dirección</th><th>Vendedor</th><th>Total</th></tr></thead>
      <tbody>
        ${entry.preview.map((q) => `<tr>
          <td>${esc(q.numero)}</td><td>${esc(q.cliente || '—')}</td><td>${esc(q.direccion || '—')}</td><td>${esc(q.vendedor || '—')}</td><td>${esc(money(q.monto))}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  openPreview('importHistoryPreviewBg');
  $('importHistoryPreviewClose').focus();
}
function closeImportHistoryPreview() {
  dismissPreview('importHistoryPreviewBg');
}

/* =========================================================
   VISTA PREVIA IMPORTACIÓN
========================================================= */
function renderPreview(result) {
  const {quotes, reportTotal, issues} = result;
  const detectedTotal = sum(quotes);
  const ids = new Set(state.quotes.map(q => q.numero));
  const incoming = new Set(quotes.map(q => q.numero));
  const duplicates = quotes.filter(q => ids.has(q.numero)).length;
  const removed = state.quotes.filter(q => !incoming.has(q.numero)).length;
  const values = [
    ['Nuevos', quotes.length - duplicates],
    ['Existentes', duplicates],
    ['Filas con errores o avisos', issues.length],
    ['Total a cargar', money(detectedTotal)]
  ];
  const discrepancy = reportTotal > 0 && Math.abs(reportTotal - detectedTotal) > .01
    ? ' Total declarado en el archivo: ' + money(reportTotal) + '.' : '';
  $('validation').textContent = 'Agregar incorpora los nuevos y actualiza los números existentes. Reemplazar deja solo los pedidos del archivo'
    + (removed ? ' y quita ' + removed + ' de la base local.' : '.') + discrepancy;
  $('issueReport').hidden = !issues.length;
  $('issueReport').onclick = () => downloadBlob(new Blob([issues.join('\n')], {type:'text/plain;charset=utf-8'}), 'EMA-observaciones.txt');
  $('previewInfo').innerHTML = values.map(([label, value]) => `
    <div class="preview-chip"><b>${esc(label)}</b><span>${esc(value)}</span></div>
  `).join('');
  $('previewTable').innerHTML = `
    <table>
      <thead><tr>
        <th>N. pedido</th><th>Cliente</th><th>Dirección</th>
        <th>Vendedor</th><th>Líneas</th><th>Total</th>
      </tr></thead>
      <tbody>
        ${quotes.slice(0, 120).map((q) => `
          <tr>
            <td>${esc(q.numero)}</td>
            <td>${esc(q.cliente || '—')}</td>
            <td>${esc(q.direccion || '—')}</td>
            <td>${esc(q.vendedor || '—')}</td>
            <td>${q.items.length}</td>
            <td>${esc(money(q.monto))}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  $('previewNote').textContent = quotes.length > 120
    ? `Se detectaron ${quotes.length} pedidos. Se muestran los primeros 120 en esta revisión.`
    : 'Los pedidos no se guardan hasta confirmar.';
}
function closeImportPreview() {
  dismissPreview('previewBg');
  pendingImport = null;
}

/* =========================================================
   FILTROS
========================================================= */
function applyFilters() {
  const search = searchTerms($('search').value);
  const sort = $('sort')?.value || 'fecha_desc';
  const date = $('dateFilter')?.value || 'todo';
  const seller = sellerFilterValue || 'todo';
  const now = Date.now();
  const day = 86400000;
  const todayTs = startOfTodayTs();

  filtered = state.quotes.filter((quote) => {
    if (seller !== 'todo' && quote.vendedor !== seller) return false;
    if (date !== 'todo') {
      if (!quote.fechaTs) return false;
      if (date === 'hoy') {
        if (quote.fechaTs < todayTs || quote.fechaTs >= todayTs + day) return false;
      } else {
        const age = now - quote.fechaTs;
        const windowDays = date === 'semana' ? 7 : 30;
        if (age < 0 || age > windowDays * day) return false;
      }
    }
    return !search.length || matchesOrder(quote, search);
  });

  filtered.sort((a, b) => {
    switch (sort) {
      case 'fecha_asc': return (a.fechaTs || 0) - (b.fechaTs || 0);
      case 'num_asc': return textOrder(a.numero,b.numero);
      case 'num_desc': return textOrder(b.numero,a.numero);
      case 'cli_asc': return String(a.cliente).localeCompare(String(b.cliente), 'es');
      case 'monto_desc': return Number(b.monto || 0) - Number(a.monto || 0);
      case 'monto_asc': return Number(a.monto || 0) - Number(b.monto || 0);
      default: return (b.fechaTs || 0) - (a.fechaTs || 0);
    }
  });

  if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);
}

/* =========================================================
   VENDEDORES
========================================================= */
function populateSellers() {
  const sellers = [...new Set(
    state.quotes.map((q) => cleanText(q.vendedor)).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  const options = `
    <option value="todo">Todos</option>
    ${sellers.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
  `;
  ['sellerFilter', 'quoteSellerFilter'].forEach((id) => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = options;
    select.value = sellers.includes(sellerFilterValue) ? sellerFilterValue : 'todo';
  });
  if (!sellers.includes(sellerFilterValue)) sellerFilterValue = 'todo';
}
function getSellerStats() {
  const seller = sellerFilterValue || 'todo';
  const list = filtered;
  const total = sum(list);
  const average = list.length ? total / list.length : 0;
  return { seller, list, total, average, current: filtered[selected] || null };
}
function renderSellerDashboard() {
  const stats = getSellerStats();
  const title = $('seller-dashboard-heading');
  const subtitle = $('sellerSubtitle');
  if (title) title.textContent = stats.seller === 'todo' ? 'Todos los vendedores' : stats.seller;
  if (subtitle) {
    subtitle.textContent = stats.seller === 'todo'
      ? 'Pedidos de la selección actual.'
      : `${stats.list.length} pedido(s) atribuido(s) a este vendedor.`;
  }
  $('sellerOrders').textContent = stats.list.length.toLocaleString('es-GT');
  $('sellerSales').textContent = money(stats.total);
  $('sellerAverage').textContent = money(stats.average);
  $('sellerCurrent').textContent = money(stats.current?.monto || 0);
  // innerHTML para conservar el icono (textContent lo borraría)
  $('btnPrintAll').innerHTML = stats.seller === 'todo'
    ? `${PRINT_ICON} Imprimir todos`
    : `${PRINT_ICON} Imprimir vendedor`;
}

/* =========================================================
   FACTURA
========================================================= */
function formatItemRows(quote) {
  return quote.items.map((item) => `
    <tr>
      <td>
        ${esc(item.descripcion || '—')}
      </td>
      <td class="num">${Number(item.cantidad || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}</td>
      <td class="num">${money(item.precio)}</td>
      <td class="num">${money(item.total)}</td>
    </tr>`).join('');
}
function invoice(quote) {
  if (!quote) return '';
  return `
    <article class="invoice">
      <header class="inv-head">
        <div class="company">MAYOREO ELECTRÓNICO, S.A.</div>
        <div class="address">${esc(COMPANY_ADDRESS)}</div>
        <div class="title">PEDIDO</div>
      </header>
      <table class="meta"><tbody>
        <tr>
          <th>N. DE COTIZACIÓN:</th><td><b>${esc(quote.numero)}</b></td>
          <th>FECHA:</th><td>${esc(quote.fecha || '—')}</td>
        </tr>
        <tr><th>CLIENTE:</th><td colspan="3">${esc(quote.cliente || '—')}</td></tr>
        <tr><th>DIRECCIÓN:</th><td colspan="3">${esc(quote.direccion || '—')}</td></tr>
        <tr><th>VENDEDOR:</th><td colspan="3">${esc(quote.vendedor || '—')}</td></tr>
      </tbody></table>
      <table class="items">
        <thead><tr>
          <th>DESCRIPCIÓN</th>
          <th class="num">CANTIDAD</th>
          <th class="num">PRECIO UNITARIO</th>
          <th class="num">TOTAL</th>
        </tr></thead>
        <tbody>${formatItemRows(quote)}</tbody>
      </table>
      <table class="total"><tbody>
        <tr>
          <td class="label">TOTAL DEL PEDIDO</td>
          <td class="value">${money(quote.monto)}</td>
        </tr>
      </tbody></table>
      <div class="inv-footer">Gracias por su preferencia.</div>
      <div class="inv-cond">Precios en Quetzales. Documento generado por Sistema EMA.</div>
    </article>`;
}

/* =========================================================
   RENDER PEDIDOS
========================================================= */
function currentQuote() {
  applyFilters();
  return filtered[selected] || null;
}
function renderQuote() {
  applyFilters();
  renderSellerDashboard();
  const quote = filtered[selected] || null;

  $('position').textContent = quote ? `${selected + 1} de ${filtered.length}` : '0 de 0';
  $('positionHint').textContent = quote
    ? `${quote.cliente || 'Cliente sin nombre'} · ${money(quote.monto)}`
    : 'Creá o importá un pedido para empezar.';
  $('emptyState').hidden = Boolean(quote);
  $('invoiceWrap').innerHTML = quote ? invoice(quote) : '';
  $('orderToolbar').hidden = $('sellerDashboard').hidden = !quote;
  const jump = $('quoteJump');
  const windowed = filtered.length > 200;
  const start = windowed ? Math.max(0, selected - 25) : 0;
  $('jumpLabel').textContent = windowed ? 'Pedidos cercanos' : 'Ir al pedido';
  jump.replaceChildren(...filtered.slice(start, windowed ? selected + 26 : undefined).map((item, index) =>
    new Option(`${item.numero} · ${item.cliente || 'Sin cliente'}`, String(start + index))));
  if (quote) jump.value = String(selected);

  $('btnFirst').disabled = !quote || selected <= 0;
  $('btnPrev').disabled = !quote || selected <= 0;
  $('btnNext').disabled = !quote || selected >= filtered.length - 1;
  $('btnLast').disabled = !quote || selected >= filtered.length - 1;
}

/* =========================================================
   HISTORIAL
========================================================= */
let historyPage = 0;
function renderHistory() {
  populateSellers();
  applyFilters();
  renderSellerDashboard();

  const total = state.quotes.reduce((sum, q) => sum + Number(q.monto || 0), 0);

  $('counter').textContent = `Mostrando ${filtered.length} de ${state.quotes.length} pedidos`;
  $('statCount').textContent = `${state.quotes.length} pedidos`;
  $('statMonto').textContent = money(total);
  $('historyEmpty').hidden = filtered.length > 0;

  historyPage = Math.min(historyPage, Math.max(0, Math.ceil(filtered.length / 50) - 1));
  $('pagePrev').disabled = historyPage === 0;
  $('pageNext').disabled = (historyPage + 1) * 50 >= filtered.length;
  $('pageNumber').textContent = 'Página ' + (historyPage+1) + ' de ' + Math.max(1,Math.ceil(filtered.length/50));
  $('historyBody').innerHTML = filtered.slice(historyPage * 50, (historyPage+1)*50).map((quote) => `
    <tr>
      <td><b>${esc(quote.numero)}</b></td>
      <td>${esc(quote.fecha || '—')}</td>
      <td>${esc(quote.cliente || '—')}</td>
      <td>${esc(quote.sucursal || '—')}</td>
      <td>${esc(quote.vendedor || '—')}</td>
      <td class="money">${esc(money(quote.monto))}</td>
      <td><div class="actions">
        <button type="button" class="btn small secondary" data-act="view" data-id="${esc(quote.id)}">Ver</button>
        <button type="button" class="btn small secondary" data-act="edit" data-id="${esc(quote.id)}">Editar</button>
        <button type="button" class="btn small danger" data-act="del" data-id="${esc(quote.id)}">Eliminar</button>
      </div></td>
    </tr>`).join('');

  $('lastFile').textContent = state.meta.lastFile || 'Ninguno';
  $('lastFileMeta').textContent = state.meta.lastImportedAt
    ? `Importado ${new Date(state.meta.lastImportedAt).toLocaleString('es-GT')}`
    : 'Importa un pedido para verlo aquí.';
}

/* =========================================================
   TABS / NAVEGACIÓN
========================================================= */
function setTab(tab) {
  document.querySelectorAll('.tab').forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const changed = document.body.dataset.view !== tab;
  document.body.dataset.view = tab;
  closeMobileMenu();
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.hidden = panel.id !== `tab-${tab}`;
  });
  renderEnterprise(tab);
  if (changed) window.scrollTo(0, 0);
}
function goToQuote(index) {
  applyFilters();
  if (!filtered.length) { selected = 0; renderQuote(); return; }
  selected = Math.max(0, Math.min(filtered.length - 1, index));
  renderQuote();
}

/* =========================================================
   IMPORTACIÓN
========================================================= */
async function handleFile(file) {
  if (!file) return;
  if (document.body.dataset.view !== 'pedidos') setTab('pedidos');
  $('readError').hidden = true;
  const name = String(file.name || '').toLowerCase();
  if (!ACCEPTED_EXT.test(name)) {
    setImportStatus('Formato no compatible');
    toast('Usá XLS, XLSX, XLSM, XLSB, JSON, CSV, HTML o HTM.', 'err');
    return;
  }
  if (!file.size || file.size > MAX_FILE_SIZE) {
    const message = file.size ? 'El archivo supera el límite de 20 MiB.' : 'El archivo está vacío.';
    setImportStatus(message);
    toast(message, 'err');
    return;
  }
  try {
    setImportStatus(`Leyendo ${file.name}...`);
    toast(`Leyendo ${file.name}...`);
    const result = await enterpriseImport(file);
    pendingImport = { ...result, fileName: file.name };
    renderPreview(result);
    openPreview('previewBg');
    $('previewCancel').focus();
    setImportStatus(`${result.quotes.length} pedido(s) detectado(s)`);
    toast(`Se encontraron ${result.quotes.length} pedidos.`, 'ok');
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('issueReport').hidden = false;
    const detail = error?.message || 'Error de lectura';
    $('issueReport').onclick = () => downloadBlob(new Blob([detail], {type:'text/plain'}),'EMA-error.txt');
    pendingImport = null;
    setImportStatus(detail);
    $('readError').hidden=false;
    $('readError').onclick=$('issueReport').onclick;
    toast(`No se pudo leer el archivo: ${error?.message || 'Error desconocido'}`, 'err');
  }
}

/* =========================================================
   MODAL CONFIRMACIÓN
========================================================= */
function openPreview(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
  dialog.classList.add('open');
}
function dismissPreview(id) {
  $(id).close();
  $(id).classList.remove('open');
}
function openModal(title, body, action) {
  modalAction = action;
  $('modalTitle').textContent = title;
  $('modalBody').textContent = body;
  openPreview('modalBg');
  $('modalCancel').focus();
}
function closeModal() {
  dismissPreview('modalBg');
  modalAction = null;
}

/* =========================================================
   PREVIEW FACTURA
========================================================= */
function openInvoicePreview(quote) {
  if (!quote) { toast('No hay pedido seleccionado.', 'err'); return; }
  $('invoicePreviewPrint').onclick = () => actionSafe(() => printHtml([quote], 'Pedido ' + quote.numero), 'Impresión');
  $('invoicePreviewTitle').textContent = `Pedido ${quote.numero} · ${quote.cliente || 'Sin cliente'}`;
  $('invoicePreviewFrame').innerHTML = invoice(quote);
  openPreview('invoicePreviewBg');
  $('invoicePreviewClose').focus();
}
function closeInvoicePreview() {
  dismissPreview('invoicePreviewBg');
}

/* =========================================================
   PREVIEW VENDEDOR
========================================================= */
function sellerList() {
  return filtered;
}
function renderSellerPreview() {
  const list = sellerList();
  if (!list.length) {
    $('sellerPreviewTitle').textContent = 'Sin pedidos';
    $('sellerPreviewPosition').textContent = '0 de 0';
    $('sellerPreviewFrame').innerHTML = `
      <div class="empty small-empty">
        <h3>No hay pedidos para mostrar</h3>
        <p>Selecciona un vendedor con pedidos registrados.</p>
      </div>`;
    $('sellerPreviewPrev').disabled = true;
    $('sellerPreviewNext').disabled = true;
    return;
  }
  sellerPreviewIndex = Math.max(0, Math.min(list.length - 1, sellerPreviewIndex));
  const quote = list[sellerPreviewIndex];
  const title = sellerFilterValue === 'todo' ? 'Todos los vendedores' : sellerFilterValue;
  $('sellerPreviewTitle').textContent = `${title} · ${quote.numero}`;
  $('sellerPreviewPosition').textContent = `${sellerPreviewIndex + 1} de ${list.length}`;
  $('sellerPreviewFrame').innerHTML = invoice(quote);
  $('sellerPreviewPrev').disabled = sellerPreviewIndex <= 0;
  $('sellerPreviewNext').disabled = sellerPreviewIndex >= list.length - 1;
}
function openSellerPreview() {
  sellerPreviewIndex = 0;
  renderSellerPreview();
  openPreview('sellerPreviewBg');
  $('sellerPreviewClose').focus();
}
function closeSellerPreview() {
  dismissPreview('sellerPreviewBg');
}

/* =========================================================
   IMPRESIÓN
========================================================= */
function printHtml(quotes, title = 'EMA · Pedidos') {
  if (!quotes || !quotes.length) { toast('No hay pedidos para imprimir.', 'err'); return; }
  const documentHtml = `<!doctype html>
<html lang="es-GT">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { size: auto; margin: 0.12in; }
  * { box-sizing: border-box; }
  html, body { width: 100%; margin: 0; padding: 0; background: #fff; color: #111; font-family: Arial, Helvetica, sans-serif; }
  .page { width: 100%; min-height: 0; margin: 0 auto; padding: 0; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .invoice { position: relative; isolation: isolate; width: 100%; height: auto; min-height: 0; margin: 0 auto; border: 1px solid #111; background: #fff; padding: 0.14in; }
  .invoice::before { content: ""; position: absolute; inset: 4px; z-index: -1; border: 1px solid #d7d7d7; pointer-events: none; }
  .inv-head { text-align: center; border-bottom: 2px solid #111; padding: 0.03in 0.03in 0.09in; }
  .company { font-size: 15px; font-weight: 900; letter-spacing: .07em; }
  .address { margin-top: 3px; font-size: 8px; }
  .title { margin-top: 4px; font-size: 9px; font-weight: 900; letter-spacing: .18em; }
  .invoice table { width: 100%; border-collapse: collapse; }
  .meta { margin-top: 8px; }
  .meta th, .meta td { border: 1px solid #444; padding: 5px; font-size: 7.5px; vertical-align: top; }
  .meta th { background: #fff; text-align: left; font-weight: 900; white-space: nowrap; }
  .items { margin-top: 8px; }
  .items th, .items td { padding: 5px; font-size: 7.5px; vertical-align: top; }
  .items thead tr { border-top: 2px solid #111; border-bottom: 2px solid #111; }
  .items tbody tr { border-bottom: 1px solid #777; }
  .items th { background: #fff; font-weight: 900; }
  .items td { border-left: 1px solid #555; border-right: 1px solid #555; word-break: break-word; }
  .items th.num, .items td.num { text-align: right; white-space: nowrap; }
  .cod { display: block; margin-top: 2px; color: #555; font-size: 6.5px; }
  .total { margin-top: 5px; }
  .total td { padding: 6px; border-top: 2px solid #111; border-bottom: 2px solid #111; font-weight: 900; }
  .total .label { width: 72%; background: #fff; color: #111; text-align: right; }
  .total .value { background: #fff; color: #111; text-align: right; white-space: nowrap; }
  .inv-footer { margin-top: 8px; text-align: center; color: #222; font-size: 8px; font-style: italic; }
  .inv-cond { margin-top: 5px; padding-top: 4px; border-top: 1px dashed #777; text-align: center; color: #555; font-size: 6.5px; }
</style>
</head>
<body>
  ${quotes.map((q) => `<div class="page">${invoice(q)}</div>`).join('')}
</body>
</html>`;

  if (window.AndroidBridge) { window.AndroidBridge.printHtml(documentHtml); return; }
  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) {
    toast('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para EMA.', 'err');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(documentHtml);
  printWindow.document.close();

  let printing = false;
  const triggerPrint = () => {
    if (printing) return;
    printing = true;
    try { printWindow.focus(); } catch (_) {}
    try { printWindow.print(); } catch (_) {}
  };
  printWindow.onload = triggerPrint;
  setTimeout(triggerPrint, 400); // fallback por si onload no dispara
  printWindow.onafterprint = () => { try { printWindow.close(); } catch (_) {} };
}

/* =========================================================
   WORD / PDF / DESCARGAS
========================================================= */
function exportWord(quote) {
  if (!quote) throw new Error('No hay pedido seleccionado.');
  const html = `<!doctype html>
<html lang="es-GT">
<head><meta charset="utf-8"><title>Pedido ${esc(quote.numero)}</title></head>
<body>${invoice(quote)}</body>
</html>`;
  downloadBlob(new Blob([html], { type: 'application/msword' }), `Pedido_${quote.numero}.doc`);
  toast('Word generado correctamente.', 'ok');
}
function exportPdf(quote) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('La librería PDF no está disponible.');
  if (!quote) throw new Error('No hay pedido seleccionado.');
  const { jsPDF } = window.jspdf;
  const width = 396, height = 612, margin = 24;
  const contentWidth = width - margin * 2;
  const doc = new jsPDF({ unit: 'pt', format: [width, height], compress: true });
  let y = 28;

  function drawHeader(continuation = false) {
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(20, 20, 20);
    doc.setLineWidth(1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('MAYOREO ELECTRÓNICO, S.A.', width / 2, y, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(COMPANY_ADDRESS, width / 2, y + 12, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(
      continuation ? `PEDIDO ${quote.numero} · CONTINUACIÓN` : 'PEDIDO',
      width / 2, y + 25, { align: 'center' }
    );
    doc.line(margin, y + 32, width - margin, y + 32);
    y += 46;
  }
  drawHeader();

  const metadata = [
    ['N. DE COTIZACIÓN', quote.numero],
    ['FECHA', quote.fecha || '—'],
    ['CLIENTE', quote.cliente || '—'],
    ['DIRECCIÓN', quote.direccion || '—'],
    ['VENDEDOR', quote.vendedor || '—']
  ];
  for (const [label, value] of metadata) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(label, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), margin + 94, y);
    doc.line(margin, y + 4, width - margin, y + 4);
    y += 18;
  }
  y += 9;

  function drawColumnsHeader() {
    doc.setFillColor(224, 224, 224);
    doc.setTextColor(20, 20, 20);
    doc.rect(margin, y, contentWidth, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.3);
    doc.text('DESCRIPCIÓN', margin + 6, y + 14);
    doc.text('CANT.', 254, y + 14, { align: 'right' });
    doc.text('P. UNIT.', 315, y + 14, { align: 'right' });
    doc.text('TOTAL', 368, y + 14, { align: 'right' });
    y += 29;
  }
  drawColumnsHeader();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  for (const item of quote.items) {
    const description = item.descripcion || '—';
    const lines = doc.splitTextToSize(description, 208);
    const rowHeight = Math.max(22, lines.length * 9 + 8);
    if (y + rowHeight > 545) {
      doc.addPage([width, height]);
      y = 28;
      drawHeader(true);
      drawColumnsHeader();
    }
    doc.setFont('helvetica', 'normal');
    doc.text(lines, margin + 6, y + 10);
    doc.text(Number(item.cantidad || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 }), 254, y + 10, { align: 'right' });
    doc.text(money(item.precio), 315, y + 10, { align: 'right' });
    doc.text(money(item.total), 368, y + 10, { align: 'right' });
    doc.setDrawColor(115, 115, 115);
    doc.line(margin, y + rowHeight, width - margin, y + rowHeight);
    y += rowHeight;
  }

  if (y > 545) { doc.addPage([width, height]); y = 32; }
  doc.setFillColor(17, 17, 17);
  doc.setTextColor(255, 255, 255);
  doc.rect(margin, y + 8, contentWidth, 27, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('TOTAL DEL PEDIDO', 300, y + 25, { align: 'right' });
  doc.text(money(quote.monto), 370, y + 25, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.text('Gracias por su preferencia.', width / 2, 570, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('Precios en Quetzales. Documento generado por Sistema EMA.', width / 2, 585, { align: 'center' });
  downloadBlob(doc.output("blob"), `Pedido_${quote.numero}.pdf`);
  toast('PDF generado correctamente.', 'ok');
}
function downloadBlob(blob, filename) {
  if (window.EMAAndroid?.save) { window.EMAAndroid.save(blob, filename); return; }
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 1000);
}

/* =========================================================
   RESPALDO
========================================================= */
function exportBackup() {
  const payload = {
    version: '12.4',
    createdAt: new Date().toISOString(),
    state: JSON.parse(JSON.stringify(state))
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }),
    'EMA-respaldo.json'
  );
  toast('Respaldo creado correctamente.', 'ok');
}

/* =========================================================
   ACCIÓN SEGURA
========================================================= */
function actionSafe(callback, label) {
  try {
    const result = callback();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        console.error(error);
        toast(`${label}: ${error?.message || 'Error desconocido'}`, 'err');
      });
    }
  } catch (error) {
    console.error(error);
    toast(`${label}: ${error?.message || 'Error desconocido'}`, 'err');
  }
}

/* =========================================================
   EVENTOS
========================================================= */
async function bind() {
  await loadState();
  populateSellers();
  renderHistory();
  renderImportHistory();
  renderQuote();
  setTab('resumen');
  document.body.classList.remove('loading');

  /* ----- ARCHIVOS ----- */
  const openFilePicker = () => {
    const input = $('fileInput');
    if (!input) { toast('No se encontró el selector de archivos.', 'err'); return; }
    input.value = '';
    input.click();
  };
  $('btnOpenImport').onclick = openFilePicker;
  $('btnImportPrimary').onclick = openFilePicker;
  $('btnImportEmpty').onclick = openFilePicker;
  $('dropZone').onclick = openFilePicker;
  $('fileInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    handleFile(file);
  });
  const dropZone = $('dropZone');
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropZone.classList.add('drag');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag');
    const file = event.dataTransfer?.files?.[0];
    handleFile(file);
  });

  /* ----- TABS ----- */
  document.querySelectorAll('.tab').forEach((button) => {
    button.onclick = () => { setTab(button.dataset.tab); $('mainContent').focus(); };
  });

  /* ----- NAVEGACIÓN ----- */
  $('pagePrev').onclick = () => { historyPage--; renderHistory(); };
  $('pageNext').onclick = () => { historyPage++; renderHistory(); };
  $('btnFirst').onclick = () => goToQuote(0);
  $('btnPrev').onclick = () => goToQuote(selected - 1);
  $('btnNext').onclick = () => goToQuote(selected + 1);
  $('btnLast').onclick = () => goToQuote(filtered.length - 1);
  $('quoteJump').onchange = (event) => {
    const value = event.target.value;
    if (value === '') return; // guardia: opción "Sin pedidos"
    goToQuote(Number(value) || 0);
  };

  /* ----- VENDEDORES ----- */
  function changeSeller(value) {
    sellerFilterValue = value || 'todo';
    historyPage = 0;
    selected = 0;
    populateSellers();
    renderHistory();
    renderQuote();
  }
  $('sellerFilter').onchange = (event) => changeSeller(event.target.value);
  $('quoteSellerFilter').onchange = (event) => changeSeller(event.target.value);

  /* ----- FILTROS ----- */
  for (const id of ['search', 'sort', 'dateFilter']) {
    $(id).oninput = () => { historyPage = 0; selected = 0; renderHistory(); renderQuote(); };
  }
  $('filterForm').onsubmit = event => event.preventDefault();
  $('btnReset').onclick = () => {
    // el form resetea los campos; setTimeout espera a que el navegador aplique el reset
    setTimeout(() => {
      $('search').value = '';
      $('sort').value = 'fecha_desc';
      $('dateFilter').value = 'todo';
      sellerFilterValue = 'todo';
      selected = 0;
      populateSellers();
      renderHistory();
      renderQuote();
    }, 0);
  };

  /* ----- IMPRESIÓN ----- */
  $('editCurrent').onclick = () => { const q = currentQuote(); if (q) editOrder(q); };
  $('btnPrint').onclick = () => actionSafe(() => {
    const quote = currentQuote();
    if (!quote) throw new Error('No hay pedido seleccionado.');
    printHtml([quote], `Pedido ${quote.numero}`);
  }, 'No se pudo imprimir');
  $('btnPrintAll').onclick = () => actionSafe(() => {
    applyFilters();
    if (!filtered.length) throw new Error('No hay pedidos para imprimir.');
    printHtml(filtered, sellerFilterValue === 'todo' ? 'Pedidos EMA' : `Pedidos de ${sellerFilterValue}`);
  }, 'No se pudo imprimir');
  $('btnHistoryPrint').onclick = () => actionSafe(() => {
    applyFilters();
    if (!filtered.length) throw new Error('No hay resultados.');
    printHtml(filtered, 'Resultados EMA');
  }, 'No se pudo imprimir');

  /* ----- PDF / WORD ----- */
  $('btnPdf').onclick = () => actionSafe(() => {
    const quote = currentQuote();
    if (!quote) throw new Error('No hay pedido seleccionado.');
    return loadAsset('lib/jspdf.umd.min.js').then(() => exportPdf(quote));
  }, 'No se pudo generar el PDF');
  $('btnWord').onclick = () => actionSafe(() => {
    const quote = currentQuote();
    if (!quote) throw new Error('No hay pedido seleccionado.');
    exportWord(quote);
  }, 'No se pudo generar Word');

  /* ----- PREVIEWS ----- */
  $('btnPreviewCurrent').onclick = () => openInvoicePreview(currentQuote());
  $('btnPreviewSeller').onclick = () => openSellerPreview();
  $('invoicePreviewX').onclick = closeInvoicePreview;
  $('invoicePreviewClose').onclick = closeInvoicePreview;
  $('invoicePreviewPrint').onclick = () => actionSafe(() => {
    const quote = currentQuote();
    if (!quote) throw new Error('No hay pedido seleccionado.');
    printHtml([quote], `Pedido ${quote.numero}`);
  }, 'No se pudo imprimir');
  $('sellerPreviewX').onclick = closeSellerPreview;
  $('sellerPreviewClose').onclick = closeSellerPreview;
  $('sellerPreviewPrev').onclick = () => { sellerPreviewIndex--; renderSellerPreview(); };
  $('sellerPreviewNext').onclick = () => { sellerPreviewIndex++; renderSellerPreview(); };
  $('sellerPreviewPrint').onclick = () => actionSafe(() => {
    const list = sellerList();
    if (!list.length) throw new Error('No hay pedidos para este vendedor.');
    printHtml([list[sellerPreviewIndex]], 'Vista del vendedor');
  }, 'No se pudo imprimir');

  /* ----- MODAL CONFIRMACIÓN ----- */
  $('modalX').onclick = closeModal;
  $('modalCancel').onclick = closeModal;
  $('modalOk').onclick = () => {
    const action = modalAction;
    closeModal();
    if (typeof action === 'function') action();
  };
  $('modalBg').onclick = (event) => {
    if (event.target === event.currentTarget) closeModal();
  };

  /* ----- PREVIEW IMPORTACIÓN ----- */
  $('previewX').onclick = closeImportPreview;
  $('previewCancel').onclick = closeImportPreview;
  const commitPendingImport = (mode) => {
    if (!pendingImport) { toast('No hay una importación pendiente.', 'err'); return; }
    const data = pendingImport;
    const count = data.quotes.length;
    closeImportPreview();
    recordChange('Importación', data.fileName + ' · ' + mode);
    if (mode === 'replace') {
      replaceImported(data.quotes, data.reportTotal, data.fileName);
      toast(`${count} pedidos cargados. La base anterior fue reemplazada.`, 'ok');
    } else {
      mergeImported(data.quotes, data.reportTotal, data.fileName);
      toast(`${count} pedidos incorporados o actualizados.`, 'ok');
    }
    setTab('pedidos');
  };
  $('previewAppend').onclick = () => commitPendingImport('append');
  $('previewReplace').onclick = () => {
    if (!state.quotes.length) { commitPendingImport('replace'); return; }
    openModal('Reemplazar pedidos', 'La base de pedidos quedará con los registros de este archivo. Podés cancelar y descargar un respaldo desde Actividad.', () => commitPendingImport('replace'));
  };
  for (const [id, close] of [['previewBg', closeImportPreview], ['modalBg', closeModal],
    ['invoicePreviewBg', closeInvoicePreview], ['sellerPreviewBg', closeSellerPreview],
    ['importHistoryPreviewBg', closeImportHistoryPreview]]) {
    $(id).addEventListener('cancel', event => { event.preventDefault(); close(); });
  }
  $('previewBg').onclick = (event) => {
    if (event.target === event.currentTarget) closeImportPreview();
  };

  /* ----- HISTORIAL ----- */
  $('historyBody').onclick = (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const id = button.dataset.id;
    if (button.dataset.act === 'view') {
      applyFilters();
      const index = filtered.findIndex((q) => q.id === id);
      if (index >= 0) { selected = index; setTab('pedidos'); renderQuote(); }
      return;
    }
    if (button.dataset.act === 'edit') { editOrder(state.quotes.find(q=>q.id===id)); return; }
    if (button.dataset.act === 'del') {
      openModal(
        'Eliminar pedido',
        '¿Deseas eliminar este pedido del historial? Podés recuperarlo desde Actividad.',
        () => {
          const removed = state.quotes.find(q => q.id === id);
          recordChange('Eliminar pedido', removed.numero, removed);
          state.quotes = state.quotes.filter((q) => q.id !== id);
          saveState();
          selected = 0;
          renderHistory();
          renderQuote();
          toast('Pedido eliminado.', 'ok');
        }
      );
    }
  };

  $('importHistoryBody').onclick = (event) => {
    const button = event.target.closest('button');
    if (!button || button.dataset.importAct !== 'view') return;
    openImportHistoryPreview(button.dataset.id);
  };

  $('importHistoryPreviewX').onclick = closeImportHistoryPreview;
  $('importHistoryPreviewClose').onclick = closeImportHistoryPreview;
  $('importHistoryPreviewBg').onclick = (event) => {
    if (event.target === event.currentTarget) closeImportHistoryPreview();
  };

  /* ----- VACIAR HISTORIAL ----- */
  $('btnClear').onclick = () => openModal(
    'Vaciar historial de pedidos',
    'Se eliminarán los pedidos guardados en la base actual. El historial de archivos importados se conservará.',
    () => {
      recordChange('Vaciar pedidos', state.quotes.length + ' pedidos');
      state.quotes = [];
      state.meta = { lastFile: '', lastImportedAt: null, reportTotal: 0 };
      saveState();
      selected = 0;
      sellerFilterValue = 'todo';
      populateSellers();
      renderHistory();
      renderImportHistory();
      renderQuote();
      toast('Base de pedidos vaciada. El historial de archivos se conserva.', 'ok');
    }
  );

  /* ----- RESPALDO / RESTAURAR ----- */
  $('btnBackup').onclick = () => actionSafe(exportBackup, 'No se pudo crear el respaldo');
  $('btnRestoreActivity').onclick = $('btnRestore').onclick = () => $('restoreInput').click();
  $('restoreInput').onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_FILE_SIZE * 4) throw new Error("Respaldo mayor de 80 MB.");
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data?.state || !Array.isArray(data.state.quotes)) {
        throw new Error('El archivo no contiene un respaldo EMA válido.');
      }
      validateBackup(data.state);
      openModal('Restaurar respaldo', 'Se reemplazarán los pedidos, los catálogos y la actividad locales con este respaldo.', () => {
        applyState(data.state);
        recordChange('Restauración', file.name);
        saveState();
        selected = 0;
        sellerFilterValue = 'todo';
        populateSellers();
        renderHistory();
        renderImportHistory();
        renderQuote();
        toast('Respaldo restaurado correctamente.', 'ok');
      });
    } catch (error) {
      toast(`No se pudo restaurar: ${error?.message || 'Error desconocido'}`, 'err');
    }
  };

  /* ----- TECLADO ----- */
  document.addEventListener('keydown', (event) => {
    if (document.body.dataset.view !== 'pedidos' || document.querySelector('dialog[open]')) return;
    const tag = (event.target?.tagName || '').toLowerCase();
    if (event.target?.closest?.('.grid-scroll, .table-scroll, .invoice-wrap') || ['input', 'textarea', 'select', 'button'].includes(tag) || event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowLeft': event.preventDefault(); goToQuote(selected - 1); break;
      case 'ArrowRight': event.preventDefault(); goToQuote(selected + 1); break;
    }
  });

  /* ----- CLICK FUERA DE PREVIEWS ----- */
  $('invoicePreviewBg').onclick = (event) => {
    if (event.target === event.currentTarget) closeInvoicePreview();
  };
  $('sellerPreviewBg').onclick = (event) => {
    if (event.target === event.currentTarget) closeSellerPreview();
  };

  /* ----- ERRORES GLOBALES ----- */
  window.addEventListener('error', (event) => {
    const message = event?.message || '';
    if (!message || /ResizeObserver/i.test(message)) return;
    console.error('Error EMA:', event);
    toast(`Error de la aplicación: ${message}`, 'err');
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (!event.reason) return;
    console.error('Promesa rechazada:', event.reason);
    toast(`Error: ${event.reason?.message || String(event.reason)}`, 'err');
  });

  setSystemStatus('Listo para trabajar', 'success');
}

/* =========================================================
   ARRANQUE
========================================================= */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bind, { once: true });
} else {
  bind();
}