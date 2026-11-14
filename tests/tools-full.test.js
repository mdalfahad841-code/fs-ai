// FS AI — FULL regression tests for all 20 free tools.
//
// Executes the SHIPPED frontend/scripts/tools.js (via vm with browser stubs),
// never a re-implementation of the formulas. Every tool is covered with:
//   (a) normal inputs checked against hand-computed values,
//   (b) empty inputs, (c) invalid inputs, (d) boundary values.
// Plus form-rendering, submit-handler, reset and mobile-scroll tests using a
// minimal in-test DOM shim (no jsdom dependency — zero-cost).
//
// Run: node --test tests/tools-full.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TOOLS_PATH = path.join(__dirname, '..', 'frontend', 'scripts', 'tools.js');
const TOOLS_SRC = fs.readFileSync(TOOLS_PATH, 'utf8');

const EXPECTED_IDS = [
  'fuel-cost', 'mileage', 'maintenance-planner', 'tyre-pressure',
  'monthly-budget', 'savings', 'loan-payment', 'currency-converter',
  'storage-converter', 'internet-speed', 'data-unit', 'file-size',
  'travel-budget', 'distance-planner', 'trip-cost', 'age-calculator',
  'percentage', 'date-calculator', 'unit-converter', 'time-calculator',
];

/* ------------------------------------------------------------------ */
/* Loader: run the shipped tools.js in a vm sandbox.                   */
/* ------------------------------------------------------------------ */
function loadTools(documentStub) {
  const sandbox = {
    window: {
      FSAI: { esc: (s) => String(s == null ? '' : s), TOOLS: [] },
      location: { search: '' },
      history: { replaceState: () => {} },
    },
    document: documentStub,
    console,
    URLSearchParams,
    Event,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(TOOLS_SRC, sandbox);
  return sandbox.window.FSAI;
}

const MINIMAL_DOC = {
  addEventListener: () => {},
  getElementById: () => null,
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
  querySelector: () => null,
};

const CALC_FSAI = loadTools(MINIMAL_DOC);
const DEFS = CALC_FSAI.TOOL_DEFS;

function calc(id, values) {
  const def = DEFS.find((d) => d.id === id);
  assert.ok(def, 'shipped tool must exist: ' + id);
  return def.calc(values);
}
function lines(result) {
  assert.ok(!result.error, 'expected no error, got: ' + result.error);
  return result.lines;
}
function errorOf(result) {
  assert.ok(result.error, 'expected an error, got result: ' + JSON.stringify(result.lines));
  return result.error;
}

/* ------------------------------------------------------------------ */
/* Definitions: exactly the 20 tools.                                  */
/* ------------------------------------------------------------------ */
describe('shipped tools.js definitions', () => {
  it('exposes exactly the 20 expected tools, in order', () => {
    assert.equal(DEFS.length, 20);
    // Join-compare: DEFS comes from a vm realm, whose Array prototype makes
    // assert.deepEqual fail even for identical contents.
    assert.equal(DEFS.map((d) => d.id).join(','), EXPECTED_IDS.join(','));
  });

  it('every tool has a name, inputs and a calc function', () => {
    for (const d of DEFS) {
      assert.ok(d.name, d.id + ' needs a name');
      assert.ok(Array.isArray(d.inputs) && d.inputs.length > 0, d.id + ' needs inputs');
      assert.equal(typeof d.calc, 'function', d.id + ' needs a calc function');
    }
  });
});

/* ------------------------------------------------------------------ */
/* (a) Normal inputs vs hand-computed values.                          */
/* ------------------------------------------------------------------ */
describe('normal inputs — result matches hand-computed value', () => {
  const cases = [
    // [id, values, regexes that must all match the joined result lines]
    ['fuel-cost', { distance: 100, consumption: 8, price: 1.2 },
      [/Fuel needed: 8\.00 litres/, /Total fuel cost: \$9\.60/]], // 100*8/100=8 L; 8*1.2=9.60
    ['mileage', { distance: 400, fuel: 30 },
      [/Mileage: 13\.33 km per litre/, /Consumption: 7\.50 litres per 100 km/]], // 400/30=13.33; 30/400*100=7.5
    ['maintenance-planner', { lastDate: '2026-05-11', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 },
      [/Next service by distance: 30000 km/, /Next service by date: 11 Nov 2026/]],
    ['tyre-pressure', { value: 32, from: 'PSI', to: 'bar' },
      [/32\.00 PSI = 2\.21 bar/]], // 32/14.5038=2.2062
    ['monthly-budget', { income: 1000 },
      [/Needs \(50%\): \$500\.00/, /Wants \(30%\): \$300\.00/, /Savings \(20%\): \$200\.00/]],
    ['savings', { monthly: 100, rate: 5, years: 5 },
      [/Total deposits: \$6000\.00/, /Future value: \$6800\.61/, /Interest earned: \$800\.61/]], // FV=100*((1+0.05/12)^60-1)/(0.05/12)=6800.61
    ['loan-payment', { amount: 10000, rate: 8, years: 5 },
      [/Monthly payment: \$202\.76/, /Total paid: \$12165\.84/, /Total interest: \$2165\.84/]], // amortisation formula
    ['currency-converter', { amount: 100, rate: 110, from: 'USD', to: 'BDT' },
      [/100\.00 USD = 11000\.00 BDT/]],
    ['storage-converter', { value: 1, from: 'GB', to: 'MB' },
      [/1\.00 GB = 1024\.0000 MB/]],
    ['internet-speed', { value: 100, from: 'Mbps', to: 'MB/s' },
      [/100\.00 Mbps = 12\.50 MB\/s/]], // 100/8=12.5
    ['data-unit', { value: 1, from: 'GB', to: 'MB' },
      [/1\.00 GB = 1024\.0000 MB/]],
    ['data-unit', { value: 8, from: 'bit', to: 'B' },
      [/8\.00 bit = 1\.0000 B/]],
    ['file-size', { size: 500, speed: 50 },
      [/Estimated download time: 1m 20s \(80 seconds\)/]], // 500*8/50=80s
    ['travel-budget', { daily: 50, days: 5, transport: 200 },
      [/Daily costs: \$250\.00/, /Transport: \$200\.00/, /Total trip budget: \$450\.00/]],
    ['distance-planner', { distance: 250, speed: 60, consumption: 8 },
      [/Travel time: 4h 10m/, /Fuel needed: 20\.00 litres/]], // 250/60=4h10m; 250*8/100=20
    ['trip-cost', { fuel: 60, tolls: 10, food: 20, days: 3, stay: 40, nights: 2 },
      [/Total trip cost: \$210\.00/]], // 60+10+20*3+40*2=210
    ['percentage', { mode: 'What is X% of Y?', x: 20, y: 250 },
      [/20\.00% of 250\.00 = 50\.00/]],
    ['percentage', { mode: 'X is what % of Y?', x: 50, y: 250 },
      [/50\.00 is 20\.00% of 250\.00/]],
    ['percentage', { mode: 'X is Y% of what number?', x: 50, y: 20 },
      [/50\.00 is 20\.00% of 250\.00/]],
    ['date-calculator', { mode: 'Days between two dates', from: '2026-11-01', to: '2026-12-10', days: 30 },
      [/Days between 01 Nov 2026 and 10 Dec 2026: 39 days/]],
    ['date-calculator', { mode: 'Date a number of days from a date', from: '2026-11-01', to: '2026-12-10', days: 30 },
      [/30 days after 01 Nov 2026 is 01 Dec 2026/]],
    ['unit-converter', { category: 'Length', value: 10, from: 'km', to: 'm' },
      [/10\.00 km = 10000\.0000 m/]],
    ['unit-converter', { category: 'Weight', value: 10, from: 'kg', to: 'lb' },
      [/10\.00 kg = 22\.0462 lb/]], // 10/0.45359237=22.0462
    ['unit-converter', { category: 'Temperature', value: 100, from: 'C', to: 'F' },
      [/100\.00 °C = 212\.00 °F/]],
    ['unit-converter', { category: 'Temperature', value: 0, from: 'C', to: 'K' },
      [/0\.00 °C = 273\.15 °K/]],
    ['unit-converter', { category: 'Temperature', value: -40, from: 'C', to: 'F' },
      [/-40\.00 °C = -40\.00 °F/]],
    ['time-calculator', { mode: 'Add time', hours: 2, minutes: 30, time1: '09:00', time2: '17:30' },
      [/Duration: 2h 30m/, /Start 09:00 \+ 2h 30m = 11:30/]],
    ['time-calculator', { mode: 'Subtract time', hours: 2, minutes: 30, time1: '09:00', time2: '17:30' },
      [/Duration: 2h 30m/, /Start 09:00 − 2h 30m = 06:30/]],
    ['time-calculator', { mode: 'Difference between two times', hours: 2, minutes: 30, time1: '09:00', time2: '17:30' },
      [/Difference: 8h 30m \(510 minutes\)/]],
  ];
  for (const [id, values, patterns] of cases) {
    it(`${id}: ${JSON.stringify(values)}`, () => {
      const joined = lines(calc(id, values)).join('\n');
      for (const p of patterns) assert.match(joined, p);
    });
  }

  it('age-calculator: born exactly 25 years ago today is 25 years, 0 months, 0 days', () => {
    const now = new Date();
    const day = now.getMonth() === 1 && now.getDate() === 29 ? 28 : now.getDate();
    const dob = `${now.getFullYear() - 25}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    assert.match(lines(calc('age-calculator', { dob }))[0], /Age: 25 years, 0 months, 0 days/);
  });

  it('age-calculator: leap-day birthday 2000-02-29 total days match independent UTC count', () => {
    const out = lines(calc('age-calculator', { dob: '2000-02-29' }));
    const expected = Math.floor((Date.now() - Date.parse('2000-02-29T00:00:00')) / 86400000);
    assert.match(out[1], new RegExp('Total days lived: ' + expected.toLocaleString('en-GB')));
  });
});

/* ------------------------------------------------------------------ */
/* (b) Empty inputs — every tool errors, never a fake result.          */
/* ------------------------------------------------------------------ */
describe('empty inputs — error, never a result', () => {
  const NAN = NaN;
  const cases = [
    ['fuel-cost', { distance: NAN, consumption: NAN, price: NAN }],
    ['mileage', { distance: NAN, fuel: NAN }],
    ['maintenance-planner', { lastDate: '', lastKm: NAN, intervalKm: NAN, intervalMonths: NAN }],
    ['maintenance-planner', { lastDate: '', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 }],
    ['tyre-pressure', { value: NAN, from: 'PSI', to: 'bar' }],
    ['monthly-budget', { income: NAN }],
    ['savings', { monthly: NAN, rate: NAN, years: NAN }],
    ['loan-payment', { amount: NAN, rate: NAN, years: NAN }],
    ['currency-converter', { amount: NAN, rate: NAN, from: '', to: '' }],
    ['storage-converter', { value: NAN, from: 'GB', to: 'MB' }],
    ['internet-speed', { value: NAN, from: 'Mbps', to: 'MB/s' }],
    ['data-unit', { value: NAN, from: 'GB', to: 'MB' }],
    ['file-size', { size: NAN, speed: NAN }],
    ['travel-budget', { daily: NAN, days: NAN, transport: NAN }],
    ['distance-planner', { distance: NAN, speed: NAN, consumption: NAN }],
    ['trip-cost', { fuel: NAN, tolls: NAN, food: NAN, days: NAN, stay: NAN, nights: NAN }],
    ['age-calculator', { dob: '' }],
    ['percentage', { mode: 'What is X% of Y?', x: NAN, y: NAN }],
    ['date-calculator', { mode: 'Days between two dates', from: '', to: '', days: NAN }],
    ['date-calculator', { mode: 'Date a number of days from a date', from: '2026-11-01', to: '2026-12-10', days: NAN }],
    ['unit-converter', { category: 'Length', value: NAN, from: 'km', to: 'm' }],
    ['time-calculator', { mode: 'Add time', hours: NAN, minutes: NAN, time1: '', time2: '' }],
    ['time-calculator', { mode: 'Difference between two times', hours: NAN, minutes: NAN, time1: '', time2: '' }],
  ];
  for (const [id, values] of cases) {
    it(`${id}: empty → error`, () => {
      const e = errorOf(calc(id, values));
      assert.ok(e.length > 0, 'error text must not be empty');
    });
  }
});

/* ------------------------------------------------------------------ */
/* (c) Invalid inputs — error text, never a fake result.               */
/* ------------------------------------------------------------------ */
describe('invalid inputs — error, never a result', () => {
  const cases = [
    // [id, values, /expected error/]
    ['fuel-cost', { distance: -100, consumption: 8, price: 1.2 }, /Distance must be greater than 0/],
    ['fuel-cost', { distance: 100, consumption: 8, price: 0 }, /Fuel price must be greater than 0/],
    ['fuel-cost', { distance: 0, consumption: 8, price: 1.2 }, /Distance must be greater than 0/],
    ['mileage', { distance: 400, fuel: 0 }, /Fuel used must be greater than 0/],
    ['mileage', { distance: 400, fuel: -30 }, /Fuel used must be greater than 0/],
    ['maintenance-planner', { lastDate: '2026-05-11', lastKm: -5, intervalKm: 10000, intervalMonths: 6 }, /Odometer must be 0 or more/],
    ['maintenance-planner', { lastDate: '2026-05-11', lastKm: 20000, intervalKm: 0, intervalMonths: 6 }, /Service interval \(km\) must be greater than 0/],
    ['maintenance-planner', { lastDate: 'not-a-date', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 }, /valid last service date/],
    ['maintenance-planner', { lastDate: '2026-02-30', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 }, /valid last service date/],
    ['tyre-pressure', { value: -32, from: 'PSI', to: 'bar' }, /Pressure must be greater than 0/],
    ['tyre-pressure', { value: 32, from: 'XXX', to: 'bar' }, /Choose pressure units: PSI, bar or kPa/],
    ['tyre-pressure', { value: 32, from: 'PSI', to: 'XXX' }, /Choose pressure units: PSI, bar or kPa/],
    ['monthly-budget', { income: 0 }, /Monthly income must be greater than 0/],
    ['monthly-budget', { income: -1000 }, /Monthly income must be greater than 0/],
    ['savings', { monthly: 100, rate: -5, years: 5 }, /annual interest rate \(0 or more\)/],
    ['savings', { monthly: 100, rate: 5, years: 0 }, /Years must be greater than 0/],
    ['loan-payment', { amount: 10000, rate: -8, years: 5 }, /annual interest rate \(0 or more\)/],
    ['loan-payment', { amount: 0, rate: 8, years: 5 }, /Loan amount must be greater than 0/],
    ['currency-converter', { amount: 100, rate: 0, from: 'USD', to: 'BDT' }, /Exchange rate must be greater than 0/],
    ['currency-converter', { amount: 100, rate: 110, from: '', to: 'BDT' }, /Enter both currency codes/],
    ['storage-converter', { value: 1, from: 'XXX', to: 'MB' }, /Choose storage units: B, KB, MB, GB or TB/],
    ['storage-converter', { value: 1, from: 'GB', to: 'XXX' }, /Choose storage units: B, KB, MB, GB or TB/],
    ['storage-converter', { value: 0, from: 'GB', to: 'MB' }, /Value must be greater than 0/],
    ['internet-speed', { value: 100, from: 'XXX', to: 'MB/s' }, /Choose speed units/],
    ['internet-speed', { value: 100, from: 'Mbps', to: 'XXX' }, /Choose speed units/],
    ['data-unit', { value: 1, from: 'XXX', to: 'MB' }, /Choose data units: bit, B, KB, MB, GB or TB/],
    ['data-unit', { value: 1, from: 'GB', to: 'XXX' }, /Choose data units: bit, B, KB, MB, GB or TB/],
    ['file-size', { size: 500, speed: 0 }, /Connection speed must be greater than 0/],
    ['travel-budget', { daily: -50, days: 5, transport: 200 }, /Enter valid amounts \(0 or more\)/],
    ['travel-budget', { daily: 50, days: 0, transport: 200 }, /Number of days must be greater than 0/],
    ['distance-planner', { distance: 250, speed: 0, consumption: 8 }, /Average speed must be greater than 0/],
    ['distance-planner', { distance: 250, speed: 60, consumption: -8 }, /valid fuel consumption \(0 or more\)/],
    ['trip-cost', { fuel: 60, tolls: 10, food: -20, days: 3, stay: 40, nights: 2 }, /Enter valid amounts \(0 or more\) for every field/],
    ['age-calculator', { dob: '2030-01-01' }, /cannot be in the future/],
    ['age-calculator', { dob: 'not-a-date' }, /valid date of birth/],
    ['age-calculator', { dob: '2026-02-30' }, /valid date of birth/],
    ['percentage', { mode: 'X is what % of Y?', x: 50, y: 0 }, /Y must not be 0/],
    ['percentage', { mode: 'X is Y% of what number?', x: 50, y: 0 }, /Y \(the percentage\) must not be 0/],
    ['percentage', { mode: 'Bogus', x: 50, y: 20 }, /Choose a percentage calculation/],
    ['date-calculator', { mode: 'Days between two dates', from: 'junk', to: '2026-12-10', days: 30 }, /valid from date/],
    ['date-calculator', { mode: 'Days between two dates', from: '2026-11-01', to: 'junk', days: 30 }, /valid to date/],
    ['date-calculator', { mode: 'Days between two dates', from: '2026-02-30', to: '2026-03-05', days: 30 }, /valid from date/],
    ['date-calculator', { mode: 'Bogus', from: '2026-11-01', to: '2026-12-10', days: 30 }, /Choose a date calculation/],
    ['unit-converter', { category: 'Temperature', value: 100, from: 'km', to: 'm' }, /Choose temperature units: C, F or K/],
    ['unit-converter', { category: 'Length', value: 10, from: 'kg', to: 'm' }, /Choose units from the Length category/],
    ['unit-converter', { category: 'Weight', value: 10, from: 'km', to: 'lb' }, /Choose units from the Weight category/],
    ['unit-converter', { category: 'Length', value: -10, from: 'km', to: 'm' }, /Value must be 0 or more for Length/],
    ['unit-converter', { category: 'Weight', value: -10, from: 'kg', to: 'lb' }, /Value must be 0 or more for Weight/],
    ['unit-converter', { category: 'Bogus', value: 10, from: 'km', to: 'm' }, /Choose a category: Length, Weight or Temperature/],
    ['unit-converter', { category: 'Temperature', value: -300, from: 'C', to: 'K' }, /below absolute zero/],
    ['unit-converter', { category: 'Temperature', value: -5, from: 'K', to: 'C' }, /below absolute zero/],
    ['time-calculator', { mode: 'Add time', hours: -2, minutes: 30, time1: '09:00', time2: '17:30' }, /valid hours and minutes \(0 or more\)/],
    ['time-calculator', { mode: 'Difference between two times', hours: 2, minutes: 30, time1: '25:00', time2: '17:30' }, /Enter both times as HH:MM/],
    ['time-calculator', { mode: 'Difference between two times', hours: 2, minutes: 30, time1: '9am', time2: '17:30' }, /Enter both times as HH:MM/],
    ['time-calculator', { mode: 'Difference between two times', hours: 2, minutes: 30, time1: '24:00', time2: '17:30' }, /Enter both times as HH:MM/],
    ['time-calculator', { mode: 'Bogus mode', hours: 2, minutes: 30, time1: '09:00', time2: '17:30' }, /Choose a time calculation/],
  ];
  for (const [id, values, pattern] of cases) {
    it(`${id}: ${JSON.stringify(values)} → error`, () => {
      assert.match(errorOf(calc(id, values)), pattern);
    });
  }

  it('no invalid input above ever produces a "NaN" or "Infinity" result line', () => {
    // Spot-check the previously-buggy unknown-unit cases end-to-end.
    for (const [id, values] of [
      ['tyre-pressure', { value: 32, from: 'XXX', to: 'bar' }],
      ['storage-converter', { value: 1, from: 'GB', to: 'XXX' }],
      ['internet-speed', { value: 100, from: 'XXX', to: 'MB/s' }],
      ['data-unit', { value: 1, from: 'XXX', to: 'MB' }],
    ]) {
      const r = calc(id, values);
      assert.ok(r.error, id + ' must error');
      assert.ok(!r.lines, id + ' must not return lines');
    }
  });
});

/* ------------------------------------------------------------------ */
/* (d) Boundary values.                                                */
/* ------------------------------------------------------------------ */
describe('boundary values', () => {
  const okCases = [
    // [id, values, regexes]
    ['fuel-cost', { distance: 1e9, consumption: 8, price: 1.2 },
      [/Fuel needed: 80000000\.00 litres/, /Total fuel cost: \$96000000\.00/]],
    ['savings', { monthly: 100, rate: 0, years: 5 },
      [/Total deposits: \$6000\.00/, /Future value: \$6000\.00/, /Interest earned: \$0\.00/]],
    ['savings', { monthly: 100, rate: 5, years: 100 },
      [/Total deposits: \$120000\.00/, /Future value: \$3501106\.79/]],
    ['loan-payment', { amount: 10000, rate: 0, years: 5 },
      [/Monthly payment: \$166\.67/, /Total paid: \$10000\.00/, /Total interest: \$0\.00/]],
    ['storage-converter', { value: 1024, from: 'TB', to: 'B' },
      [/1024\.00 TB = 1125899906842624\.0000 B/]],
    ['internet-speed', { value: 1, from: 'Gbps', to: 'Kbps' },
      [/1\.00 Gbps = 1000000\.00 Kbps/]],
    ['internet-speed', { value: 8, from: 'KB/s', to: 'Kbps' },
      [/8\.00 KB\/s = 64\.00 Kbps/]], // 8 bytes/s = 64 bits/s
    ['file-size', { size: 1, speed: 1 },
      [/Estimated download time: 8s \(8 seconds\)/]],
    ['travel-budget', { daily: 0, days: 5, transport: 0 },
      [/Daily costs: \$0\.00/, /Total trip budget: \$0\.00/]], // 0 amounts are valid here
    ['distance-planner', { distance: 599, speed: 300, consumption: 8 },
      [/Travel time: 2h 0m/]], // minute rollover: 599/300h = 1h 59.8m rounds to 2h 0m, not 1h 60m
    ['distance-planner', { distance: 119.9, speed: 60, consumption: 8 },
      [/Travel time: 2h 0m/]],
    ['distance-planner', { distance: 250, speed: 60, consumption: 0 },
      [/Travel time: 4h 10m/, /Fuel needed: 0\.00 litres/]],
    ['trip-cost', { fuel: 0, tolls: 0, food: 0, days: 0, stay: 0, nights: 0 },
      [/Total trip cost: \$0\.00/]],
    ['maintenance-planner', { lastDate: '2026-05-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 },
      [/Next service by date: 30 Nov 2026/]], // month-end clamp, not 1 Dec
    ['maintenance-planner', { lastDate: '2026-01-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 1 },
      [/Next service by date: 28 Feb 2026/]],
    ['maintenance-planner', { lastDate: '2024-01-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 1 },
      [/Next service by date: 29 Feb 2024/]], // leap year
    ['maintenance-planner', { lastDate: '2026-08-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 },
      [/Next service by date: 28 Feb 2027/]],
    ['maintenance-planner', { lastDate: '2024-02-29', lastKm: 20000, intervalKm: 10000, intervalMonths: 12 },
      [/Next service by date: 28 Feb 2025/]], // leap day + 12 months clamps
    ['maintenance-planner', { lastDate: '2026-12-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 1 },
      [/Next service by date: 31 Jan 2027/]],
    ['maintenance-planner', { lastDate: '2026-05-11', lastKm: 0, intervalKm: 10000, intervalMonths: 6 },
      [/Next service by distance: 10000 km/]], // brand-new car, odometer 0
    ['age-calculator', { dob: (() => { const y = new Date(); y.setDate(y.getDate() - 1); return y.toISOString().slice(0, 10); })() },
      [/Age: 0 years, 0 months, 1 days/, /Total days lived: 1/]],
    ['date-calculator', { mode: 'Days between two dates', from: '2026-11-01', to: '2026-11-01', days: 30 },
      [/0 days/]],
    ['date-calculator', { mode: 'Days between two dates', from: '2026-12-10', to: '2026-11-01', days: 30 },
      [/-39 days/]], // reversed dates stay negative, labelled
    ['date-calculator', { mode: 'Date a number of days from a date', from: '2024-02-28', to: '2026-12-10', days: 1 },
      [/1 days after 28 Feb 2024 is 29 Feb 2024/]], // leap day
    ['date-calculator', { mode: 'Date a number of days from a date', from: '2024-02-28', to: '2026-12-10', days: 2 },
      [/2 days after 28 Feb 2024 is 01 Mar 2024/]],
    ['date-calculator', { mode: 'Date a number of days from a date', from: '2026-11-01', to: '2026-12-10', days: 0 },
      [/0 days after 01 Nov 2026 is 01 Nov 2026/]],
    ['date-calculator', { mode: 'Date a number of days from a date', from: '2026-12-31', to: '2026-12-10', days: 1 },
      [/1 days after 31 Dec 2026 is 01 Jan 2027/]],
    ['percentage', { mode: 'What is X% of Y?', x: 0, y: 250 },
      [/0\.00% of 250\.00 = 0\.00/]],
    ['percentage', { mode: 'What is X% of Y?', x: 100, y: 250 },
      [/100\.00% of 250\.00 = 250\.00/]],
    ['percentage', { mode: 'X is what % of Y?', x: 0, y: 250 },
      [/0\.00 is 0\.00% of 250\.00/]],
    ['time-calculator', { mode: 'Add time', hours: 2, minutes: 0, time1: '23:00', time2: '17:30' },
      [/Start 23:00 \+ 2h 0m = 01:00/]], // wraps past midnight
    ['time-calculator', { mode: 'Subtract time', hours: 2, minutes: 30, time1: '01:00', time2: '17:30' },
      [/Start 01:00 − 2h 30m = 22:30/]], // wraps to previous day
    ['time-calculator', { mode: 'Difference between two times', hours: 0, minutes: 0, time1: '22:00', time2: '06:00' },
      [/Difference: 8h 0m \(480 minutes\)/]], // overnight = next day
    ['time-calculator', { mode: 'Difference between two times', hours: 0, minutes: 0, time1: '09:00', time2: '09:00' },
      [/Difference: 0h 0m \(0 minutes\)/]],
    ['time-calculator', { mode: 'Add time', hours: 0, minutes: 90, time1: '09:00', time2: '17:30' },
      [/Duration: 1h 30m/, /Start 09:00 \+ 1h 30m = 10:30/]], // 90 minutes normalises
    ['time-calculator', { mode: 'Add time', hours: 2, minutes: 30, time1: '', time2: '' },
      [/Duration: 2h 30m/]], // no start time: duration only, no fake clock time
    ['time-calculator', { mode: 'Subtract time', hours: 2, minutes: 30, time1: '', time2: '' },
      [/Duration: 2h 30m/]],
    ['unit-converter', { category: 'Length', value: 1, from: 'mile', to: 'km' },
      [/1\.00 mile = 1\.6093 km/]],
    ['unit-converter', { category: 'Length', value: 1, from: 'ft', to: 'in' },
      [/1\.00 ft = 12\.0000 in/]],
    ['unit-converter', { category: 'Weight', value: 1, from: 'lb', to: 'oz' },
      [/1\.00 lb = 16\.0000 oz/]],
    ['unit-converter', { category: 'Weight', value: 1, from: 'oz', to: 'g' },
      [/1\.00 oz = 28\.3495 g/]],
    ['unit-converter', { category: 'Temperature', value: 32, from: 'F', to: 'C' },
      [/32\.00 °F = 0\.00 °C/]],
    ['unit-converter', { category: 'Temperature', value: 273.15, from: 'K', to: 'C' },
      [/273\.15 °K = 0\.00 °C/]],
    ['unit-converter', { category: 'Temperature', value: -273.15, from: 'C', to: 'K' },
      [/-273\.15 °C = 0\.00 °K/]], // absolute zero itself is valid
    ['unit-converter', { category: 'Temperature', value: -459.67, from: 'F', to: 'C' },
      [/-459\.67 °F = -273\.15 °C/]], // −459.67 °F is absolute zero, accepted
    ['unit-converter', { category: 'Length', value: 0, from: 'km', to: 'm' },
      [/0\.00 km = 0\.0000 m/]], // zero length converts fine
    ['tyre-pressure', { value: 1, from: 'bar', to: 'PSI' },
      [/1\.00 bar = 14\.50 PSI/]],
    ['tyre-pressure', { value: 100, from: 'kPa', to: 'PSI' },
      [/100\.00 kPa = 14\.50 PSI/]],
    ['tyre-pressure', { value: 32, from: 'PSI', to: 'PSI' },
      [/32\.00 PSI = 32\.00 PSI/]],
  ];
  for (const [id, values, patterns] of okCases) {
    it(`${id}: ${JSON.stringify(values)}`, () => {
      const joined = lines(calc(id, values)).join('\n');
      for (const p of patterns) assert.match(joined, p);
    });
  }

  it('overflow-scale inputs (1e308) error instead of printing Infinity/NaN', () => {
    const tooBig = /Result is too large to calculate/;
    const cases = [
      ['fuel-cost', { distance: 1e308, consumption: 1e308, price: 1e308 }],
      ['mileage', { distance: 1e308, fuel: 1e-320 }],
      ['savings', { monthly: 1e308, rate: 5, years: 5 }],
      ['currency-converter', { amount: 1e308, rate: 1e308, from: 'USD', to: 'BDT' }],
      ['storage-converter', { value: 1e308, from: 'TB', to: 'B' }],
      ['internet-speed', { value: 1e308, from: 'Gbps', to: 'Kbps' }],
      ['data-unit', { value: 1e308, from: 'TB', to: 'bit' }],
      ['file-size', { size: 1e308, speed: 1 }],
      ['travel-budget', { daily: 1e308, days: 1e308, transport: 0 }],
      ['distance-planner', { distance: 1e308, speed: 1, consumption: 8 }],
      ['percentage', { mode: 'What is X% of Y?', x: 1e308, y: 1e308 }],
      ['unit-converter', { category: 'Length', value: 1e308, from: 'km', to: 'mm' }],
      ['unit-converter', { category: 'Temperature', value: 1e308, from: 'C', to: 'F' }],
      ['tyre-pressure', { value: 1e308, from: 'PSI', to: 'kPa' }],
      ['maintenance-planner', { lastDate: '2026-05-11', lastKm: 20000, intervalKm: 10000, intervalMonths: 1e15 }],
      ['date-calculator', { mode: 'Date a number of days from a date', from: '2026-11-01', to: '2026-12-10', days: 1e15 }],
    ];
    for (const [id, values] of cases) {
      assert.match(errorOf(calc(id, values)), tooBig, id + ' must refuse an overflowing result');
    }
  });
});

/* ------------------------------------------------------------------ */
/* Form rendering, submit, reset, mobile scroll — mini-DOM shim.       */
/* The shim models real select behaviour: setting a select's value to  */
/* an option that is not in its list leaves the value blank.            */
/* ------------------------------------------------------------------ */
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this._listeners = {};
    this._value = '';
    this._innerHTML = '';
    this.textContent = '';
    this.className = '';
    this.id = '';
    this.name = '';
    this.type = '';
    this.step = '';
    this.min = '';
    this.scrollCalls = 0;
    this.classList = { toggle: () => {}, add: () => {}, remove: () => {} };
    this._attrs = {};
  }
  get value() { return this._value; }
  set value(v) {
    v = String(v);
    if (this.tagName === 'SELECT') {
      const opts = this.children.filter((c) => c.tagName === 'OPTION').map((c) => c.value);
      this._value = opts.includes(v) ? v : '';
    } else this._value = v;
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this.children = [];
    if (!v) return;
    // Minimal parser: top-level <button>/<option> tags only — all tools.js
    // builds through innerHTML strings.
    const re = /<(button|option)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(String(v)))) {
      const el = new El(m[1]);
      const idm = /id="([^"]*)"/.exec(m[2]);
      if (idm) el.id = idm[1];
      const clm = /class="([^"]*)"/.exec(m[2]);
      if (clm) el.className = clm[1];
      const dtm = /data-tool="([^"]*)"/.exec(m[2]);
      if (dtm) el._attrs['data-tool'] = dtm[1];
      const vm2 = /value="([^"]*)"/.exec(m[2]);
      if (vm2) el._value = vm2[1];
      this.children.push(el);
    }
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  dispatchEvent(e) { (this._listeners[e.type] || []).forEach((f) => f(e)); return true; }
  click() { this.dispatchEvent({ type: 'click' }); }
  querySelector(sel) {
    if (!sel.startsWith('#')) return null;
    const id = sel.slice(1);
    const walk = (el) => {
      for (const c of el.children) { if (c.id === id) return c; const r = walk(c); if (r) return r; }
      return null;
    };
    return walk(this);
  }
  querySelectorAll() { return []; }
  scrollIntoView() { this.scrollCalls++; }
  reset() {
    // Real form.reset() restores INPUT/SELECT values only; OPTION values stay.
    const walk = (el) => { for (const c of el.children) { if (c.tagName === 'INPUT' || c.tagName === 'SELECT') c._value = ''; walk(c); } };
    walk(this);
  }
}

function loadDomTools() {
  const byId = {};
  for (const id of ['toolTitle', 'toolDescription', 'toolForm', 'toolResult', 'toolList', 'toolGridHome']) {
    const el = new El(id === 'toolForm' ? 'form' : 'div');
    el.id = id;
    byId[id] = el;
  }
  let domReadyCb = null;
  const docStub = {
    addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') domReadyCb = fn; },
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new El(tag),
    querySelector: () => null,
  };
  const FSAI = loadTools(docStub);
  FSAI.TOOLS = FSAI.TOOL_DEFS.map((d) => ({ id: d.id, name: d.name, category: 'Test', description: 'desc ' + d.id }));
  assert.ok(domReadyCb, 'tools.js must register a DOMContentLoaded handler');
  domReadyCb();
  return { FSAI, byId, form: byId.toolForm, out: byId.toolResult };
}

function formInputIds(form) {
  const ids = [];
  const walk = (el) => {
    for (const c of el.children) {
      if (c.id && c.id.startsWith('tool-') && c.id !== 'toolReset') ids.push(c.id);
      walk(c);
    }
  };
  walk(form);
  return ids;
}

describe('form rendering, submit, reset, mobile scroll (mini-DOM)', () => {
  it('every tool renders its inputs with default values, a submit handler and a Reset button', () => {
    const { FSAI, byId, form } = loadDomTools();
    for (const def of FSAI.TOOL_DEFS) {
      FSAI.showTool(def.id);
      assert.equal(byId.toolTitle.textContent, def.name, def.id + ' title');
      // Join-compare (see above): def.inputs lives in the vm realm.
      assert.equal(formInputIds(form).join(','), def.inputs.map((i) => 'tool-' + i.id).join(','), def.id + ' inputs');
      for (const inp of def.inputs) {
        const el = form.querySelector('#tool-' + inp.id);
        assert.equal(el.value, String(inp.def), `${def.id} input ${inp.id} default`);
      }
      assert.equal(typeof form.onsubmit, 'function', def.id + ' needs a submit handler');
      assert.ok(form.querySelector('#toolReset'), def.id + ' needs a Reset button');
    }
  });

  it('submit with defaults shows the result and scrolls it into view (mobile fix)', () => {
    const { FSAI, form, out } = loadDomTools();
    FSAI.showTool('fuel-cost');
    out.scrollCalls = 0;
    form.onsubmit({ preventDefault: () => {} });
    assert.match(out.innerHTML, /Fuel needed: 8\.00 litres/);
    assert.match(out.innerHTML, /Total fuel cost: \$9\.60/);
    assert.equal(out.scrollCalls, 1, 'result must scrollIntoView once after Calculate');
  });

  it('submit with an invalid value shows the error and still scrolls into view', () => {
    const { FSAI, form, out } = loadDomTools();
    FSAI.showTool('fuel-cost');
    form.querySelector('#tool-distance').value = '';
    out.scrollCalls = 0;
    form.onsubmit({ preventDefault: () => {} });
    assert.match(out.innerHTML, /tool-error/);
    assert.match(out.innerHTML, /Enter a valid number for Distance/);
    assert.equal(out.scrollCalls, 1);
  });

  it('Reset restores defaults and clears the result', () => {
    const { FSAI, form, out } = loadDomTools();
    FSAI.showTool('fuel-cost');
    form.querySelector('#tool-distance').value = '999';
    form.onsubmit({ preventDefault: () => {} });
    assert.match(out.innerHTML, /Fuel needed: 79\.92 litres/); // 999*8/100 proves the edited value was used
    form.querySelector('#toolReset').click();
    assert.equal(form.querySelector('#tool-distance').value, '100');
    assert.equal(form.querySelector('#tool-consumption').value, '8');
    assert.equal(form.querySelector('#tool-price').value, '1.2');
    assert.match(out.innerHTML, /Enter values and press Calculate/);
  });

  it('Reset after switching Unit Converter to Weight restores km/m and Calculate works', () => {
    const { FSAI, form, out } = loadDomTools();
    FSAI.showTool('unit-converter');
    const cat = form.querySelector('#tool-category');
    cat.value = 'Weight';
    cat.dispatchEvent(new Event('change'));
    assert.equal(form.querySelector('#tool-from').value, 'kg');
    form.querySelector('#tool-from').value = 'lb';
    form.querySelector('#tool-to').value = 'oz';
    form.querySelector('#toolReset').click();
    assert.equal(form.querySelector('#tool-category').value, 'Length');
    assert.equal(form.querySelector('#tool-from').value, 'km');
    assert.equal(form.querySelector('#tool-to').value, 'm');
    form.onsubmit({ preventDefault: () => {} });
    assert.match(out.innerHTML, /10\.00 km = 10000\.0000 m/);
  });

  it('Unit Converter category switch updates the unit lists (Weight converts)', () => {
    const { FSAI, form, out } = loadDomTools();
    FSAI.showTool('unit-converter');
    const cat = form.querySelector('#tool-category');
    cat.value = 'Weight';
    cat.dispatchEvent(new Event('change'));
    form.querySelector('#tool-from').value = 'kg';
    form.querySelector('#tool-to').value = 'lb';
    form.onsubmit({ preventDefault: () => {} });
    assert.match(out.innerHTML, /10\.00 kg = 22\.0462 lb/);
  });

  it('the form has exactly two buttons (Calculate + Reset) — no copy/download feature exists', () => {
    const { FSAI, form } = loadDomTools();
    FSAI.showTool('fuel-cost');
    const buttons = [];
    const walk = (el) => { for (const c of el.children) { if (c.tagName === 'BUTTON') buttons.push(c); walk(c); } };
    walk(form);
    assert.equal(buttons.length, 2, 'only Calculate and Reset may exist');
    assert.match(TOOLS_SRC, /scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  });

  it('the mobile scroll fix is still present in tools.js (result + title)', () => {
    // Commits a7b984f / 8bd5558: after Calculate the result scrolls into view;
    // after picking a tool from the list the form title scrolls into view.
    // Each site is a try { smooth } catch { plain } pair, so the smooth call
    // appears exactly twice — once for the result, once for the title.
    const smoothCalls = (TOOLS_SRC.match(/\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/g) || []).length;
    assert.equal(smoothCalls, 2, 'two smooth scrollIntoView calls (result + title) must be present');
    assert.match(TOOLS_SRC, /Mobile fix: the result sits below the form/);
    assert.match(TOOLS_SRC, /Mobile: the form is now above the list/);
  });
});
