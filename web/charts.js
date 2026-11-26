/* EMA Enterprise · gráficos accesibles dibujados con datos locales. */
(() => {
  'use strict';

  const svgNS = 'http://www.w3.org/2000/svg';
  const money = new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' });
  const compact = new Intl.NumberFormat('es-GT', { notation: 'compact', maximumFractionDigits: 1 });
  const monthFormat = new Intl.DateTimeFormat('es-GT', { month: 'short', timeZone: 'UTC' });
  const colors = ['#6478ed', '#27a48b', '#da934c', '#a37bd6', '#4f94c6', '#d57591'];
  const pendingResizes = new WeakMap();
  let sequence = 0;

  function html(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function svg(tag, attributes = {}, text) {
    const element = document.createElementNS(svgNS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function entries(input) {
    return (Array.isArray(input) ? input : []).filter(row =>
      Array.isArray(row) && typeof row[0] === 'string' && row[0].trim() && Number.isFinite(row[1]));
  }
  function begin(container) {
    pendingResizes.get(container)?.disconnect();
    pendingResizes.delete(container);
    container.replaceChildren();
  }
  function empty(container, message) {
    const wrap = html('div');
    wrap.className = 'chart-empty';
    Object.assign(wrap.style, { display: 'grid', minHeight: '145px', alignContent: 'center',
      justifyItems: 'center', gap: '8px', textAlign: 'center', color: 'inherit' });
    const icon = svg('svg', { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', opacity: '.56', 'stroke-width': 1.5, 'aria-hidden': 'true' });
    icon.append(svg('path', { d: 'M4 3v17h17M8 14l4-5 4 3 5-7' }));
    wrap.append(icon, html('span', message));
    container.append(wrap);
  }
  function monthLabel(key, showYear = true) {
    const [year, month] = key.split('-').map(Number);
    const short = monthFormat.format(new Date(Date.UTC(year, month - 1, 1))).replace(/\.$/, '');
    return showYear ? short + ' ' + year : short;
  }

  function drawTrend(container, monthly, mode = 'area', onSelectMonth) {
    begin(container);
    const rows = entries(monthly).filter(([key]) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    if (!rows.length) {
      empty(container, 'Sin ventas fechadas para este período.');
      return;
    }
    const figure = html('figure');
    Object.assign(figure.style, { margin: '0', width: '100%' });
    const caption = html('figcaption');
    Object.assign(caption.style, { fontSize: '.875rem', paddingTop: '.35rem', minHeight: '1.75rem' });
    const defaultCaption = 'Ventas mensuales · GTQ';
    caption.textContent = defaultCaption;
    const frame = svg('svg', { width: '100%', height: 184, role: 'group', 'aria-label': 'Ventas mensuales en quetzales' });
    frame.style.display = 'block';
    const gradientId = 'ema-trend-fill-' + (++sequence);
    const interactive = typeof onSelectMonth === 'function';
    const upper = rows.reduce((max, row) => Math.max(row[1], max), 0);
    const lower = rows.reduce((min, row) => Math.min(row[1], min), 0);
    const high = upper === lower ? upper + 1 : upper;
    let lastWidth = 0;

    function render() {
      const width = Math.max(250, Math.floor(container.getBoundingClientRect().width || 570));
      if (width === lastWidth) return;
      lastWidth = width;
      frame.setAttribute('viewBox', '0 0 ' + width + ' 184');
      frame.replaceChildren();
      const defs = svg('defs');
      const gradient = svg('linearGradient', { id: gradientId, x1: '0%', x2: '0%', y1: '0%', y2: '100%' });
      gradient.append(svg('stop', { offset: '0%', 'stop-color': colors[0], 'stop-opacity': .30 }),
        svg('stop', { offset: '100%', 'stop-color': colors[0], 'stop-opacity': .025 }));
      defs.append(gradient);
      frame.append(defs);
      const left = 53, right = width - 19, bottom = 148, top = 14;
      const y = value => bottom - (value - lower) / (high - lower) * (bottom - top);
      const step = (right - left) / rows.length;
      const x = i => left + (i + .5) * step;
      const yZero = y(0);
      for (let tick = 0; tick <= 4; tick++) {
        const val = lower + (high - lower) * tick / 4;
        frame.append(svg('line', { x1: left, x2: right, y1: y(val), y2: y(val),
          stroke: 'currentColor', 'stroke-opacity': tick === 0 ? .19 : .11, 'stroke-dasharray': tick === 0 ? 'none' : '4 5' }));
        frame.append(svg('text', { x: left - 7, y: y(val) + 4, 'text-anchor': 'end',
          fill: 'currentColor', opacity: .78, 'font-size': 11 }, compact.format(val)));
      }
      const points = rows.map(([, amount], i) => x(i) + ',' + y(amount));
      if (mode !== 'barras') {
        if (mode !== 'linea' && rows.length > 1) frame.append(svg('path', {
          d: 'M' + x(0) + ',' + yZero + ' L' + points.join(' L') + ' L' + x(rows.length - 1) + ',' + yZero + ' Z',
          fill: 'url(#' + gradientId + ')' }));
        frame.append(svg('polyline', { points: points.join(' '), fill: 'none',
          stroke: colors[0], 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
      const labelBudget = Math.max(2, Math.floor((right - left) / 55));
      const labelStep = Math.ceil(rows.length / labelBudget);
      const groups = [];
      rows.forEach(([month, amount], index) => {
        const label = monthLabel(month) + ' · ' + money.format(amount);
        const group = svg('g', { role: interactive ? 'button' : 'img', tabindex: index === 0 ? 0 : -1,
          'aria-label': label, 'data-month': month });
        const cursor = x(index);
        const point = y(amount);
        const barWidth = Math.min(36, step * .64);
        group.style.cursor = interactive ? 'pointer' : 'default';
        group.append(svg('title', {}, label));
        if (mode === 'barras') group.append(svg('rect', { x: cursor - barWidth / 2, y: Math.min(point, yZero),
          width: barWidth, height: Math.max(1, Math.abs(point - yZero)), rx: 2, fill: colors[0] }));
        else group.append(svg('circle', { cx: cursor, cy: point, r: rows.length > 36 ? 2 : 3.8,
          fill: colors[0], stroke: 'white', 'stroke-width': 1.1 }));
        group.append(svg('rect', { x: cursor - step / 2, y: top, width: step, height: bottom - top,
          fill: 'transparent' }));
        if (index % labelStep === 0) frame.append(svg('text', { x: cursor, y: bottom + 23, fill: 'currentColor',
          'text-anchor': 'middle', 'font-size': 11, opacity: .79 },
          monthLabel(month, rows[0][0].slice(0, 4) !== rows[rows.length - 1][0].slice(0, 4))));
        const show = () => { caption.textContent = label; };
        const hide = () => { if (document.activeElement !== group) caption.textContent = defaultCaption; };
        group.addEventListener('pointerenter', show);
        group.addEventListener('pointerleave', hide);
        group.addEventListener('focus', () => {
          groups.forEach(item => item.setAttribute('tabindex', item === group ? '0' : '-1'));
          show();
        });
        group.addEventListener('blur', () => { caption.textContent = defaultCaption; });
        group.addEventListener('click', () => { show(); if (interactive) onSelectMonth(month); });
        group.addEventListener('keydown', event => {
          let next = index;
          if (event.key === 'ArrowLeft') next = Math.max(0, index - 1);
          else if (event.key === 'ArrowRight') next = Math.min(rows.length - 1, index + 1);
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = rows.length - 1;
          else if (interactive && [' ', 'Enter'].includes(event.key)) {
            event.preventDefault();
            onSelectMonth(month);
            return;
          } else return;
          event.preventDefault();
          groups[next].focus();
        });
        groups.push(group);
        frame.append(group);
      });
    }
    figure.append(frame, caption);
    container.append(figure);
    render();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(render);
      observer.observe(container);
      pendingResizes.set(container, observer);
    }
  }

  function drawRanking(container, ranked, mode = 'barras', onSelectLabel) {
    begin(container);
    const rows = entries(ranked);
    if (!rows.length) {
      empty(container, 'Sin registros para esta clasificación.');
      return;
    }
    const figure = html('figure');
    figure.style.margin = '0';
    const list = html('ul');
    list.setAttribute('aria-label', 'Clasificación por ventas en quetzales');
    Object.assign(list.style, { listStyle: 'none', margin: '0', padding: '0', display: 'grid', gap: '.4rem' });
    const upper = rows.reduce((max, row) => Math.max(max, row[1]), 0);
    const lower = rows.reduce((min, row) => Math.min(min, row[1]), 0);
    const range = upper - lower || 1;
    const total = rows.reduce((sum, row) => sum + row[1], 0);
    const donut = mode === 'anillo' && lower === 0 && total > 0;
    const interactive = typeof onSelectLabel === 'function';
    let ring, offset = 0;
    if (donut) {
      ring = svg('svg', { viewBox: '0 0 180 140', width: '100%', height: 140, role: 'img',
        'aria-label': 'Distribución de ventas. Total ' + money.format(total) });
      ring.append(svg('text', { x: 90, y: 66, 'text-anchor': 'middle', fill: 'currentColor',
        'font-size': 10, 'letter-spacing': 1 }, 'TOTAL GTQ'),
        svg('text', { x: 90, y: 85, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 16,
          'font-weight': 700 }, compact.format(total)));
      figure.append(ring);
    } else if (mode === 'anillo') {
      figure.append(html('figcaption', lower < 0 ? 'Ventas netas con valores negativos' : 'Ventas registradas en cero'));
    }
    for (const [i, [label, amount]] of rows.entries()) {
      const color = colors[i % colors.length];
      const detail = label + ' · ' + money.format(amount);
      const item = html('li');
      const row = html(interactive ? 'button' : 'div');
      Object.assign(row.style, { padding: '.3rem .15rem', width: '100%', border: '0', borderRadius: '4px',
        background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'start',
        cursor: interactive ? 'pointer' : 'default', display: 'grid', gap: '.32rem' });
      row.title = detail;
      if (interactive) {
        row.type = 'button';
        row.setAttribute('aria-label', 'Filtrar por ' + detail);
        row.addEventListener('click', () => onSelectLabel(label));
      }
      const head = html('span');
      Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', gap: '.75rem',
        alignItems: 'baseline', fontSize: '.9rem' });
      const title = html('span', label);
      Object.assign(title.style, { overflowWrap: 'anywhere', minWidth: '0' });
      const value = html('strong', money.format(amount));
      Object.assign(value.style, { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
      if (donut) {
        const key = html('span');
        Object.assign(key.style, { display: 'inline-block', width: '.65rem', height: '.65rem',
          borderRadius: '50%', background: color, marginInlineEnd: '.5rem' });
        title.prepend(key);
        const fraction = amount / total * 100;
        if (fraction > 0) {
          const arc = svg('circle', { cx: 90, cy: 70, r: 55, fill: 'none', stroke: color, 'stroke-width': 14,
            pathLength: 100, 'stroke-dasharray': fraction + ' ' + (100 - fraction),
            'stroke-dashoffset': -offset, transform: 'rotate(-90 90 70)' });
          arc.append(svg('title', {}, detail + ' (' + (Math.round(fraction * 10) / 10) + '%)'));
          if (interactive) {
            arc.style.cursor = 'pointer';
            arc.addEventListener('click', () => onSelectLabel(label));
          }
          ring.append(arc);
          offset += fraction;
        }
      }
      head.append(title, value);
      row.append(head);
      if (!donut) {
        const bar = svg('svg', { width: '100%', height: 6, viewBox: '0 0 100 6',
          preserveAspectRatio: 'none', 'aria-hidden': 'true' });
        bar.append(svg('rect', { width: 100, height: 6, rx: 1, fill: 'currentColor', opacity: .09 }),
          svg('rect', { x: (Math.min(0, amount) - lower) / range * 100, y: 0,
            width: Math.abs(amount) / range * 100, height: 6, rx: 1, fill: color }));
        row.append(bar);
      }
      item.append(row);
      list.append(item);
    }
    figure.append(list);
    container.append(figure);
  }
  window.drawTrend = drawTrend;
  window.drawRanking = drawRanking;
})();
