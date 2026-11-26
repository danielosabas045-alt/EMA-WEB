function norm(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanText(value) {
  return norm(value).replace(/^'+/, '').replace(/\uFFFD/g, '?').trim();
}
function toNum(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let text = cleanText(value);
  if (!text) return 0;
  let negative = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/\s/g, '').replace(/Q/gi, '').replace(/\$/g, '').replace(/%$/g, '');
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    if (decimals <= 3) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else {
    const dotCount = (text.match(/\./g) || []).length;
    if (dotCount > 1) {
      const last = text.lastIndexOf('.');
      const integer = text.slice(0, last).replace(/\./g, '');
      const decimal = text.slice(last + 1);
      text = `${integer}.${decimal}`;
    }
  }
  text = text.replace(/[^0-9.-]/g, '');
  const number = Number(text);
  if (!Number.isFinite(number)) return 0;
  return negative ? -number : number;
}

/* =========================================================
   FECHAS
========================================================= */
function excelSerialToDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 1) return null;
  const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  const date = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  return Number.isNaN(date.getTime()) ? null : date;
}
function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (typeof value === 'number') {
    const date = excelSerialToDate(value);
    if (date) return date.getTime();
  }
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const third = Number(match[3]);
    let year, month, day;
    if (first >= 1900) {
      year = first; month = second; day = third;
    } else if (third >= 1900) {
      year = third; month = second; day = first;
      if (month > 12 && day <= 12) [month, day] = [day, month];
    } else {
      year = third < 100 ? third + 2000 : third;
      month = second; day = first;
      if (month > 12 && day <= 12) [month, day] = [day, month];
    }
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) {
      return date.getTime();
    }
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateText(value) {
  const timestamp = parseDate(value);
  if (!timestamp) return cleanText(value);
  const date = new Date(timestamp);
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear()
  ].join('/');
}
function splitParty(value) {
  const source = cleanText(value);
  if (!source) return { code: '', name: '' };
  let code = '';
  let name = source;
  const pipeIndex = source.indexOf('|');
  if (pipeIndex >= 0) {
    code = cleanText(source.slice(0, pipeIndex));
    name = cleanText(source.slice(pipeIndex + 1));
  }
  const equalMatch = name.match(/^(.+?)\s*=\s*([A-Z0-9._-]+)$/i);
  if (equalMatch) {
    name = cleanText(equalMatch[1]);
    if (!code) code = cleanText(equalMatch[2]);
  }
  return { code, name: name || source };
}

/* =========================================================
   ALIASES DE COLUMNAS
========================================================= */
const ALIASES = {
  sucursal: ['SUCURSAL','AGENCIA','SEDE','TIENDA'],
  pedido: ['PEDIDO','N PEDIDO','NO PEDIDO','NO. PEDIDO','NUM PEDIDO','NUMERO PEDIDO','NUMERO DE PEDIDO','COTIZACION','N COTIZACION','NO COTIZACION','NO. COTIZACION','NUM COTIZACION','ORDEN','ORDEN DE COMPRA'],
  cliente: ['CLIENTE','NOMBRE CLIENTE','RAZON SOCIAL','RAZON SOCIAL CLIENTE','CLIENTE NOMBRE','NOMBRE'],
  direccion: ['DIRECCION','DIRECCION CLIENTE','DIRECCION DE CLIENTE','DIRECCION ENTREGA','DIRECCION DE ENTREGA','DIRECCION FISCAL','DOMICILIO','DOMICILIO CLIENTE','UBICACION','DIRECCION ENVIO','DIRECCION DE ENVIO'],
  fecha: ['FECHA','FECHA PEDIDO','FECHA COTIZACION','FECHA DE COTIZACION','FECHA EMISION','FECHA DE EMISION','FECHA DOCUMENTO'],
  vendedor: ['VENDEDOR','VENDEDOR COMERCIAL','ASESOR','ASESOR COMERCIAL','EJECUTIVO','EJECUTIVO DE VENTAS','VENDEDOR PEDIDO'],
  codigo: ['CODIGO PRODUCTO','CODIGO DE PRODUCTO','CODIGO ARTICULO','CODIGO DE ARTICULO','CODIGO ITEM','SKU','CODIGO'],
  desc: ['CONCEPTO DETALLE','CONCEPTO','DESCRIPCION','DESCRIPCION DETALLE','PRODUCTO','DETALLE','ITEM','ARTICULO','ARTICULO DESCRIPCION','NOMBRE PRODUCTO'],
  cantidad: ['CANTIDAD PEDIDO','CANTIDAD DETALLE','CANTIDAD','CANT','CANT.','UNIDADES','QTY'],
  precio: ['PRECIO VENTA','PRECIO UNITARIO','PRECIO UNIT','PRECIO U','P UNITARIO','P. UNITARIO','PRECIO','UNIT PRICE'],
  total: ['TOTAL VENTA','TOTAL VENTA REAL','TOTAL LINEA','TOTAL DETALLE','IMPORTE LINEA','IMPORTE','SUBTOTAL','TOTAL']
};
const WEIGHTS = { codigo: 2, sucursal: 6, pedido: 10, cliente: 10, direccion: 8, fecha: 6, vendedor: 8, desc: 9, cantidad: 6, precio: 7, total: 7 };

function normalizeKey(value) {
  return cleanText(value).toUpperCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
}
function headerScore(cell, field) {
  const key = normalizeKey(cell);
  if (!key) return 0;
  const aliases = ALIASES[field] || [];
  let score = 0;
  aliases.forEach((alias, index) => {
    const normalized = normalizeKey(alias);
    if (key === normalized) {
      score = Math.max(score, 1000 + aliases.length - index);
      return;
    }
    if (field === 'codigo') return;
    if (key.startsWith(`${normalized} `) || key.endsWith(` ${normalized}`)) {
      score = Math.max(score, 700 + aliases.length - index);
      return;
    }
    if (key.includes(normalized)) {
      score = Math.max(score, 400 + aliases.length - index);
    }
  });
  return score;
}
function findCol(header, field) {
  let index = -1;
  let best = 0;
  header.forEach((cell, position) => {
    const score = headerScore(cell, field);
    if (score > best) { best = score; index = position; }
  });
  return index;
}
function scoreHeaderRow(row) {
  let score = 0;
  let hits = 0;
  Object.keys(ALIASES).forEach((field) => {
    if (findCol(row, field) >= 0) { hits += 1; score += WEIGHTS[field]; }
  });
  if (findCol(row, 'pedido') >= 0 && findCol(row, 'cliente') >= 0) score += 18;
  if (findCol(row, 'desc') >= 0 && findCol(row, 'cantidad') >= 0) score += 12;
  if (findCol(row, 'precio') >= 0 && findCol(row, 'total') >= 0) score += 10;
  return { score, hits };
}
function detectHeader(rows) {
  let best = { index: -1, score: -1, hits: 0 };
  const limit = Math.min(rows.length, 300);
  for (let index = 0; index < limit; index++) {
    const result = scoreHeaderRow(rows[index] || []);
    if (result.score > best.score) best = { index, ...result };
  }
  return best.hits >= 3 ? best.index : -1;
}

/* =========================================================
   ARCHIVOS / CODIFICACIÓN
========================================================= */
async function readArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
    reader.readAsArrayBuffer(file);
  });
}
function decodeText(buffer, encoding = 'windows-1252') {
  if (typeof TextDecoder === 'undefined') {
    const bytes = new Uint8Array(buffer);
    let output = '';
    for (let i = 0; i < bytes.length; i++) output += String.fromCharCode(bytes[i]);
    return output;
  }
  try {
    return new TextDecoder(encoding).decode(new Uint8Array(buffer));
  } catch (_) {
    return new TextDecoder().decode(new Uint8Array(buffer));
  }
}
function looksLikeHtml(buffer) {
  const text = decodeText(buffer.slice(0, 8000), 'windows-1252').replace(/^\uFEFF/, '').trim();
  return /^<!doctype\s+html/i.test(text) || /^<html\b/i.test(text) || /<table[\s>]/i.test(text);
}

/* =========================================================
   HTML / REPORTES ANTIGUOS
========================================================= */
function directTableRows(table) {
  const rows = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = tr.querySelectorAll(':scope > th, :scope > td');
    if (!cells.length) return;
    rows.push([...cells].map((cell) => cleanText(cell.textContent)));
  });
  return rows;
}
function parseHtmlTables(text) {
  const template = document.createElement('template');
  template.innerHTML = text;
  const doc = template.content;
  let tables = [...doc.querySelectorAll('table')];
  const preferred = doc.querySelector('#dgdreporte');
  if (preferred) {
    tables = [preferred, ...tables.filter((t) => t !== preferred)];
  } else {
    tables.sort((a, b) => directTableRows(b).length - directTableRows(a).length);
  }
  let best = { rows: [], headerIndex: -1, score: -1 };
  for (const table of tables) {
    const rows = directTableRows(table);
    for (let i = 0; i < Math.min(rows.length, 300); i++) {
      const result = scoreHeaderRow(rows[i]);
      if (result.score > best.score) best = { rows, headerIndex: i, score: result.score };
    }
  }
  return best;
}

/* =========================================================
   SHEETJS
========================================================= */
function sheetRows(sheet) {
  if (!sheet?.['!ref']) return [];
  const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
  const columns = range.e.c - range.s.c + 1, rows = range.e.r - range.s.r + 1;
  if (rows > 100000 || columns > 250 || rows * columns > 2000000) {
    throw Error('La hoja supera el límite de filas o columnas. Dividí el archivo y volvé a importar.');
  }
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
}
function chooseWorkbookRows(workbook) {
  let best = { rows: [], name: '', score: -1, headerIndex: -1 };
  for (const name of workbook.SheetNames) {
    const rows = sheetRows(workbook.Sheets[name]);
    if (!rows.length) continue;
    for (let i = 0; i < Math.min(rows.length, 300); i++) {
      const row = rows[i] || [];
      const result = scoreHeaderRow(row);
      let score = result.score;
      if (rows.length > 20) score += 2;
      if (findCol(row, 'pedido') >= 0) score += 5;
      if (findCol(row, 'desc') >= 0) score += 5;
      if (score > best.score) best = { rows, name, score, headerIndex: i };
    }
  }
  if (!best.rows.length) throw new Error('El archivo no contiene datos utilizables.');
  return best;
}
function parseExcel(buffer) {
  if (typeof XLSX === 'undefined') throw new Error('El lector Excel no se cargó. Revisa lib/xlsx.full.min.js.');
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: false, codepage: 1252, dense: true, cellFormula: false, cellHTML: false, bookVBA: false, dateNF: 'yyyy-mm-dd' });
  return chooseWorkbookRows(workbook);
}
function parseCsv(buffer) {
  if (typeof XLSX === 'undefined') throw new Error('El lector CSV no se cargó.');
  let text = decodeText(buffer, 'utf-8');
  if (text.includes('�')) text = decodeText(buffer, 'windows-1252');
  const workbook = XLSX.read(text, { type: 'string', raw: true, codepage: 1252 });
  return chooseWorkbookRows(workbook);
}

/* =========================================================
   FILAS / PEDIDOS
========================================================= */
function isSummaryRow(row) {
  const text = normalizeKey((row || []).join(' '));
  return /\bTOTAL POR CLIENTE\b/.test(text) || /\bTOTAL GENERAL\b/.test(text) || /^\s*TOTALES?\b/.test(text);
}
function isGlobalTotalRow(row) {
  const text = normalizeKey((row || []).join(' '));
  return /\bTOTAL GENERAL\b/.test(text) || /^\s*TOTALES?\b/.test(text);
}
function parseRows(file, rows, source = {}) {
  const headerIndex = Number.isInteger(source.headerIndex) ? source.headerIndex : detectHeader(rows);
  if (headerIndex < 0) throw new Error('No encontré una fila de encabezados reconocible.');
  const header = (rows[headerIndex] || []).map(cleanText);
  const columns = {};
  for (const field of Object.keys(ALIASES)) columns[field] = findCol(header, field);
  if (columns.pedido < 0) throw new Error('No encontré la columna PEDIDO o N. DE PEDIDO.');
  if (columns.cliente < 0) throw new Error('No encontré la columna CLIENTE o RAZÓN SOCIAL.');
  if (columns.desc < 0) throw new Error('No encontré la columna de descripción del producto.');

  const groups = new Map();
  const issues = [];
  let lastOrder = '';
  let reportTotal = 0;

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (!row.some((v) => cleanText(v) !== '')) continue;

    const summary = isSummaryRow(row);
    if (summary) {
      if (isGlobalTotalRow(row)) {
        const total = columns.total >= 0 ? toNum(row[columns.total]) : 0;
        if (total > 0) reportTotal = total;
        continue;
      }
    }

    let number = columns.pedido >= 0 ? cleanText(row[columns.pedido]) : '';
    if (!number) number = lastOrder;
    if (!number) { issues.push('Fila ' + (r+1) + ': falta el número de pedido.'); continue; }
    lastOrder = number;

    if (!groups.has(number)) {
      groups.set(number, {
        numero: number, cliente: '', direccion: '', fecha: '', vendedor: '',
        items: [], summaryTotal: 0, archivo: file.name, source: source.format || 'archivo'
      });
    }
    const group = groups.get(number);

    if (summary) {
      const summaryText = normalizeKey(row.join(' '));
      if (/\bTOTAL POR CLIENTE\b/.test(summaryText)) {
        const summaryTotal = columns.total >= 0 ? toNum(row[columns.total]) : 0;
        if (summaryTotal > 0) group.summaryTotal = summaryTotal;
      }
      continue;
    }

    if (columns.sucursal >= 0 && cleanText(row[columns.sucursal])) group.sucursal = cleanText(row[columns.sucursal]);
    if (columns.cliente >= 0) {
      const v = cleanText(row[columns.cliente]);
      if (v) group.cliente = v;
    }
    if (columns.direccion >= 0) {
      const v = cleanText(row[columns.direccion]);
      if (v) group.direccion = v;
    }
    if (columns.fecha >= 0) {
      const v = cleanText(row[columns.fecha]);
      if (v) group.fecha = v;
    }
    if (columns.vendedor >= 0) {
      const v = cleanText(row[columns.vendedor]);
      if (v) group.vendedor = v;
    }

    const description = columns.desc >= 0 ? cleanText(row[columns.desc]) : '';
    if (!description) { issues.push('Fila ' + (r+1) + ': sin producto, se omitió la línea.'); continue; }
    if (/^TOTAL\b/i.test(description) || /^TOTALES?\b/i.test(description)) continue;

    const quantity = columns.cantidad >= 0 ? toNum(row[columns.cantidad]) : 0;
    let price = columns.precio >= 0 ? toNum(row[columns.precio]) : 0;
    let lineTotal = columns.total >= 0 ? toNum(row[columns.total]) : 0;
    if (!lineTotal && quantity && price) lineTotal = quantity * price;
    if (!price && quantity && lineTotal) price = lineTotal / quantity;

    const badNumber = [columns.cantidad, columns.precio, columns.total].some(col =>
      col >= 0 && cleanText(row[col]) && !/[0-9]/.test(cleanText(row[col])));
    if (badNumber || (columns.cantidad >= 0 && !quantity) || !group.cliente
        || (!lineTotal && !(quantity && cleanText(row[columns.precio])))
        || (columns.fecha >= 0 && parseDate(group.fecha) == null)) {
      issues.push('Fila ' + (r+1) + ': revisar cliente, fecha, cantidad o importe.');
    }
    const item = splitParty(description);
    group.items.push({
      codigo: cleanText(row[columns.codigo]) || item.code, descripcion: item.name,
      cantidad: quantity, precio: price, total: lineTotal
    });
  }

  const quotes = [];
  for (const group of groups.values()) {
    if (!group.items.length) continue;
    const customer = splitParty(group.cliente);
    const seller = splitParty(group.vendedor);
    const calculatedTotal = group.items.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const amount = group.summaryTotal > 0 ? group.summaryTotal : calculatedTotal;
    quotes.push({
      id: `q_${group.numero}`,
      numero: group.numero,
      clientCode: customer.code,
      cliente: customer.name,
      direccion: group.direccion,
      fecha: dateText(group.fecha),
      fechaTs: parseDate(group.fecha),
      sucursal: group.sucursal || '',
      vendedorCode: seller.code,
      vendedor: seller.name,
      archivo: group.archivo,
      items: group.items,
      monto: amount,
      createdAt: Date.now(),
      source: group.source
    });
  }
  if (!quotes.length) throw new Error('El archivo fue leído, pero no encontré pedidos con productos.');
  return { quotes, reportTotal, issues };
}

/* =========================================================
   PARSE FILE
========================================================= */
