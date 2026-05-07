'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  const fmtGBP = (v, opts = {}) => {
    const o = Object.assign({ maximumFractionDigits: 0 }, opts);
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      maximumFractionDigits: o.maximumFractionDigits,
      minimumFractionDigits: o.maximumFractionDigits >= 2 ? 2 : 0,
    }).format(v);
  };

  let optionsCache = [];
  let lastQuote = null;
  let chartCanvas = null;
  let chartCtx = null;
  let pendingFetch = null;
  let debounceTimer = null;

  // ---------- bootstrap ----------
  document.addEventListener('DOMContentLoaded', async () => {
    chartCanvas = $('chart');
    chartCtx = chartCanvas.getContext('2d');

    // Re-render chart at correct DPR on resize.
    window.addEventListener('resize', () => {
      if (lastQuote) drawChart(lastQuote);
    });

    try {
      const r = await fetch('/api/options');
      const data = await r.json();
      optionsCache = data.options || [];
      populateSelect(optionsCache);
      // Default to a popular option (14 panels + battery).
      const defaultId = '14_panels_with_5_8kw_battery';
      $('selection').value = optionsCache.find((o) => o.id === defaultId) ? defaultId : optionsCache[0].id;
      updateSelectionMeta();
      requestQuote();
    } catch (err) {
      console.error('Failed to load options', err);
      $('result-sub').textContent = 'Could not load options. Reload the page.';
    }

    // Wire inputs.
    ['selection', 'peakRate', 'offPeakRate', 'inflationPct', 'aprPct', 'termYears'].forEach((id) => {
      const el = $(id);
      el.addEventListener('input', () => {
        if (id === 'selection') updateSelectionMeta();
        scheduleQuote();
      });
      el.addEventListener('change', () => {
        if (id === 'selection') updateSelectionMeta();
        scheduleQuote();
      });
    });

    $('reset-btn').addEventListener('click', () => {
      $('peakRate').value = '0.23';
      $('offPeakRate').value = '0.05';
      $('inflationPct').value = '4';
      $('aprPct').value = '6.3';
      $('termYears').value = '5';
      requestQuote();
    });
  });

  function populateSelect(options) {
    const sel = $('selection');
    sel.innerHTML = '';
    const noBattery = options.filter((o) => !o.hasBattery);
    const withBattery = options.filter((o) => o.hasBattery);

    const g1 = document.createElement('optgroup');
    g1.label = 'Solar only';
    noBattery.forEach((o) => g1.appendChild(buildOption(o)));
    sel.appendChild(g1);

    const g2 = document.createElement('optgroup');
    g2.label = 'Solar + 5.8 kWh battery';
    withBattery.forEach((o) => g2.appendChild(buildOption(o)));
    sel.appendChild(g2);
  }

  function buildOption(o) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = `${o.label} (${fmtGBP(o.price)})`;
    return opt;
  }

  function updateSelectionMeta() {
    const id = $('selection').value;
    const o = optionsCache.find((x) => x.id === id);
    if (!o) return;
    $('selection-meta').textContent =
      `${o.panels} panel system${o.hasBattery ? ' with a 5.8 kWh battery' : ''}. List price ${fmtGBP(o.price)}.`;
  }

  // ---------- request flow ----------
  function scheduleQuote() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(requestQuote, 120);
  }

  async function requestQuote() {
    const body = {
      selection:    $('selection').value,
      peakRate:     parseFloat($('peakRate').value),
      offPeakRate:  parseFloat($('offPeakRate').value),
      inflation:    parseFloat($('inflationPct').value) / 100,
      apr:          parseFloat($('aprPct').value) / 100,
      termYears:    parseInt($('termYears').value, 10),
    };

    if (pendingFetch) pendingFetch.abort();
    const ctrl = new AbortController();
    pendingFetch = ctrl;

    try {
      const r = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      lastQuote = data;
      render(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error(err);
      $('result-sub').textContent = 'Could not calculate. Check your inputs.';
    } finally {
      pendingFetch = null;
    }
  }

  // ---------- render ----------
  function render(data) {
    const q = data.quote;
    $('result-title').textContent = data.label;
    $('result-sub').textContent = `Numbers based on a ${(data.inputs.peak_rate_per_kwh).toFixed(3)} £/kWh peak rate and ${(data.inputs.yearly_electricity_inflation * 100).toFixed(1)}% annual electricity price increase.`;

    $('badge-net').textContent = fmtGBP(q.twentyYear.netReturn);
    $('result-badge').hidden = false;

    $('kpi-cost').textContent = fmtGBP(q.cost);
    $('kpi-year1').textContent = fmtGBP(q.year1.totalSaving);
    $('kpi-monthly').textContent = `${fmtGBP(q.year1.avgMonthlySaving)}/mo average`;
    $('kpi-twenty').textContent = fmtGBP(q.twentyYear.totalValue);

    const payback = findPayback(data.chart, q.cost);
    $('kpi-payback').textContent = payback ? `Payback in ~${payback} years` : 'Payback in 20+ years';

    $('fin-monthly').textContent = fmtGBP(q.finance.monthlyPayment, { maximumFractionDigits: 2 });
    $('fin-total').textContent = fmtGBP(q.finance.totalPayable, { maximumFractionDigits: 2 });
    $('fin-interest').textContent = fmtGBP(q.finance.totalInterest, { maximumFractionDigits: 2 });

    renderTable(data.chart);
    drawChart(data);
  }

  function findPayback(chart, cost) {
    for (let i = 0; i < chart.length; i++) {
      if (chart[i].cumulative >= cost) {
        if (i === 0) return 1;
        const prev = chart[i - 1];
        const cur = chart[i];
        const delta = cur.cumulative - prev.cumulative;
        if (delta <= 0) return cur.year;
        const frac = (cost - prev.cumulative) / delta;
        return (prev.year + frac).toFixed(1);
      }
    }
    return null;
  }

  function renderTable(chart) {
    const tbody = document.querySelector('#year-table tbody');
    tbody.innerHTML = '';
    for (const row of chart) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>Year ${row.year}</td>
        <td>${fmtGBP(row.solar)}</td>
        <td>${row.battery ? fmtGBP(row.battery) : '—'}</td>
        <td>${fmtGBP(row.annual)}</td>
        <td>${fmtGBP(row.cumulative)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // ---------- chart ----------
  function drawChart(data) {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = chartCanvas.clientWidth;
    const cssHeight = Math.max(220, Math.min(360, Math.round(cssWidth * 0.42)));
    chartCanvas.width = Math.round(cssWidth * dpr);
    chartCanvas.height = Math.round(cssHeight * dpr);
    chartCanvas.style.height = cssHeight + 'px';
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = cssWidth;
    const H = cssHeight;
    const pad = { l: 56, r: 16, t: 16, b: 36 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;

    const chart = data.chart;
    const cost = data.quote.cost;
    const maxY = Math.max(cost, chart[chart.length - 1].cumulative) * 1.08;
    const minY = 0;
    const years = chart.length;

    const xFor = (i) => pad.l + (i / (years - 1)) * innerW;
    const yFor = (v) => pad.t + (1 - (v - minY) / (maxY - minY)) * innerH;

    chartCtx.clearRect(0, 0, W, H);

    // Y axis grid.
    chartCtx.strokeStyle = '#e2e6ef';
    chartCtx.fillStyle = '#5b6781';
    chartCtx.font = '12px system-ui, -apple-system, sans-serif';
    chartCtx.lineWidth = 1;
    const ticks = 5;
    for (let t = 0; t <= ticks; t++) {
      const v = minY + ((maxY - minY) * t) / ticks;
      const y = yFor(v);
      chartCtx.beginPath();
      chartCtx.moveTo(pad.l, y);
      chartCtx.lineTo(W - pad.r, y);
      chartCtx.stroke();
      chartCtx.textAlign = 'right';
      chartCtx.textBaseline = 'middle';
      chartCtx.fillText(`£${shortMoney(v)}`, pad.l - 8, y);
    }

    // X axis labels (every 5 years + first/last).
    chartCtx.textAlign = 'center';
    chartCtx.textBaseline = 'top';
    for (let i = 0; i < years; i++) {
      if (i === 0 || (i + 1) % 5 === 0 || i === years - 1) {
        chartCtx.fillText(`Y${i + 1}`, xFor(i), H - pad.b + 8);
      }
    }

    // System cost reference line.
    const yCost = yFor(cost);
    chartCtx.strokeStyle = '#c43d3d';
    chartCtx.setLineDash([6, 5]);
    chartCtx.lineWidth = 1.5;
    chartCtx.beginPath();
    chartCtx.moveTo(pad.l, yCost);
    chartCtx.lineTo(W - pad.r, yCost);
    chartCtx.stroke();
    chartCtx.setLineDash([]);
    chartCtx.fillStyle = '#c43d3d';
    chartCtx.textAlign = 'left';
    chartCtx.textBaseline = 'bottom';
    chartCtx.fillText(`System cost ${fmtGBPShort(cost)}`, pad.l + 6, yCost - 4);

    // Cumulative savings area + line.
    const grad = chartCtx.createLinearGradient(0, pad.t, 0, pad.t + innerH);
    grad.addColorStop(0, 'rgba(28,109,208,0.28)');
    grad.addColorStop(1, 'rgba(28,109,208,0.02)');
    chartCtx.fillStyle = grad;
    chartCtx.beginPath();
    chartCtx.moveTo(xFor(0), yFor(0));
    chart.forEach((p, i) => chartCtx.lineTo(xFor(i), yFor(p.cumulative)));
    chartCtx.lineTo(xFor(years - 1), yFor(0));
    chartCtx.closePath();
    chartCtx.fill();

    chartCtx.strokeStyle = '#1c6dd0';
    chartCtx.lineWidth = 2.5;
    chartCtx.beginPath();
    chart.forEach((p, i) => {
      const x = xFor(i), y = yFor(p.cumulative);
      if (i === 0) chartCtx.moveTo(x, y); else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();

    // Payback marker.
    let paybackIdx = -1;
    for (let i = 0; i < chart.length; i++) {
      if (chart[i].cumulative >= cost) { paybackIdx = i; break; }
    }
    if (paybackIdx >= 0) {
      let x;
      if (paybackIdx === 0) x = xFor(0);
      else {
        const prev = chart[paybackIdx - 1];
        const cur = chart[paybackIdx];
        const frac = (cost - prev.cumulative) / (cur.cumulative - prev.cumulative);
        x = xFor((paybackIdx - 1) + frac);
      }
      // Vertical guide.
      chartCtx.strokeStyle = 'rgba(245,179,1,0.6)';
      chartCtx.lineWidth = 1.5;
      chartCtx.setLineDash([4, 4]);
      chartCtx.beginPath();
      chartCtx.moveTo(x, pad.t);
      chartCtx.lineTo(x, H - pad.b);
      chartCtx.stroke();
      chartCtx.setLineDash([]);
      // Dot.
      chartCtx.fillStyle = '#f5b301';
      chartCtx.strokeStyle = '#3a2900';
      chartCtx.lineWidth = 2;
      chartCtx.beginPath();
      chartCtx.arc(x, yCost, 7, 0, Math.PI * 2);
      chartCtx.fill();
      chartCtx.stroke();
    }
  }

  function shortMoney(v) {
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
    return Math.round(v).toString();
  }
  function fmtGBPShort(v) {
    return '£' + shortMoney(v);
  }
})();
