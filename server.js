'use strict';

/**
 * Thermatics Solar Quoting Calculator - public web app.
 * Wraps the audited calc-engine.js (replicated 1:1 from Solar Paybacks (3).xlsx,
 * with the U14/V14 bug fixed) and exposes:
 *   GET  /                    -> single-page calculator UI
 *   GET  /api/options         -> list of selectable system packages
 *   POST /api/quote           -> JSON quote for a selection + inputs
 *   GET  /healthz             -> health check
 *
 * Runs under PM2 as bot-19-thermatics-web on PORT (default 3027).
 */

const path = require('path');
const express = require('express');
const engine = require('./calc-engine.js');

const PORT = parseInt(process.env.THERMATICS_WEB_PORT || '3027', 10);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '5m',
  index: 'index.html',
}));

// Friendly labels for each selection (used by UI dropdown).
const OPTION_LABELS = {
  '10_panels_only':              '10 panels only',
  '12_panels_only':              '12 panels only',
  '14_panels_only':              '14 panels only',
  '16_panels_only':              '16 panels only',
  '18_panels_only':              '18 panels only',
  '10_panels_with_5_8kw_battery': '10 panels + 5.8 kWh battery',
  '12_panels_with_5_8kw_battery': '12 panels + 5.8 kWh battery',
  '14_panels_with_5_8kw_battery': '14 panels + 5.8 kWh battery',
  '16_panels_with_5_8kw_battery': '16 panels + 5.8 kWh battery',
  '18_panels_with_5_8kw_battery': '18 panels + 5.8 kWh battery',
};

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'thermatics-web', port: PORT });
});

app.get('/api/options', (_req, res) => {
  const list = Object.keys(engine.SYSTEM_PRICES).map((id) => ({
    id,
    label: OPTION_LABELS[id] || id,
    price: engine.SYSTEM_PRICES[id],
    panels: parseInt(id.match(/^(\d+)/)[1], 10),
    hasBattery: id.includes('battery'),
  }));
  res.json({
    options: list,
    defaults: engine.DEFAULT_INPUTS,
  });
});

function parseInputs(body) {
  const safeNum = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  };
  const d = engine.DEFAULT_INPUTS;
  return {
    peak_rate_per_kwh:            safeNum(body.peakRate,    d.peak_rate_per_kwh),
    off_peak_rate_per_kwh:        safeNum(body.offPeakRate, d.off_peak_rate_per_kwh),
    yearly_electricity_inflation: safeNum(body.inflation,   d.yearly_electricity_inflation),
    finance_apr:                  safeNum(body.apr,         d.finance_apr),
    finance_term_years:           Math.max(1, Math.round(safeNum(body.termYears, d.finance_term_years))),
  };
}

app.post('/api/quote', (req, res) => {
  try {
    const selection = String(req.body.selection || '').trim();
    if (!engine.SYSTEM_PRICES[selection]) {
      return res.status(400).json({ error: `Unknown selection: ${selection}` });
    }
    const inputs = parseInputs(req.body || {});
    const quote = engine.buildQuote(selection, inputs);

    // Build the 20-year cumulative chart series for the UI.
    const solar = engine.solarBlock(quote.panels, inputs);
    const battery = quote.hasBattery
      ? engine.batteryBlock(inputs)
      : { yearly: solar.yearly.map((y) => ({ year: y.year, value: 0 })) };

    let cumulative = 0;
    const chart = solar.yearly.map((s, i) => {
      const b = battery.yearly[i] ? battery.yearly[i].value : 0;
      cumulative += s.value + b;
      return {
        year: s.year,
        solar: s.value,
        battery: b,
        annual: s.value + b,
        cumulative,
      };
    });

    res.json({
      selection,
      label: OPTION_LABELS[selection],
      inputs,
      quote,
      chart,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Quote failed' });
  }
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[thermatics-web] listening on :${PORT}`);
});
