'use strict';
const labels = {resumen:'Resumen',pedidos:'Pedidos',historial:'Historial',catalogos:'Catálogos',reportes:'Reportes',asistente:'Asistente EMA',actividad:'Actividad'};
const fields = {cliente:'Cliente',vendedor:'Vendedor',producto:'Producto',sucursal:'Sucursal'};
const assets = new Map();
const roundMoney = value => Math.round(value * 100) / 100;
const sum = rows => roundMoney(rows.reduce((a, q) => a + Number(q.monto || 0), 0));
const textOrder = (a,b) => String(a).localeCompare(String(b),'es',{numeric:true,sensitivity:'base'});
const cleanKey = v => normalizeKey(v).toLowerCase();
const option = (v,text=v) => new Option(text,v);
const qty = n => Number(n).toLocaleString('es-GT',{maximumFractionDigits:2});
const todayISO = () => dayKey(Date.now());
function dayKey(ts) {
  if (ts == null || ts === '') return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function loadAsset(src) {
  if (!assets.has(src)) assets.set(src,new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=src; script.onload=resolve;
    script.onerror=()=>{assets.delete(src);reject(Error('No se pudo cargar '+src));};
    document.head.append(script);
  }));
  return assets.get(src);
}
function validCatalog(value) {
  return Object.fromEntries(Object.keys(fields).map(k=>[k,Array.isArray(value?.[k]) ? value[k].filter(x=>typeof x==='string' && x.trim()) : []]));
}
function validateBackup(s) {
  if (!Array.isArray(s?.quotes) || s.quotes.some(q=>!q || !q.numero || !Array.isArray(q.items) || !Number.isFinite(Number(q.monto)) || q.items.some(i=>!i || !Number.isFinite(Number(i.total))))) throw Error('Respaldo con pedidos inválidos.');
  if(new Set(s.quotes.map(q=>cleanText(q.numero))).size!==s.quotes.length) throw Error('El respaldo contiene números de pedido duplicados.');
  if (s.importHistory && (!Array.isArray(s.importHistory) || s.importHistory.some(e=>!e || (e.preview && (!Array.isArray(e.preview) || e.preview.some(q=>!q || !Array.isArray(q.items) || q.items.some(i=>!i))))))) throw Error('Historial de importaciones inválido.');
}
let cancelImport;
function enterpriseImport(file) {
  cancelImport?.();
  const worker = new Worker('import-worker.js');
  const bar = $('readProgress'), abort = $('abortRead');
  bar.hidden = abort.hidden = false;
  bar.removeAttribute('value');
  return new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      clearTimeout(timer);
      worker.terminate();
      cancelImport = null;
      bar.hidden = abort.hidden = true;
      callback(value);
    };
    cancelImport = () => finish(reject, new DOMException('Lectura cancelada.', 'AbortError'));
    abort.onclick = () => {
      cancelImport?.();
      setImportStatus('Lectura cancelada.');
    };
    const timer = setTimeout(() => finish(reject, Error('El archivo excedió el tiempo de lectura. Dividilo en archivos más pequeños.')), 120000);
    worker.onerror = () => finish(reject, Error('No se pudo procesar el archivo.'));
    worker.onmessage = ({data}) => {
      try {
        if (data.stage === 'progress') { bar.max = data.total || 1; bar.value = data.loaded; return; }
        if (data.stage === 'read') { bar.removeAttribute('value'); setImportStatus('Archivo leído · validando registros'); return; }
        if (data.error) throw Error(data.error);
        if (data.html !== undefined) {
          const parsed = parseHtmlTables(data.html);
          data.result = parseRows(file, parsed.rows, {format:'html-report', headerIndex:parsed.headerIndex});
        }
        finish(resolve, data.result);
      } catch (error) {
        finish(reject, error);
      }
    };
    worker.postMessage(file);
  });
}
function recordChange(action,detail,removed) {
  state.audit.unshift({id:crypto.randomUUID(),time:Date.now(),action,detail,removed});
  state.audit=state.audit.slice(0,120);
}
let demoMode=false;
const samples=Array.from({length:24},(_,i)=>{
  const ts=new Date(2026,Math.floor(i/4),3+(i%4)*6).getTime(), cantidad=1+(i*7)%11, precio=75+25*(i%3);
  return {id:'demo'+i,numero:'DEMO-'+String(i+1).padStart(3,'0'),fecha:dateText(dayKey(ts)),fechaTs:ts,cliente:'Cliente demo '+(1+i%7),vendedor:'Vendedor demo '+(1+i%3),sucursal:i%3===0?'Sucursal demo Sur':'Sucursal demo Norte',monto:cantidad*precio,items:[{descripcion:'Producto demo '+(1+i%4),cantidad,precio,total:cantidad*precio}]};
});
function dataset(){return demoMode?samples:state.quotes;}
function changeOptions(node, values, first) {
  const old=node.value;
  node.replaceChildren(option('',first),...Array.from(new Set(values.filter(Boolean))).sort(textOrder).map(x=>option(x)));
  if(Array.from(node.options).some(o=>o.value===old))node.value=old;
}
function scopeRows() {
  const from=$('from').value,to=$('to').value,seller=$('dashSeller').value,branch=$('dashBranch').value;
  return dataset().filter(q=>{
    const d=dayKey(q.fechaTs);
    return (!seller || q.vendedor===seller) && (!branch || q.sucursal===branch) && (!from || d && d>=from) && (!to || d && d<=to);
  });
}
function groups(rows, key) {
  const map = new Map();
  for (const order of rows) {
    const name = (key === 'dia' ? dayKey(order.fechaTs) : key === 'mes'
      ? dayKey(order.fechaTs).slice(0, 7) : order[key]) || 'Sin dato';
    if (key === 'producto') {
      const products = new Map();
      let linesTotal = 0;
      for (const item of order.items) {
        const product = item.descripcion || 'Sin producto';
        products.set(product, (products.get(product) || 0) + item.total);
        linesTotal += item.total;
      }
      for (const [product, amount] of products) add(product, amount);
      const difference = roundMoney(order.monto - linesTotal);
      if (difference) add('Ajuste de importe del pedido', difference);
    } else {
      add(name, order.monto);
    }
  }
  function add(name, amount) {
    const entry = map.get(name) || {name, orders:0, total:0};
    entry.orders++;
    entry.total += amount;
    map.set(name, entry);
  }
  return [...map.values()].map(group => ({...group, total:roundMoney(group.total)}));
}
function monthly(rows) {
  return groups(rows, 'mes').filter(g => g.name !== 'Sin dato').sort((a, b) => textOrder(a.name, b.name));
}
function monthEdge(month, last = false) {
  const [year, index] = month.split('-').map(Number);
  return dayKey(new Date(year, index - Number(!last), Number(!last)).getTime());
}
function offsetMonth(month, offset) {
  const date = new Date(month + '-15T12:00:00');
  date.setMonth(date.getMonth() + offset);
  return dayKey(date.getTime()).slice(0, 7);
}
function coversMonth(month) {
  const from = $('from').value, to = $('to').value;
  return (!from || from <= monthEdge(month)) && (!to || to >= monthEdge(month, true))
    && todayISO() > monthEdge(month, true);
}
function comparison(months) {
  if (months.length < 2) return {reason:'Hacen falta dos meses con pedidos fechados.'};
  const last = months.at(-1), prev = months.at(-2);
  if (offsetMonth(last.name, -1) !== prev.name) return {reason:'Faltan pedidos en un mes intermedio.'};
  if (!coversMonth(last.name) || !coversMonth(prev.name)) return {reason:'La selección incluye un mes parcial o aún abierto.'};
  if (prev.total === 0) return {reason:'Las ventas del mes base suman Q 0.00.'};
  return {change:(last.total - prev.total) / Math.abs(prev.total) * 100, last, prev};
}
function countClients(rows) {
  const codesByName = new Map();
  for (const order of rows) {
    const name = cleanKey(order.cliente);
    if (!name || !order.clientCode) continue;
    if (!codesByName.has(name)) codesByName.set(name, new Set());
    codesByName.get(name).add(order.clientCode);
  }
  const distinct = new Set();
  for (const order of rows) {
    const name = cleanKey(order.cliente);
    const codes = codesByName.get(name);
    const code = order.clientCode || (codes?.size === 1 ? codes.values().next().value : '');
    if (code || name) distinct.add(code ? 'code:' + code : 'name:' + name);
  }
  return distinct.size;
}
function table(container, headings, rows, empty='Sin registros para esta selección.') {
  container.replaceChildren();
  if(!rows.length){const p=document.createElement('p');p.className='empty-copy';p.textContent=empty;container.append(p);return;}
  const scroll=document.createElement('div');scroll.className='grid-scroll';
  scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Tabla desplazable');
  const t=document.createElement('table');t.className='data-grid';
  const head=t.createTHead().insertRow();headings.forEach(s=>{const th=document.createElement('th');th.scope='col';th.textContent=s;head.append(th);});
  const body=t.createTBody();
  for(const row of rows){const tr=body.insertRow();row.forEach(v=>{const td=tr.insertCell();if(v instanceof Node)td.append(v);else td.textContent=v ?? '—';});}
  scroll.append(t);container.append(scroll);
}
function button(name,callback){const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent=name;b.onclick=callback;return b;}
function resetScope(){for(const id of ['from','to','dashSeller','dashBranch'])$(id).value='';}
function viewOrder(q) {
  if(demoMode && samples.includes(q)){openInvoicePreview(q);return;}
  $('search').value='';$('dateFilter').value='todo';sellerFilterValue='todo';
  renderHistory();selected=Math.max(0,filtered.findIndex(v=>v.id===q.id));renderQuote();setTab('pedidos');
}
function renderSummary() {
  const rows = dataset();
  changeOptions($('dashSeller'), rows.map(q => q.vendedor), 'Todos');
  changeOptions($('dashBranch'), rows.map(q => q.sucursal), 'Todas');
  const selectedRows = scopeRows(), total = sum(selectedRows), series = monthly(selectedRows), compared = comparison(series);
  $('sampleNote').hidden = !demoMode;
  $('demo').textContent = demoMode ? 'Salir de demo' : 'Explorar demo';
  $('scopeLabel').textContent = periodText(selectedRows);
  const values = [money(total), qty(selectedRows.length), qty(countClients(selectedRows)), money(selectedRows.length ? total / selectedRows.length : 0)];
  values.forEach((value, i) => $('k' + i).textContent = value);
  $('ks0').textContent = compared.reason || ((compared.change > 0 ? '+' : '') + qty(compared.change)
    + '% · ' + compared.last.name + ' vs. ' + compared.prev.name);
  const sellers = new Set(selectedRows.map(q => q.vendedor).filter(Boolean)).size;
  const branches = new Set(selectedRows.map(q => q.sucursal).filter(Boolean)).size;
  $('ks1').textContent = sellers + (sellers === 1 ? ' vendedor' : ' vendedores') + ' · '
    + branches + (branches === 1 ? ' sucursal' : ' sucursales');
  const undated = selectedRows.filter(q => !dayKey(q.fechaTs)).length;
  $('trendNote').hidden = !undated;
  $('trendNote').textContent = undated + ' pedidos sin fecha se incluyen en ventas, fuera del gráfico mensual.';
  drawTrend($('trendChart'), series.map(g => [g.name, g.total]), $('chartMode').value, month => {
    const start = monthEdge(month), end = monthEdge(month, true);
    if (!$('from').value || $('from').value < start) $('from').value = start;
    if (!$('to').value || $('to').value > end) $('to').value = end;
    renderSummary();
    $('from').focus();
  });
  const key = $('rankBy').value;
  const ranked = groups(selectedRows, key).sort((a, b) => b.total - a.total);
  $('rankNote').hidden = key !== 'producto' || !ranked.length;
  $('rankNote').textContent = 'Por producto se suman los importes de línea. Las diferencias con el total del pedido aparecen como ajuste.';
  drawRanking($('rankChart'), ranked.map(g => [g.name, g.total]), key === 'sucursal' ? 'anillo' : 'barras', label => {
    if (key === 'producto' || label === 'Sin dato') {
      const matches = selectedRows.filter(q => key !== 'producto' ? !q[key] :
        label === 'Ajuste de importe del pedido' ? roundMoney(q.monto - q.items.reduce((total, i) => total + i.total, 0)) !== 0 :
        q.items.some(i => (i.descripcion || 'Sin producto') === label));
      showMatches(matches, label);
      return;
    }
    const control = $(key === 'vendedor' ? 'dashSeller' : 'dashBranch');
    control.value = label;
    renderSummary();
    control.focus();
  });
  const recent = [...selectedRows].sort((a,b) => (b.fechaTs || 0) - (a.fechaTs || 0)).slice(0,6);
  table($('recent'), ['Pedido','Fecha','Cliente','Vendedor','Total'], recent.map(q =>
    [button(q.numero, () => viewOrder(q)),q.fecha,q.cliente,q.vendedor,money(q.monto)]),
    'Sin pedidos en esta selección. Creá un pedido, importá un archivo o explorá la demo.');
}
function renderEnterprise(tab=document.body.dataset.view){
  if(!labels[tab])return;
  $('crumb').textContent=labels[tab];
  if(tab==='resumen')renderSummary();
  if(tab==='catalogos')renderCatalog();
  if(tab==='reportes')renderReport();
  if(tab==='asistente')renderAssistant();
  if(tab==='actividad')renderAudit();
}
function catalogValues(key) {
  const usage=new Map();
  for(const q of state.quotes){
    const values=key==='producto'?new Set(q.items.map(i=>i.descripcion)):[q[key]];
    for(const name of values)if(name)usage.set(name,(usage.get(name)||0)+1);
  }
  for(const name of state.catalog[key] || [])if(!usage.has(name))usage.set(name,0);
  return usage;
}
function openCatalog(key){$('entityType').value=key;$('entitySearch').value='';setTab('catalogos');}
let catalogLimit=100;
function renderCatalog(){
  const key=$('entityType').value, term=cleanKey($('entitySearch').value);
  const entries=[...catalogValues(key)].filter(([n])=>cleanKey(n).includes(term)).sort((a,b)=>textOrder(a[0],b[0]));
  table($('entities'),[fields[key],'Pedidos vinculados','Acciones'],entries.slice(0,catalogLimit).map(([name,count])=>{
    const actions=document.createElement('div');actions.className='actions';actions.append(button('Editar',()=>editEntity(name)));
    if(!count)actions.append(button('Eliminar',()=>openModal('Eliminar registro','¿Eliminar '+name+' del catálogo?',()=>{
      state.catalog[key]=(state.catalog[key]||[]).filter(n=>n!==name);recordChange('Eliminar '+fields[key],name);saveState();
    })));
    return [name,String(count),actions];
  }));
  if(entries.length>catalogLimit)$('entities').append(button('Mostrar más',()=>{catalogLimit+=100;renderCatalog();}));
}
function dialogEditor(title) {
  $('editTitle').textContent=title;$('editFields').replaceChildren();$('editError').textContent='';
  $('editTotal').hidden = true;
  return $('editFields');
}
function control(parent,label,value='',type='text',required=false){
  const wrap=document.createElement('label'),input=document.createElement('input');
  wrap.textContent=label;input.type=type;input.value=value;input.required=required;
  if(type==='number')input.step='any';else input.maxLength=512;
  wrap.append(input);parent.append(wrap);return input;
}
function editEntity(old=''){
  const key=$('entityType').value,box=dialogEditor((old?'Editar ':'Agregar ')+fields[key].toLowerCase());
  const input=control(box,'Nombre',old,'text',true);
  input.autofocus = true;
  $('editor').showModal();
  if(old && catalogValues(key).get(old)){const note=document.createElement('p');note.textContent='Al guardar, los pedidos vinculados usarán el nuevo nombre.';box.append(note);}
  $('editForm').onsubmit=e=>{
    e.preventDefault();const name=cleanText(input.value);
    if(!name || [...catalogValues(key).keys()].some(n=>n!==old && cleanKey(n)===cleanKey(name))){$('editError').textContent='Ingresá un nombre único.';return;}
    state.catalog[key]=[...(state.catalog[key]||[]).filter(x=>x!==old),name];
    if (old) {
      const orders = [...state.quotes, ...state.audit.filter(event => event?.removed).map(event => event.removed)];
      for (const q of orders) {
        if (key === 'producto') {
          for (const item of q.items) if (item.descripcion === old) item.descripcion = name;
        } else if (q[key] === old) {
          q[key] = name;
        }
      }
      if (key === 'vendedor' && sellerFilterValue === old) sellerFilterValue = name;
      const selector = key === 'vendedor' ? $('dashSeller') : key === 'sucursal' ? $('dashBranch') : null;
      if (selector?.value === old) {
        changeOptions(selector, dataset().map(q => q[key]), key === 'vendedor' ? 'Todos' : 'Todas');
        selector.value = name;
      }
    }
    recordChange((old?'Editar ':'Alta de ')+fields[key],name);$('editor').close();saveState();renderHistory();renderQuote();toast('Registro guardado.','ok');
  };
}
function editOrder(original) {
  const box = dialogEditor(original ? 'Editar pedido' : 'Crear pedido');
  const head = document.createElement('div');
  head.className = 'form-grid';
  box.append(head);
  const num = control(head, 'Número', original?.numero, 'text', true);
  const date = control(head, 'Fecha', dayKey(original?.fechaTs) || (original ? '' : todayISO()), 'date', !original);
  const inputs = {};
  for (const [key, label] of Object.entries({cliente:'Cliente', direccion:'Dirección', vendedor:'Vendedor', sucursal:'Sucursal'})) {
    inputs[key] = control(head, label, original?.[key], 'text', key === 'cliente');
    if (fields[key]) attachList(box, inputs[key], key);
  }
  const lines = document.createElement('div');
  lines.className = 'order-lines';
  box.append(lines);
  const originalLines = original?.items.reduce((n, i) => n + i.total, 0);
  const totalOutput = $('editTotal');
  totalOutput.hidden = false;
  function readTotal(items) {
    const lineTotal = items.reduce((n, i) => n + (i.total || 0), 0);
    return original && roundMoney(originalLines) === roundMoney(lineTotal) ? original.monto : roundMoney(lineTotal);
  }
  function readLines() { return [...lines.children].map(row => row.getValue()); }
  function updateTotal() { totalOutput.value = 'Total ' + money(readTotal(readLines())); }
  function addLine(item = {}) {
    const row = document.createElement('fieldset');
    row.className = 'line-edit';
    const legend = document.createElement('legend');
    legend.textContent = item.codigo ? 'Producto · ' + item.codigo : 'Línea del pedido';
    row.append(legend);
    lines.append(row);
    const desc = control(row, 'Producto', item.descripcion, 'text', true);
    desc.parentElement.className = 'product-label';
    attachList(box, desc, 'producto');
    const units = control(row, 'Cantidad', item.cantidad ?? 1, 'number', true);
    const price = control(row, 'Precio (Q)', item.precio ?? '', 'number', true);
    const amount = control(row, 'Importe (Q)', item.total ?? '', 'number', true);
    for (const input of [units, price, amount]) input.inputMode = 'decimal';
    function compute() {
      amount.value = Number.isFinite(units.valueAsNumber * price.valueAsNumber)
        ? String(roundMoney(units.valueAsNumber * price.valueAsNumber)) : '';
      updateTotal();
    }
    units.oninput = price.oninput = compute;
    amount.oninput = updateTotal;
    row.getValue = () => ({...item, codigo:item.codigo || '', descripcion:cleanText(desc.value),
      cantidad:units.valueAsNumber, precio:price.valueAsNumber, total:amount.valueAsNumber});
    row.append(button('Quitar línea', () => { row.remove(); updateTotal(); add.focus(); }));
    return desc;
  }
  const add = button('Agregar línea', () => addLine().focus());
  for (const item of original?.items?.length ? original.items : [{}]) addLine(item);
  box.append(add);
  updateTotal();
  $('editTitle').tabIndex = -1;
  $('editTitle').autofocus = true;
  $('editor').showModal();
  $('editForm').onsubmit = event => {
    event.preventDefault();
    const numero = cleanText(num.value), items = readLines();
    if (!numero || !cleanText(inputs.cliente.value) || !items.length
        || items.some(i => !i.descripcion || ![i.cantidad, i.precio, i.total].every(Number.isFinite))) {
      $('editError').textContent = 'Completá el cliente y al menos una línea válida.';
      return;
    }
    if (state.quotes.some(q => q !== original && q.numero === numero)) {
      $('editError').textContent = 'Ya existe un pedido con ese número.';
      num.focus();
      return;
    }
    const q = {...original, id:original?.id || 'q_' + crypto.randomUUID(), numero,
      fecha:date.value ? dateText(date.value) : original?.fecha || '',
      fechaTs:date.value ? parseDate(date.value) : original?.fechaTs ?? null,
      items, monto:readTotal(items), createdAt:original?.createdAt || Date.now()};
    for (const key of Object.keys(inputs)) q[key] = cleanText(inputs[key].value);
    if (original && q.cliente !== original.cliente) q.clientCode = '';
    if (original && q.vendedor !== original.vendedor) q.vendedorCode = '';
    if (original) state.quotes[state.quotes.indexOf(original)] = q;
    else state.quotes.push(q);
    recordChange(original ? 'Editar pedido' : 'Crear pedido', q.numero);
    $('editor').close();
    saveState();
    viewOrder(q);
    $('mainContent').focus();
    toast('Pedido guardado.', 'ok');
  };
}
function attachList(box,input,key) {
  const id='list-'+key;
  if(!$(id)){const list=document.createElement('datalist');list.id=id;for(const n of catalogValues(key).keys())list.append(option(n));box.append(list);}
  input.setAttribute('list',id);
}
function reportRows(rows, key) {
  return groups(rows, key).sort((a, b) => key === 'dia' || key === 'mes'
    ? textOrder(a.name, b.name) : b.total - a.total);
}
function periodText(rows) {
  let first = '', last = '';
  for (const order of rows) {
    const day = dayKey(order.fechaTs);
    if (!day) continue;
    if (!first || day < first) first = day;
    if (day > last) last = day;
  }
  const from = $('from').value, to = $('to').value;
  if (from || to) return (from ? dateText(from) : 'Sin fecha inicial') + ' a ' + (to ? dateText(to) : 'Sin fecha final');
  return first ? (first === last ? dateText(first) : dateText(first) + ' a ' + dateText(last)) : 'Sin pedidos fechados';
}
function filterText(rows) {
  return [periodText(rows), $('dashSeller').value || 'Todos los vendedores',
    $('dashBranch').value || 'Todas las sucursales'].join(' · ');
}
function renderReport() {
  const key = $('reportGroup').value, rows = scopeRows(), list = reportRows(rows, key);
  $('reportScope').textContent = filterText(rows);
  table($('report'), [$('reportGroup').selectedOptions[0].text, 'Pedidos', 'Ventas', 'Promedio'],
    list.map(g => [g.name, g.orders, money(g.total), money(g.total / g.orders)]));
  const p = document.createElement('p');
  p.className = 'report-total';
  p.textContent = (demoMode ? 'Demostración · ' : '') + rows.length + ' pedidos · Total ' + money(sum(rows));
  $('report').append(p);
  if (key === 'producto' && rows.length) {
    const note = document.createElement('p');
    note.className = 'fine-print';
    note.textContent = 'Un pedido puede contar en varios productos. El total de pedidos cuenta cada pedido una sola vez.';
    $('report').append(note);
  }
  $('reportXls').disabled = $('reportPdf').disabled = !rows.length;
}

async function exportReport(format) {
  const key = $('reportGroup').value, rows = scopeRows();
  if (!rows.length) return;
  const title = (demoMode ? 'DEMOSTRACIÓN · ' : '') + 'Ventas por ' + $('reportGroup').selectedOptions[0].text.toLowerCase();
  const when = new Date().toLocaleDateString('es-GT'), scope = filterText(rows), total = sum(rows);
  const report = [...reportRows(rows, key), {name:'TOTAL', orders:rows.length, total}];
  if (format === 'xlsx') {
    await loadAsset('lib/xlsx.full.min.js');
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['EMA Enterprise',title],[scope],['Generado',when],[],
      ['Grupo','Pedidos','Ventas (Q)','Promedio (Q)'], ...report.map(g => [g.name,g.orders,g.total,roundMoney(g.total / g.orders)])]);
    sheet['!cols'] = [{wch:40},{wch:18},{wch:22},{wch:22}];
    for (let i = 6; i < 6 + report.length; i++) {
      for (const col of ['C', 'D']) sheet[col + i].z = '"Q" #,##0.00;[Red]-"Q" #,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, sheet, 'Resumen');
    const details = XLSX.utils.aoa_to_sheet([['Pedido','Fecha','Cliente','Vendedor','Sucursal','Ventas (Q)'],
      ...rows.map(q => [q.numero,q.fecha,q.cliente,q.vendedor,q.sucursal || '',q.monto])]);
    details['!cols'] = [20,14,32,28,24,19].map(wch => ({wch}));
    details['!autofilter'] = {ref:details['!ref']};
    for (let i = 2; i <= rows.length + 1; i++) details['F' + i].z = '"Q" #,##0.00';
    XLSX.utils.book_append_sheet(wb, details, 'Pedidos');
    downloadBlob(new Blob([XLSX.write(wb, {bookType:'xlsx',type:'array',compression:true})],
      {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), 'EMA-reporte.xlsx');
    return;
  }
  await loadAsset('lib/jspdf.umd.min.js');
  const doc = new window.jspdf.jsPDF();
  doc.setProperties({title, subject:scope, creator:'EMA Enterprise'});
  let y;
  function header() {
    doc.setFillColor(34,49,96);
    doc.rect(0,0,210,25,'F');
    doc.setTextColor(255);
    doc.setFont('helvetica','bold');
    doc.setFontSize(17);
    doc.text('EMA Enterprise',14,16);
    doc.setTextColor(23,35,61);
    doc.setFontSize(13);
    doc.text(title,14,35);
    doc.setFont('helvetica','normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(scope,182);
    doc.text(lines,14,42);
    y = 48 + lines.length * 4;
    doc.text('Generado ' + when,14,y);
    y += 7;
    doc.setFillColor(233,237,255);
    doc.rect(12,y - 4,186,8,'F');
    doc.text('Grupo',14,y + 1);
    doc.text('Pedidos',121,y + 1,{align:'right'});
    doc.text('Ventas',157,y + 1,{align:'right'});
    doc.text('Promedio',196,y + 1,{align:'right'});
    y += 10;
  }
  header();
  for (const [index, group] of report.entries()) {
    const lines = doc.splitTextToSize(group.name,94);
    const height = Math.max(7, lines.length * 4 + 3);
    if (y + height > 276) { doc.addPage(); header(); }
    const isTotal = index === report.length - 1;
    if (isTotal) doc.setFont('helvetica','bold');
    doc.text(lines,14,y);
    doc.text(String(group.orders),121,y,{align:'right'});
    doc.text(money(group.total),157,y,{align:'right'});
    doc.text(money(group.total / group.orders),196,y,{align:'right'});
    y += height;
  }
  doc.setFont('helvetica','normal');
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page);
    doc.text(page + ' / ' + doc.getNumberOfPages(),196,287,{align:'right'});
  }
  downloadBlob(doc.output('blob'), 'EMA-reporte.pdf');
}

function renderAssistant() {
  const rows = scopeRows(), months = monthly(rows), compared = comparison(months), question = $('question').value;
  const total = sum(rows), out = $('answer'), sources = $('answerSources');
  out.replaceChildren();
  sources.replaceChildren();
  const scope = document.createElement('p');
  scope.className = 'fine-print';
  scope.textContent = (demoMode ? 'Demostración · ' : '') + filterText(rows);
  sources.append(scope);
  function answer(text, evidence, name = 'Ver pedidos del cálculo') {
    const p = document.createElement('p');
    p.textContent = text;
    out.append(p);
    if (evidence?.length) {
      sources.append(button(name + ' (' + evidence.length + ')', () => showMatches(evidence, name)));
    }
  }
  if (!rows.length) { answer('La selección no contiene pedidos. Importá registros o ajustá los filtros.'); return; }
  if (question === 'comparar') {
    if (compared.reason) { answer(compared.reason); return; }
    answer(compared.last.name + ' registró ' + money(compared.last.total) + ' frente a ' + money(compared.prev.total)
      + ' en ' + compared.prev.name + '. Variación ' + qty(compared.change) + ' %.');
    for (const month of [compared.prev, compared.last]) {
      answer(month.name + ' · ' + month.orders + ' pedidos por ' + money(month.total) + '.',
        rows.filter(q => dayKey(q.fechaTs).startsWith(month.name)), 'Ver ' + month.name);
    }
  } else if (question === 'proyeccion') {
    const completed = months.filter(m => coversMonth(m.name)).slice(-3);
    const successive = completed.length === 3 && completed.every((m, i) => offsetMonth(completed[0].name, i) === m.name);
    if (!successive) { answer('Se necesitan tres meses cerrados y consecutivos con pedidos en la selección.'); return; }
    const next = offsetMonth(completed[2].name, 1);
    answer('Estimación para ' + next + ' de ' + money(completed.reduce((a, m) => a + m.total, 0) / 3)
      + '. Se usa el promedio simple de ' + completed.map(m => m.name).join(', ') + '.',
      rows.filter(q => completed.some(m => dayKey(q.fechaTs).startsWith(m.name))));
  } else if (question === 'calidad') {
    const amounts = rows.map(q => q.monto).sort((a,b) => a - b);
    const q1 = amounts[Math.floor((amounts.length - 1) * .25)], q3 = amounts[Math.floor((amounts.length - 1) * .75)];
    const incomplete = rows.filter(q => !q.cliente || !q.vendedor || !dayKey(q.fechaTs));
    const unbalanced = rows.filter(q => Math.abs(q.monto - q.items.reduce((a, i) => a + i.total, 0)) > .01);
    const atypical = rows.filter(q => q.monto < q1 - 1.5 * (q3 - q1) || q.monto > q3 + 1.5 * (q3 - q1));
    answer(incomplete.length + ' pedidos con datos incompletos de cliente, vendedor o fecha.', incomplete, 'Ver pedidos incompletos');
    answer(unbalanced.length + ' pedidos con diferencia entre el importe y la suma de líneas.', unbalanced, 'Ver diferencias');
    if (rows.length >= 8) answer(atypical.length + ' importes fuera de los límites de Tukey (1,5 veces el rango intercuartílico).', atypical, 'Ver importes atípicos');
    else answer('Se necesitan ocho pedidos para calcular importes atípicos.');
  } else {
    answer(rows.length + ' pedidos suman ' + money(total) + '. El ticket promedio es ' + money(total / rows.length)
      + ' y hay ' + countClients(rows) + ' clientes distintos.', rows);
    if (question === 'indicadores') {
      answer('Ventas suma los importes de los pedidos. El ticket divide ventas entre pedidos. El cliente se identifica por código cuando está disponible o por nombre.');
      return;
    }
    const leader = groups(rows.filter(q => q.vendedor), 'vendedor').sort((a,b) => b.total - a.total)[0];
    if (leader) answer(leader.name + ' registra el mayor importe por vendedor con ' + money(leader.total) + '.',
      rows.filter(q => q.vendedor === leader.name), 'Ver pedidos de ' + leader.name);
    else answer('Faltan vendedores asignados para comparar su rendimiento.');
  }
}
function renderAudit(){
  table($('auditLog'),['Fecha y hora','Operación','Detalle','Recuperación'],state.audit.filter(e=>e && typeof e==='object').map(e=>{
    const recover=e.removed && !state.quotes.some(q=>q.numero===e.removed.numero);
    return [new Date(e.time).toLocaleString('es-GT'),e.action,e.detail,recover?button('Recuperar',()=>{
      state.quotes.push(normalizeQuote(e.removed));delete e.removed;recordChange('Recuperar pedido',e.detail);saveState();renderHistory();renderQuote();
    }):'—'];
  }));
}
function searchTerms(term) {
  return cleanKey(term).split(' ').filter(Boolean);
}
function matchesOrder(order, terms) {
  const text = cleanKey([order.numero,order.cliente,order.clientCode,order.vendedor,order.vendedorCode,
    order.sucursal,order.direccion,order.archivo,...order.items.flatMap(i => [i.codigo,i.descripcion])].join(' '));
  return terms.every(term => text.includes(term));
}
let findRows = [];
function showMatches(rows, title = '', search = false) {
  findRows = rows;
  $('finderTitle').textContent = title || 'Buscar pedidos';
  $('findText').value = '';
  $('findText').hidden = !search;
  renderMatches(rows);
  if (!$('finder').open) $('finder').showModal();
  if (search) $('findText').focus();
}
function renderMatches(rows, limit = 50) {
  const box = $('found');
  box.replaceChildren();
  const p = document.createElement('p');
  p.textContent = rows.length + ' pedidos' + (rows.length > limit ? ' · primeros ' + limit : '');
  box.append(p);
  for (const q of rows.slice(0, limit)) box.append(button(
    [q.numero,q.fecha,q.cliente,money(q.monto)].filter(Boolean).join(' · '),
    () => { $('finder').close(); viewOrder(q); }));
  if (rows.length > limit) box.append(button('Mostrar 50 más', () => {
    renderMatches(rows, limit + 50);
    box.children[limit + 1].focus();
  }));
}
const mobileMenu = matchMedia('(max-width: 760px)');
function closeMobileMenu(restore = false) {
  const open = document.body.classList.contains('menu-open');
  document.body.classList.remove('menu-open');
  if (mobileMenu.matches) {
    $('menu').setAttribute('aria-expanded', 'false');
    $('rail').inert = true;
  }
  if (open && restore) $('menu').focus();
}
document.addEventListener('DOMContentLoaded',()=>{
  try{document.documentElement.dataset.theme=localStorage.getItem('ema-theme') || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}catch(_){}
  const theme = $('theme');
  const reflectTheme = () => theme.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
  reflectTheme();
  theme.onclick = () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    reflectTheme();
    try { localStorage.setItem('ema-theme',root.dataset.theme); } catch (_) {}
  };
  const syncMenu = () => {
    closeMobileMenu();
    $('rail').inert = mobileMenu.matches;
    if (!mobileMenu.matches) $('menu').setAttribute('aria-expanded', String(!document.body.classList.contains('rail-small')));
  };
  syncMenu();
  mobileMenu.addEventListener('change', syncMenu);
  $('menu').onclick = () => {
    if (!mobileMenu.matches) {
      const small = document.body.classList.toggle('rail-small');
      $('menu').setAttribute('aria-expanded', String(!small));
    } else if (document.body.classList.contains('menu-open')) {
      closeMobileMenu(true);
    } else {
      document.body.classList.add('menu-open');
      $('rail').inert = false;
      $('menu').setAttribute('aria-expanded', 'true');
      ($('rail').querySelector('[aria-current]') || $('rail').querySelector('button')).focus();
    }
  };
  $('scrim').onclick = () => closeMobileMenu(true);
  document.querySelector('.wordmark').onclick=e=>{e.preventDefault();setTab('resumen');};
  for(const id of ['from','to','dashSeller','dashBranch','chartMode','rankBy'])$(id).onchange=()=>{
    if($('from').value && $('to').value && $('from').value>$('to').value){toast('El inicio debe preceder al final del período.','err');$(id).value='';}renderSummary();
  };
  $('demo').onclick=()=>{demoMode=!demoMode;resetScope();renderSummary();};
  $('resetDash').onclick=()=>{resetScope();renderSummary();};
  $('seeOrders').onclick = () => showMatches(scopeRows(), 'Pedidos de la selección');
  $('quickOrder').onclick = $('newOrder').onclick = () => editOrder();
  $('newEntity').onclick=()=>editEntity();
  $('entityType').onchange=$('entitySearch').oninput=()=>{catalogLimit=100;renderCatalog();};
  $('reportGroup').onchange=renderReport;$('question').onchange=renderAssistant;
  $('reportFilters').onclick=()=>setTab('resumen');
  $('reportXls').onclick=()=>actionSafe(()=>exportReport('xlsx'),'Exportación');
  $('reportPdf').onclick=()=>actionSafe(()=>exportReport('pdf'),'Exportación');
  $('finder').addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      $('finder').close();
    }
  }, {capture:true});
  $('quickFind').onclick = $('globalSearch').onclick = () => showMatches(state.quotes, '', true);
  $('findText').oninput = () => { const terms = searchTerms($('findText').value); renderMatches(findRows.filter(q => matchesOrder(q, terms))); };
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('menu-open')) closeMobileMenu(true);
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.target.matches('input,textarea,select')
        && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      $('globalSearch').click();
    }
  });
  document.addEventListener('ema-change',()=>renderEnterprise());
  if('serviceWorker' in navigator && location.protocol!=='file:' && !window.AndroidBridge){
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      const offer=()=>{if(!reg.waiting || !navigator.serviceWorker.controller || $('updateShell'))return;
        const b = button('Actualizar EMA', async () => {
          if (cancelImport || document.querySelector('dialog[open]')) return;
          await saveQueue;
          if (storeConflict || $('systemStatusText').dataset.state === 'error') return;
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {once:true});
          reg.waiting?.postMessage({type:'SKIP_WAITING'});
        });
        b.id='updateShell';document.querySelector('.command').append(b);
      };
      offer();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offer));
    }).catch(()=>toast('Modo sin conexión no disponible en este navegador.'));
  }
});
