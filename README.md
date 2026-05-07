# Thermatics Solar Calculator

A fully responsive web calculator that replaces the Thermatics solar PV quoting spreadsheet (`Solar Paybacks (3).xlsx`).

The calculator is powered by `calc-engine.js`, a 1:1 JavaScript replication of every formula in the source spreadsheet, audited and unit-tested cell by cell. See `AUDIT-REPORT.md` for the full audit.

## Why an app over the spreadsheet

- Live cloud access from any device. No file passing back and forth.
- Formulas are locked in code. No accidental edits, no broken references.
- Mobile and tablet friendly UI, 44px touch targets, 16px iOS inputs.
- Instant quote with a custom Canvas chart that renders the cumulative saving curve and payback marker.
- Fixes a real bug in the source spreadsheet (`Calculations!U14` and `V14` reference the previous year's value instead of the base Year 1 kWh, which compound-degrades twice). The 14-panel quotes were understated by about £412 over 20 years. The app gives the correct number.
- Single source of truth for pricing, inflation, panel performance, and battery cycling. Easy to expose as admin settings later.

## Quick start

```bash
npm install
npm start            # boots Express on PORT 3027 (override with THERMATICS_WEB_PORT)
npm test             # runs the engine unit tests against the spreadsheet's cached values
```

Open `http://localhost:3027/` in a browser.

The HTML, CSS and JS use relative URLs, so the app also works when reverse-proxied at a sub-path (for example `https://example.com/thermatics/`).

## Live URL

The production deployment runs on the Hetzner VPS and is reverse-proxied through nginx at:

`http://46.225.129.231/thermatics/`

The raw Express port (3027) is blocked by the Hetzner cloud firewall, so use the `/thermatics/` path.

## API

| Method | Path           | Description                                       |
| ------ | -------------- | ------------------------------------------------- |
| GET    | `/`            | Calculator UI (single page)                       |
| GET    | `/healthz`     | Health check, returns `{ ok: true }`              |
| GET    | `/api/options` | List of selectable system packages                |
| POST   | `/api/quote`   | JSON quote for a `selection` + optional `inputs`  |

### Example quote request

```bash
curl -sS http://localhost:3027/api/quote \
  -H 'Content-Type: application/json' \
  -d '{
        "selection": "14_panels_only",
        "inputs": {
          "peakRate": 0.27,
          "offPeakRate": 0.07,
          "annualInflation": 0.04,
          "aprPercent": 8.9,
          "termYears": 10
        }
      }'
```

## Project layout

```
.
+-- server.js              Express app
+-- calc-engine.js         Audited replication of every spreadsheet formula
+-- calc-engine.test.js    Unit tests against the spreadsheet's cached values (21 / 21 pass)
+-- public/
|   +-- index.html         Single-page UI
|   +-- styles.css         Responsive design tokens, fluid typography
|   +-- app.js             Vanilla JS, debounced inputs, AbortController, custom Canvas chart
+-- AUDIT-REPORT.md        Full spreadsheet audit
+-- package.json
+-- .gitignore
```

## Engine inputs

| Field             | Default | Notes                                                    |
| ----------------- | ------- | -------------------------------------------------------- |
| `peakRate`        | 0.23    | £ per kWh peak                                           |
| `offPeakRate`     | 0.07    | £ per kWh off-peak (used for battery savings)            |
| `annualInflation` | 0.04    | 4% per year electricity price inflation                  |
| `aprPercent`      | 8.9     | Finance APR                                              |
| `termYears`       | 10      | Finance term                                             |

The 10 packaged options live under `engine.OPTIONS`. Each carries a fixed price and a Year 1 kWh figure (panel count specific). All other figures are derived.

## Hosting

The production app runs on a Hetzner VPS under PM2 as `bot-19-thermatics-web`. Open the firewall on the chosen port (UFW + Hetzner cloud firewall) and use a reverse proxy with TLS for a public domain.

## License

Internal Thermatics project. Not for public redistribution.
