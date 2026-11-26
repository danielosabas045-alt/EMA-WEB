'use strict';
importScripts('parser.js');

// Reject oversized workbooks before a ZIP reader expands their contents.
function validateZip(bytes) {
  const zip = new DataView(bytes);
  let end = zip.byteLength - 22;
  const minimum = Math.max(0, end - 65535);
  while (end >= minimum && zip.getUint32(end, true) !== 0x06054b50) end--;
  if (end < minimum) throw Error('El libro comprimido está incompleto.');
  const files = zip.getUint16(end + 10, true);
  const directory = zip.getUint32(end + 16, true);
  if (!files || files > 2000) throw Error('El libro tiene demasiadas piezas internas.');
  let cursor = directory, expanded = 0;
  for (let i = 0; i < files; i++) {
    if (cursor + 46 > end || zip.getUint32(cursor, true) !== 0x02014b50) throw Error('El libro comprimido es inválido.');
    expanded += zip.getUint32(cursor + 24, true);
    if (expanded > 96 * 1024 * 1024) throw Error('El libro descomprimido supera 96 MiB.');
    cursor += 46 + zip.getUint16(cursor + 28, true) + zip.getUint16(cursor + 30, true) + zip.getUint16(cursor + 32, true);
  }
}

function readJson(file, buffer) {
  const json = JSON.parse(new TextDecoder().decode(buffer).replace(/^\uFEFF/, ''));
  const records = Array.isArray(json) ? json : json?.quotes || json?.state?.quotes;
  if (!Array.isArray(records) || !records.length || records.length > 100000) throw Error('Se esperaba una lista de hasta 100.000 pedidos o filas.');
  if (!records.some(q => q && Object.hasOwn(q, 'items'))) {
    const header = Object.keys(records.find(r => r && typeof r === 'object') || {});
    return parseRows(file, [header, ...records.map(r => header.map(k => r?.[k] ?? ''))], {headerIndex:0, format:'json'});
  }
  const seen = new Set(), quotes = [], issues = [];
  for (const [index, q] of records.entries()) {
    const numero = cleanText(q?.numero), cliente = cleanText(q?.cliente);
    if (!numero || !cliente || !Array.isArray(q?.items) || !q.items.length || seen.has(numero)) {
      issues.push('Registro ' + (index + 1) + ': pedido incompleto o número repetido. Se omitió.');
      continue;
    }
    const items = q.items.map(item => {
      const cantidad = Number(item?.cantidad), precio = Number(item?.precio);
      return {descripcion:cleanText(item?.descripcion), codigo:cleanText(item?.codigo), cantidad, precio,
        total:Number(item?.total ?? cantidad * precio)};
    });
    const monto = Number(q.monto ?? items.reduce((a, b) => a + b.total, 0));
    if (!Number.isFinite(monto) || items.some(i => !i.descripcion || ![i.cantidad, i.precio, i.total].every(Number.isFinite))) {
      issues.push('Registro ' + (index + 1) + ': producto o importe inválido. Se omitió el pedido.');
      continue;
    }
    seen.add(numero);
    quotes.push({id:'q_'+numero, numero, cliente, clientCode:cleanText(q.clientCode),
      direccion:cleanText(q.direccion), vendedor:cleanText(q.vendedor), vendedorCode:cleanText(q.vendedorCode),
      sucursal:cleanText(q.sucursal), fecha:dateText(q.fecha), fechaTs:parseDate(q.fecha) ??
        (typeof q.fechaTs === 'number' && Number.isFinite(q.fechaTs) ? q.fechaTs : null),
      items, monto, archivo:file.name, source:'json'});
  }
  if (!quotes.length) throw Error('El JSON no contiene pedidos válidos.');
  return {quotes, reportTotal:0, issues};
}

self.onmessage = async ({data: file}) => {
  try {
    const buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = event => postMessage({stage:'progress', loaded:event.loaded, total:file.size});
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
    postMessage({stage:'read', bytes:buffer.byteLength});
    let result;
    if (/\.json$/i.test(file.name)) {
      result = readJson(file, buffer);
    } else if (/\.html?$/i.test(file.name) || looksLikeHtml(buffer)) {
      if (buffer.byteLength > 5 * 1024 * 1024) throw Error('Dividí los informes HTML en archivos de hasta 5 MiB.');
      let html = decodeText(buffer, 'utf-8');
      if (html.includes('�')) html = decodeText(buffer);
      // Legacy HTML is read only from a detached template by the web app.
      postMessage({html});
      return;
    } else {
      const bytes = new Uint8Array(buffer);
      const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
      if (/\.(xlsx|xlsm|xlsb)$/i.test(file.name) && !zipped) throw Error('La extensión no coincide con un libro de Excel válido.');
      if (zipped) validateZip(buffer);
      const csv = /\.csv$/i.test(file.name);
      if (csv && (zipped || bytes[0] === 0xd0 && bytes[1] === 0xcf)) throw Error('El contenido es un libro de Excel. Seleccionalo con su extensión original.');
      importScripts('lib/xlsx.full.min.js');
      const parsed = csv ? parseCsv(buffer) : parseExcel(buffer);
      result = parseRows(file, parsed.rows, {headerIndex:parsed.headerIndex, format:csv?'csv':'excel'});
    }
    postMessage({result});
  } catch (e) {
    const detail = e instanceof SyntaxError ? 'El JSON no tiene una estructura válida.' : e.message;
    postMessage({error:detail || 'Archivo inválido.'});
  }
};
