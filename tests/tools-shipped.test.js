// FS AI — tests that execute the SHIPPED frontend/scripts/tools.js
// calculation code in Node (via vm with minimal browser stubs), instead of
// re-implementing the formulas. Covers the two audit bugs (Distance Planner
// "1h 60m", Maintenance Planner month-end overflow) plus 8 other tools.
// Run: node --test tests/tools-shipped.test.js (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadShippedTools() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'scripts', 'tools.js'), 'utf8');
  const sandbox = {
    window: { FSAI: { esc: (s) => String(s == null ? '' : s), TOOLS: [] } },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} }),
      querySelector: () => null,
    },
    console,
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.FSAI.TOOL_DEFS;
}

const DEFS = loadShippedTools();

function calc(id, values) {
  const def = DEFS.find((d) => d.id === id);
  assert.ok(def, 'shipped tool must exist: ' + id);
  return def.calc(values);
}

function lines(result) {
  assert.ok(!result.error, 'expected no error, got: ' + result.error);
  return result.lines;
}

describe('shipped tools.js loads', () => {
  it('exposes all 20 tool definitions', () => {
    assert.equal(DEFS.length, 20);
    for (const id of ['fuel-cost', 'distance-planner', 'maintenance-planner', 'time-calculator']) {
      assert.ok(DEFS.some((d) => d.id === id), id + ' must exist');
    }
  });
});

describe('Distance Planner — minute rollover (audit B16)', () => {
  it('599 km at 300 km/h is 2h 0m, not 1h 60m', () => {
    assert.match(lines(calc('distance-planner', { distance: 599, speed: 300, consumption: 8 }))[0], /Travel time: 2h 0m/);
  });

  it('119.9 km at 60 km/h rounds to 2h 0m', () => {
    assert.match(lines(calc('distance-planner', { distance: 119.9, speed: 60, consumption: 8 }))[0], /Travel time: 2h 0m/);
  });

  it('250 km at 60 km/h is still 4h 10m (no regression)', () => {
    assert.match(lines(calc('distance-planner', { distance: 250, speed: 60, consumption: 8 }))[0], /Travel time: 4h 10m/);
  });

  it('100 km at 30 km/h is 3h 20m', () => {
    assert.match(lines(calc('distance-planner', { distance: 100, speed: 30, consumption: 0 }))[0], /Travel time: 3h 20m/);
  });
});

describe('Maintenance Planner — month-end overflow (audit B17)', () => {
  it('31 May 2026 + 6 months is 30 Nov 2026, not 1 Dec', () => {
    const out = lines(calc('maintenance-planner', { lastDate: '2026-05-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 }));
    assert.match(out[1], /30 Nov 2026/);
  });

  it('31 Jan 2026 + 1 month is 28 Feb 2026', () => {
    const out = lines(calc('maintenance-planner', { lastDate: '2026-01-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 1 }));
    assert.match(out[1], /28 Feb 2026/);
  });

  it('31 Jan 2024 + 1 month is 29 Feb 2024 (leap year)', () => {
    const out = lines(calc('maintenance-planner', { lastDate: '2024-01-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 1 }));
    assert.match(out[1], /29 Feb 2024/);
  });

  it('31 Aug 2026 + 6 months is 28 Feb 2027', () => {
    const out = lines(calc('maintenance-planner', { lastDate: '2026-08-31', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 }));
    assert.match(out[1], /28 Feb 2027/);
  });

  it('odometer 0 (brand-new car) is accepted', () => {
    const out = lines(calc('maintenance-planner', { lastDate: '2026-05-11', lastKm: 0, intervalKm: 10000, intervalMonths: 6 }));
    assert.match(out[0], /Next service by distance: 10000 km/);
  });

  it('negative odometer is still rejected', () => {
    assert.match(calc('maintenance-planner', { lastDate: '2026-05-11', lastKm: -5, intervalKm: 10000, intervalMonths: 6 }).error, /0 or more/);
  });

  it('default inputs still give 11 Nov 2026', () => {
    const out = lines(calc('maintenance-planner', { lastDate: '2026-05-11', lastKm: 20000, intervalKm: 10000, intervalMonths: 6 }));
    assert.match(out[1], /11 Nov 2026/);
  });
});

describe('Time Calculator — Subtract mode actually subtracts (audit B18)', () => {
  it('09:00 minus 2h 30m is 06:30', () => {
    const out = lines(calc('time-calculator', { mode: 'Subtract time', hours: 2, minutes: 30, time1: '09:00', time2: '17:30' }));
    assert.match(out[1], /06:30/);
  });

  it('01:00 minus 2h 30m wraps to 22:30', () => {
    const out = lines(calc('time-calculator', { mode: 'Subtract time', hours: 2, minutes: 30, time1: '01:00', time2: '17:30' }));
    assert.match(out[1], /22:30/);
  });
});

describe('other shipped tools (spot checks against the shipped code)', () => {
  it('Fuel Cost: 100 km / 8 l per 100 km / $1.20 = 8.00 litres, $9.60', () => {
    const out = lines(calc('fuel-cost', { distance: 100, consumption: 8, price: 1.2 }));
    assert.match(out[0], /8\.00 litres/);
    assert.match(out[1], /\$9\.60/);
  });

  it('Loan Payment: $10,000 at 8% over 5 years = $202.76/month', () => {
    const out = lines(calc('loan-payment', { amount: 10000, rate: 8, years: 5 }));
    assert.match(out[0], /\$202\.76/);
  });

  it('Savings: $100/month at 5% over 5 years = $6800.61 future value (no thousands separator in shipped money())', () => {
    const out = lines(calc('savings', { monthly: 100, rate: 5, years: 5 }));
    assert.match(out[1], /\$6800\.61/);
  });

  it('Tyre Pressure: 32 PSI = 2.21 bar', () => {
    const out = lines(calc('tyre-pressure', { value: 32, from: 'PSI', to: 'bar' }));
    assert.match(out[0], /2\.21 bar/);
  });

  it('Storage Converter: 1 GB = 1024 MB', () => {
    const out = lines(calc('storage-converter', { value: 1, from: 'GB', to: 'MB' }));
    assert.match(out[0], /1024\.0000 MB/);
  });

  it('Percentage: 20% of 250 = 50.00', () => {
    const out = lines(calc('percentage', { mode: 'What is X% of Y?', x: 20, y: 250 }));
    assert.match(out[0], /= 50\.00/);
  });

  it('Date Calculator: 01 Nov to 10 Dec 2026 = 39 days', () => {
    const out = lines(calc('date-calculator', { mode: 'Days between two dates', from: '2026-11-01', to: '2026-12-10', days: 30 }));
    assert.match(out[0], /39 days/);
  });

  it('File Size: 500 MB at 50 Mbps = 1m 20s', () => {
    const out = lines(calc('file-size', { size: 500, speed: 50 }));
    assert.match(out[0], /1m 20s/);
  });

  it('Unit Converter: Temperature with a length unit is rejected, not nonsense', () => {
    const r = calc('unit-converter', { category: 'Temperature', value: 100, from: 'km', to: 'm' });
    assert.ok(r.error, 'must error instead of printing "100.00 °km = 100.00 °m"');
    assert.match(r.error, /C, F or K/);
  });

  it('Currency Converter: rate 0 is rejected', () => {
    assert.ok(calc('currency-converter', { amount: 100, rate: 0, from: 'USD', to: 'BDT' }).error);
  });
});
