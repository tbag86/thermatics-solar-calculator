// Thermatics quoting calculator - replicated from Solar Paybacks (3).xlsx
// Source: /opt/bots/bot-19/assets/source-xlsx/2026-05-06-v1-Solar-Paybacks-3.xlsx
// Author: Thermatics bot, 2026-05-06
//
// All formulas are reproduced from the spreadsheet. The 14-panel kWh degradation
// for Years 18 and 19 is fixed here (see U14/V14 anomaly note).

'use strict';

// -------- Hard-coded constants from the spreadsheet --------

// Lists!B column - system pricing (£) hard-coded in spreadsheet
const SYSTEM_PRICES = {
  '10_panels_only':              6500,
  '12_panels_only':              7250,
  '14_panels_only':              8000,
  '16_panels_only':              8750,
  '18_panels_only':              9500,
  '10_panels_with_5_8kw_battery': 9250,
  '12_panels_with_5_8kw_battery': 10000, // = 9250 + 750
  '14_panels_with_5_8kw_battery': 10750,
  '16_panels_with_5_8kw_battery': 11500,
  '18_panels_with_5_8kw_battery': 12250,
};

// Calculations sheet - Year 1 generation per panel-count (kWh)
// Cells D6, D10, D14, D18, D22
const PANEL_YEAR1_KWH = {
  10: 3071,
  12: 3623,
  14: 4176,
  16: 4728,
  18: 5295,
};

// Battery configuration (Calculations rows 27-32)
const BATTERY = {
  capacity_kwh:           5.8,    // D31 - hard-coded
  cycling_rate:           0.9,    // D28 - 90% utilisation
  performance_year1:      1.0,    // D27
  performance_decline:    0.002,  // 0.2% per year
  days_per_year:          365,
};

// Panel performance / degradation (Calculations row 5, 9, 13, 17, 21)
const PANEL_DEGRADATION = {
  year1:               1.0,
  year2_drop:          0.004, // 0.4% drop after year 1
  subsequent_drop:     0.005, // 0.5% drop each subsequent year
  total_years:         20,
};

// -------- Inputs (from INPUTS sheet) --------

const DEFAULT_INPUTS = {
  peak_rate_per_kwh:           0.23,  // INPUTS!A5
  off_peak_rate_per_kwh:       0.05,  // INPUTS!B5
  yearly_electricity_inflation: 0.04, // Calculations!C2
  finance_apr:                 0.063, // INPUTS!B15
  finance_term_years:          5,     // INPUTS!C15
};

// -------- Pure helpers --------

/** Build the 20-year panel performance curve. */
function panelPerformanceCurve() {
  const arr = [PANEL_DEGRADATION.year1];
  for (let i = 1; i < PANEL_DEGRADATION.total_years; i++) {
    const drop = i === 1 ? PANEL_DEGRADATION.year2_drop : PANEL_DEGRADATION.subsequent_drop;
    arr.push(arr[i - 1] - drop);
  }
  return arr;
}

/** Build the 20-year battery performance curve. */
function batteryPerformanceCurve() {
  const arr = [BATTERY.performance_year1];
  for (let i = 1; i < PANEL_DEGRADATION.total_years; i++) {
    arr.push(arr[i - 1] - BATTERY.performance_decline);
  }
  return arr;
}

/** Inflate a starting price across N years at compound rate r. Returns array. */
function inflatedRateCurve(startRate, inflation, years) {
  const arr = [startRate];
  for (let i = 1; i < years; i++) {
    arr.push(arr[i - 1] * (1 + inflation));
  }
  return arr;
}

/** Solar block: Year-1 kWh × performance × inflated peak rate, summed over 20y. */
function solarBlock(panelCount, inputs = DEFAULT_INPUTS) {
  const year1Kwh = PANEL_YEAR1_KWH[panelCount];
  if (year1Kwh == null) {
    throw new Error(`Unsupported panel count: ${panelCount}`);
  }
  const perf = panelPerformanceCurve();
  const peakRate = inflatedRateCurve(
    inputs.peak_rate_per_kwh,
    inputs.yearly_electricity_inflation,
    PANEL_DEGRADATION.total_years
  );

  const yearly = perf.map((p, i) => {
    const kwh = year1Kwh * p;
    const value = kwh * peakRate[i];
    return { year: i + 1, performance: p, kwh, peakRate: peakRate[i], value };
  });

  return {
    year1Saving: yearly[0].value,
    twentyYearSaving: yearly.reduce((s, y) => s + y.value, 0),
    yearly,
  };
}

/** Battery block: arbitrage of cycled kWh between peak and off-peak rates. */
function batteryBlock(inputs = DEFAULT_INPUTS) {
  const perf = batteryPerformanceCurve();
  const peakRate = inflatedRateCurve(
    inputs.peak_rate_per_kwh,
    inputs.yearly_electricity_inflation,
    PANEL_DEGRADATION.total_years
  );
  const offPeakRate = inflatedRateCurve(
    inputs.off_peak_rate_per_kwh,
    inputs.yearly_electricity_inflation,
    PANEL_DEGRADATION.total_years
  );

  const yearly = perf.map((p, i) => {
    // (peak - offpeak) * capacity_kwh * performance * cycling * 365
    const value =
      (peakRate[i] - offPeakRate[i]) *
      BATTERY.capacity_kwh *
      p *
      BATTERY.cycling_rate *
      BATTERY.days_per_year;
    return { year: i + 1, performance: p, peakRate: peakRate[i], offPeakRate: offPeakRate[i], value };
  });

  return {
    year1Saving: yearly[0].value,
    twentyYearSaving: yearly.reduce((s, y) => s + y.value, 0),
    yearly,
  };
}

/** Excel PMT(rate, nper, pv) - same sign convention as Excel.
 *  If pv > 0 (a debt to you) returns negative (you pay out).
 *  If pv < 0 (a loan to you) returns positive (you receive/pay positive).
 */
function pmt(rate, nper, pv) {
  if (rate === 0) return -pv / nper;
  const pvif = Math.pow(1 + rate, nper);
  return -(pv * rate * pvif) / (pvif - 1);
}

/** Finance breakdown using Excel PMT compounded monthly. */
function financeBlock(amount, aprDecimal, termYears) {
  const monthlyRate = aprDecimal / 12;
  const months = termYears * 12;
  // Mirror INPUTS!A18 = PMT(B15/12, C15*12, -A15) * C15*12 - A15
  const monthlyPayment = pmt(monthlyRate, months, -amount); // positive
  const totalPayable = monthlyPayment * months;
  const totalInterest = totalPayable - amount;
  return { amount, aprDecimal, termYears, monthlyPayment, totalPayable, totalInterest };
}

/** Build a full quote for a given selection. */
function buildQuote(selection, inputs = DEFAULT_INPUTS) {
  const price = SYSTEM_PRICES[selection];
  if (price == null) throw new Error(`Unknown selection: ${selection}`);

  const panelMatch = selection.match(/^(\d+)_panels/);
  const hasBattery = selection.includes('battery');
  const panels = panelMatch ? parseInt(panelMatch[1], 10) : 0;

  const solar = solarBlock(panels, inputs);
  const battery = hasBattery ? batteryBlock(inputs) : { year1Saving: 0, twentyYearSaving: 0, yearly: [] };

  const total20yearValue = solar.twentyYearSaving + battery.twentyYearSaving;
  const net20yearReturn = total20yearValue - price;
  const year1Total = solar.year1Saving + battery.year1Saving;
  const monthlyAvgYear1 = year1Total / 12;

  return {
    selection,
    panels,
    hasBattery,
    cost: price,
    twentyYear: {
      solarValue: solar.twentyYearSaving,
      batteryValue: battery.twentyYearSaving,
      totalValue: total20yearValue,
      netReturn: net20yearReturn,
    },
    year1: {
      solarSaving: solar.year1Saving,
      batterySaving: battery.year1Saving,
      totalSaving: year1Total,
      avgMonthlySaving: monthlyAvgYear1,
    },
    finance: financeBlock(price, inputs.finance_apr, inputs.finance_term_years),
  };
}

module.exports = {
  SYSTEM_PRICES,
  PANEL_YEAR1_KWH,
  BATTERY,
  PANEL_DEGRADATION,
  DEFAULT_INPUTS,
  panelPerformanceCurve,
  batteryPerformanceCurve,
  inflatedRateCurve,
  solarBlock,
  batteryBlock,
  pmt,
  financeBlock,
  buildQuote,
};
