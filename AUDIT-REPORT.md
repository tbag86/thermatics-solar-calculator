# Solar Paybacks (3).xlsx - Audit and Replication Report
**Source file:** `2026-05-06-v1-Solar-Paybacks-3.xlsx`
**Audited:** 2026-05-06
**Auditor:** Thermatics calculator bot

---

## Top-line summary

| Item | Count |
| --- | ---: |
| Sheets | 3 (`INPUTS`, `Lists`, `Calculations`) |
| Filled cells | 737 |
| Formula cells | 572 |
| Named ranges | 0 |
| Volatile or external functions | 0 |
| Data validations (preserved by openpyxl) | 0 |
| Merged ranges | 12 (all label cells in Calculations) |

No `TODAY`, `NOW`, `RAND`, `INDIRECT`, `OFFSET`, hyperlinks, or external workbook references. The model is fully self-contained.

---

## Model overview

The spreadsheet quotes 10 packaged options and tracks a 20-year payback per option.

### Inputs (the user touches these)
- `INPUTS!A5` Peak electricity rate (£/kWh), default **0.23**
- `INPUTS!B5` Off-peak electricity rate (£/kWh), default **0.05**
- `INPUTS!A10` Selected option (one of 10 dropdown values)
- `INPUTS!B15` Finance APR, default **0.063** (6.3%)
- `INPUTS!C15` Finance term in years, default **5**

### Hard-coded constants (currently buried in cells, must surface as admin settings)
| Cell | Value | Meaning |
| --- | ---: | --- |
| `Calculations!C2` | 0.04 | Yearly electricity inflation (4%) |
| `Calculations!D5` | 1.0 | Year 1 panel performance |
| Row deltas | 0.4% then 0.5%/yr | Panel degradation curve |
| `Calculations!D27` | 1.0 | Year 1 battery performance |
| Row deltas | 0.2%/yr | Battery degradation |
| `Calculations!D28` | 0.9 | Battery cycling rate (90%) |
| `Calculations!D31` | 5.8 | Battery capacity (kWh) |
| `Calculations!D6,D10,D14,D18,D22` | 3071, 3623, 4176, 4728, 5295 | Year 1 generation per panel count (kWh) |
| `Lists!B2..B11` | 6500..12250 | System prices (£) |

### Outputs (driven by lookup against the `Lists` sheet)
- `INPUTS!B10` System cost
- `INPUTS!C10` 20-year generation value
- `INPUTS!D10` 20-year net return
- `INPUTS!E10` Year 1 saving
- `INPUTS!F10` Average monthly saving Year 1
- `INPUTS!A18..C18` Finance interest, total payable, monthly payment

---

## Calculation logic (formula by formula)

### Solar block (per panel-count)
For panel count `N` with `kwh_year1 = D6/D10/D14/D18/D22`:

```
performance[1] = 1
performance[2] = 1 - 0.4%
performance[i] = performance[i-1] - 0.5%   (for i >= 3)
kwh[i] = kwh_year1 * performance[i]
peakRate[1] = INPUTS!A5
peakRate[i] = peakRate[i-1] * (1 + 0.04)
yearlyValue[i] = kwh[i] * peakRate[i]
20-year saving = SUM(yearlyValue[1..20])
```

### Battery block
```
performance[1] = 1
performance[i] = performance[i-1] - 0.2%
peakRate[i]    = inflated 4%/yr from INPUTS!A5
offPeakRate[i] = inflated 4%/yr from INPUTS!B5
yearlyValue[i] = (peakRate[i] - offPeakRate[i]) * 5.8 * performance[i] * 0.9 * 365
20-year saving = SUM(yearlyValue[1..20])
```

### Finance block
```
Total Interest = PMT(APR/12, years*12, -cost) * years*12 - cost
Total Payable  = cost + Total Interest
Monthly        = Total Payable / (years*12)
```

### Quote summary (INPUTS rows 10)
Lookups against `Lists!A:I` use `XLOOKUP`.

---

## Bug found in source spreadsheet

**Cells `Calculations!U14` and `Calculations!V14` (the 14-panel kWh row, Years 18 and 19) have the wrong formula.**

| Cell | Current formula | Correct formula |
| --- | --- | --- |
| U14 | `=T14*U13` | `=$D$14*U13` |
| V14 | `=U14*V13` | `=$D$14*V13` |

Effect: kWh in Years 18 and 19 is compound-degraded twice instead of once, undershooting the figure by ~£412 over the 20-year window.

**Knock-on impact on Lists sheet:**
- `14 Panels Only` 20-year saving currently shown: £26,673.17 (correct: £27,085.73)
- `14 Panels & a 5.8kW Battery` total return understated by the same ~£412

This is exactly the failure mode the move to a coded calculator eliminates. The other panel counts (10, 12, 16, 18) are not affected and our JS replication matches their cached values to the penny.

---

## Replication and tests

JS engine: `calc-engine.js`
Test suite: `calc-engine.test.js`

```
21 passed, 0 failed
```

Tested figures match `Lists!C2..C11` and `Lists!I2..I11` exactly (£0.01 tolerance) for every panel count and the battery, plus the full INPUTS row 10 and finance row 18 values, plus all hard-coded prices.

The 14-panel 20-year figure intentionally diverges from the spreadsheet's cached value because the spreadsheet is wrong. The JS engine reports the correct compounded figure.

---

## Recommendations for the web app

1. **Surface every hard-coded cell as an admin setting**, including: electricity inflation, panel degradation curve, panel kWh by count, battery capacity, battery cycling rate, system prices.
2. **Postcode-driven kWh** via the PVGIS API (free EU service) replaces the static 3071/3623/etc. table. Per-property accuracy.
3. **MCS-style heat-loss calc** for the heat pump side (when source spreadsheet for that arrives).
4. **Branded PDF quote** generated server-side so every quote is auditable and shareable.
5. **Version-controlled pricing**: every price change becomes a tracked admin event with effective dates.
6. **Lead capture** at quote time, with integration to whatever CRM Thermatics uses.
7. **Mobile-first calculator UI** with sliders for panel count and battery, live updating on each change.
8. **Audit trail per quote** so the team can answer "what was promised on date X" instantly.

---

## File map

```
/opt/bots/bot-19/assets/source-xlsx/
  2026-05-06-v1-Solar-Paybacks-3.xlsx    # source, never edited
  2026-05-06-v1-audit.json               # full machine-readable audit dump
  2026-05-06-v1-audit-report.md          # this report
  calc-engine.js                         # JS replication of the model
  calc-engine.test.js                    # unit tests vs spreadsheet values
```
