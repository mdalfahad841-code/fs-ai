/* FS AI — all 20 free tools, implemented with real formulas.
   Every tool validates its inputs, shows its result and working, and resets.
   Currency uses a rate YOU enter — no live rates are invented or fetched. */
(function () {
  'use strict';
  var F = window.FSAI;

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  function money(n) { return '$' + n.toFixed(2); }
  function fmt(n, d) { return Number(n).toFixed(d == null ? 2 : d); }
  function err(msg) { return { error: msg }; }
  function ok(lines, note) { return { lines: lines, note: note || '' }; }
  function need(v, label) { if (isNaN(v)) return err('Enter a valid number for ' + label + '.'); return null; }
  function positive(v, label) { var e = need(v, label); if (e) return e; if (v <= 0) return err(label + ' must be greater than 0.'); return null; }

  var DEFS = [
    { id: 'fuel-cost', name: 'Fuel Cost', inputs: [
        { id: 'distance', label: 'Distance (km)', type: 'number', def: 100, min: 0 },
        { id: 'consumption', label: 'Consumption (litres per 100 km)', type: 'number', def: 8, min: 0 },
        { id: 'price', label: 'Fuel price (per litre)', type: 'number', def: 1.2, min: 0 } ],
      calc: function (v) {
        var e = positive(v.distance, 'Distance') || positive(v.consumption, 'Consumption') || positive(v.price, 'Fuel price'); if (e) return e;
        var litres = v.distance * v.consumption / 100, cost = litres * v.price;
        return ok(['Fuel needed: ' + fmt(litres) + ' litres', 'Total fuel cost: ' + money(cost)],
          'Formula: litres = distance × consumption ÷ 100; cost = litres × price.');
      } },
    { id: 'mileage', name: 'Mileage', inputs: [
        { id: 'distance', label: 'Distance driven (km)', type: 'number', def: 400, min: 0 },
        { id: 'fuel', label: 'Fuel used (litres)', type: 'number', def: 30, min: 0 } ],
      calc: function (v) {
        var e = positive(v.distance, 'Distance') || positive(v.fuel, 'Fuel used'); if (e) return e;
        return ok(['Mileage: ' + fmt(v.distance / v.fuel) + ' km per litre', 'Consumption: ' + fmt(v.fuel / v.distance * 100) + ' litres per 100 km'],
          'Formula: km/l = distance ÷ fuel; l/100 km = fuel ÷ distance × 100.');
      } },
    { id: 'maintenance-planner', name: 'Vehicle Maintenance Planner', inputs: [
        { id: 'lastDate', label: 'Last service date', type: 'date', def: '2026-05-11' },
        { id: 'lastKm', label: 'Odometer at last service (km)', type: 'number', def: 20000, min: 0 },
        { id: 'intervalKm', label: 'Service interval (km)', type: 'number', def: 10000, min: 0 },
        { id: 'intervalMonths', label: 'Service interval (months)', type: 'number', def: 6, min: 0 } ],
      calc: function (v) {
        /* Odometer may be 0 (a brand-new car) — only negative / missing is invalid. */
        if (isNaN(v.lastKm) || v.lastKm < 0) return err('Odometer must be 0 or more.');
        var e = positive(v.intervalKm, 'Service interval (km)') || positive(v.intervalMonths, 'Service interval (months)'); if (e) return e;
        if (!v.lastDate) return err('Enter the last service date.');
        var d = new Date(v.lastDate + 'T00:00:00'); if (isNaN(d.getTime())) return err('Enter a valid last service date.');
        /* Clamp to the last day of the target month: 31 May + 6 months is
           30 November, not 1 December (plain setMonth() overflows). */
        var target = d.getMonth() + Math.round(v.intervalMonths);
        var year = d.getFullYear() + Math.floor(target / 12);
        var month = ((target % 12) + 12) % 12;
        var lastDay = new Date(year, month + 1, 0).getDate();
        var next = new Date(year, month, Math.min(d.getDate(), lastDay));
        return ok(['Next service by distance: ' + fmt(v.lastKm + v.intervalKm, 0) + ' km',
          'Next service by date: ' + next.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
          'Service is due at whichever comes first — the distance or the date.');
      } },
    { id: 'tyre-pressure', name: 'Tyre Pressure Guide', inputs: [
        { id: 'value', label: 'Pressure value', type: 'number', def: 32, min: 0 },
        { id: 'from', label: 'From unit', type: 'select', options: ['PSI', 'bar', 'kPa'], def: 'PSI' },
        { id: 'to', label: 'To unit', type: 'select', options: ['PSI', 'bar', 'kPa'], def: 'bar' } ],
      calc: function (v) {
        var e = positive(v.value, 'Pressure'); if (e) return e;
        var toBar = { PSI: 1 / 14.5038, bar: 1, kPa: 1 / 100 };
        var bar = v.value * toBar[v.from];
        var out = v.to === 'PSI' ? bar * 14.5038 : v.to === 'kPa' ? bar * 100 : bar;
        return ok([fmt(v.value) + ' ' + v.from + ' = ' + fmt(out) + ' ' + v.to],
          'Conversions: 1 bar = 14.5038 PSI = 100 kPa. Always check your vehicle handbook for the correct pressure.');
      } },
    { id: 'monthly-budget', name: 'Monthly Budget', inputs: [
        { id: 'income', label: 'Monthly income (after tax)', type: 'number', def: 1000, min: 0 } ],
      calc: function (v) {
        var e = positive(v.income, 'Monthly income'); if (e) return e;
        return ok(['Needs (50%): ' + money(v.income * 0.5), 'Wants (30%): ' + money(v.income * 0.3), 'Savings (20%): ' + money(v.income * 0.2)],
          'The 50/30/20 rule: 50% needs, 30% wants, 20% savings.');
      } },
    { id: 'savings', name: 'Savings', inputs: [
        { id: 'monthly', label: 'Monthly deposit', type: 'number', def: 100, min: 0 },
        { id: 'rate', label: 'Annual interest rate (%)', type: 'number', def: 5, min: 0 },
        { id: 'years', label: 'Years', type: 'number', def: 5, min: 0 } ],
      calc: function (v) {
        var e = positive(v.monthly, 'Monthly deposit') || positive(v.years, 'Years'); if (e) return e;
        if (isNaN(v.rate) || v.rate < 0) return err('Enter a valid annual interest rate (0 or more).');
        var r = v.rate / 100 / 12, n = Math.round(v.years * 12);
        var fv = r === 0 ? v.monthly * n : v.monthly * ((Math.pow(1 + r, n) - 1) / r);
        return ok(['Total deposits: ' + money(v.monthly * n), 'Future value: ' + money(fv), 'Interest earned: ' + money(fv - v.monthly * n)],
          'Monthly compounding: future value = deposit × ((1 + r)^n − 1) ÷ r, where r is the monthly rate.');
      } },
    { id: 'loan-payment', name: 'Loan Payment Estimator', inputs: [
        { id: 'amount', label: 'Loan amount', type: 'number', def: 10000, min: 0 },
        { id: 'rate', label: 'Annual interest rate (%)', type: 'number', def: 8, min: 0 },
        { id: 'years', label: 'Term (years)', type: 'number', def: 5, min: 0 } ],
      calc: function (v) {
        var e = positive(v.amount, 'Loan amount') || positive(v.years, 'Term'); if (e) return e;
        if (isNaN(v.rate) || v.rate < 0) return err('Enter a valid annual interest rate (0 or more).');
        var n = Math.round(v.years * 12), i = v.rate / 100 / 12;
        var m = i === 0 ? v.amount / n : v.amount * i * Math.pow(1 + i, n) / (Math.pow(1 + i, n) - 1);
        return ok(['Monthly payment: ' + money(m), 'Total paid: ' + money(m * n), 'Total interest: ' + money(m * n - v.amount)],
          'Standard loan formula with monthly compounding. This is an estimate — your lender\'s exact terms may differ.');
      } },
    { id: 'currency-converter', name: 'Currency Converter', inputs: [
        { id: 'amount', label: 'Amount', type: 'number', def: 100, min: 0 },
        { id: 'rate', label: 'Exchange rate (1 unit of your currency = ? units of the other)', type: 'number', def: 1, min: 0 },
        { id: 'from', label: 'From currency (code, e.g. USD)', type: 'text', def: 'USD' },
        { id: 'to', label: 'To currency (code, e.g. BDT)', type: 'text', def: 'BDT' } ],
      calc: function (v) {
        var e = positive(v.amount, 'Amount') || positive(v.rate, 'Exchange rate'); if (e) return e;
        if (!v.from || !v.to) return err('Enter both currency codes.');
        return ok([fmt(v.amount) + ' ' + v.from.toUpperCase() + ' = ' + fmt(v.amount * v.rate) + ' ' + v.to.toUpperCase()],
          'Manual rate only: this tool never invents or fetches a live rate. Check the rate from your bank or a trusted source before converting.');
      } },
    { id: 'storage-converter', name: 'Storage Converter', inputs: [
        { id: 'value', label: 'Value', type: 'number', def: 1, min: 0 },
        { id: 'from', label: 'From unit', type: 'select', options: ['B', 'KB', 'MB', 'GB', 'TB'], def: 'GB' },
        { id: 'to', label: 'To unit', type: 'select', options: ['B', 'KB', 'MB', 'GB', 'TB'], def: 'MB' } ],
      calc: function (v) {
        var e = positive(v.value, 'Value'); if (e) return e;
        var bytes = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024, TB: 1024 * 1024 * 1024 * 1024 };
        return ok([fmt(v.value) + ' ' + v.from + ' = ' + fmt(v.value * bytes[v.from] / bytes[v.to], 4) + ' ' + v.to],
          'Binary units: 1 KB = 1024 bytes, 1 MB = 1024 KB, and so on.');
      } },
    { id: 'internet-speed', name: 'Internet Speed Converter', inputs: [
        { id: 'value', label: 'Speed value', type: 'number', def: 100, min: 0 },
        { id: 'from', label: 'From unit', type: 'select', options: ['Kbps', 'Mbps', 'Gbps', 'KB/s', 'MB/s'], def: 'Mbps' },
        { id: 'to', label: 'To unit', type: 'select', options: ['Kbps', 'Mbps', 'Gbps', 'KB/s', 'MB/s'], def: 'MB/s' } ],
      calc: function (v) {
        var e = positive(v.value, 'Speed'); if (e) return e;
        var kbps = { Kbps: 1, Mbps: 1000, Gbps: 1000000, 'KB/s': 8, 'MB/s': 8000 };
        return ok([fmt(v.value) + ' ' + v.from + ' = ' + fmt(v.value * kbps[v.from] / kbps[v.to]) + ' ' + v.to],
          'Bits vs bytes: 1 byte = 8 bits, so MB/s = Mbps ÷ 8.');
      } },
    { id: 'data-unit', name: 'Data Unit Converter', inputs: [
        { id: 'value', label: 'Value', type: 'number', def: 1, min: 0 },
        { id: 'from', label: 'From unit', type: 'select', options: ['bit', 'B', 'KB', 'MB', 'GB', 'TB'], def: 'GB' },
        { id: 'to', label: 'To unit', type: 'select', options: ['bit', 'B', 'KB', 'MB', 'GB', 'TB'], def: 'MB' } ],
      calc: function (v) {
        var e = positive(v.value, 'Value'); if (e) return e;
        var bits = { bit: 1, B: 8, KB: 8 * 1024, MB: 8 * 1024 * 1024, GB: 8 * 1024 * 1024 * 1024, TB: 8 * 1024 * 1024 * 1024 * 1024 };
        return ok([fmt(v.value) + ' ' + v.from + ' = ' + fmt(v.value * bits[v.from] / bits[v.to], 4) + ' ' + v.to],
          '1 byte = 8 bits; 1 KB = 1024 bytes.');
      } },
    { id: 'file-size', name: 'File Size Calculator', inputs: [
        { id: 'size', label: 'File size (MB)', type: 'number', def: 500, min: 0 },
        { id: 'speed', label: 'Connection speed (Mbps)', type: 'number', def: 50, min: 0 } ],
      calc: function (v) {
        var e = positive(v.size, 'File size') || positive(v.speed, 'Connection speed'); if (e) return e;
        var secs = Math.round(v.size * 8 / v.speed);
        var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
        var time = h > 0 ? h + 'h ' + m + 'm ' + s + 's' : m > 0 ? m + 'm ' + s + 's' : s + 's';
        return ok(['Estimated download time: ' + time + ' (' + secs + ' seconds)'],
          'Formula: seconds = file size (MB) × 8 ÷ speed (Mbps). Real speeds vary with network conditions.');
      } },
    { id: 'travel-budget', name: 'Travel Budget', inputs: [
        { id: 'daily', label: 'Daily cost (food, stays, local travel)', type: 'number', def: 50, min: 0 },
        { id: 'days', label: 'Number of days', type: 'number', def: 5, min: 0 },
        { id: 'transport', label: 'Transport total (flights, buses, fuel)', type: 'number', def: 200, min: 0 } ],
      calc: function (v) {
        var e = positive(v.days, 'Number of days'); if (e) return e;
        if (isNaN(v.daily) || v.daily < 0 || isNaN(v.transport) || v.transport < 0) return err('Enter valid amounts (0 or more).');
        var total = v.daily * v.days + v.transport;
        return ok(['Daily costs: ' + money(v.daily * v.days), 'Transport: ' + money(v.transport), 'Total trip budget: ' + money(total)],
          'Total = daily cost × days + transport. Add a 10% buffer for unexpected costs.');
      } },
    { id: 'distance-planner', name: 'Distance Planner', inputs: [
        { id: 'distance', label: 'Distance (km)', type: 'number', def: 250, min: 0 },
        { id: 'speed', label: 'Average speed (km/h)', type: 'number', def: 60, min: 0 },
        { id: 'consumption', label: 'Fuel consumption (l/100 km)', type: 'number', def: 8, min: 0 } ],
      calc: function (v) {
        var e = positive(v.distance, 'Distance') || positive(v.speed, 'Average speed'); if (e) return e;
        if (isNaN(v.consumption) || v.consumption < 0) return err('Enter a valid fuel consumption (0 or more).');
        var hours = v.distance / v.speed;
        /* Round to whole minutes first, then split — otherwise a fractional
           hour that rounds to 60 minutes prints as e.g. "1h 60m". */
        var totalMins = Math.round(hours * 60);
        var h = Math.floor(totalMins / 60), m = totalMins % 60;
        return ok(['Travel time: ' + h + 'h ' + m + 'm', 'Fuel needed: ' + fmt(v.distance * v.consumption / 100) + ' litres'],
          'Time = distance ÷ speed. Add rest stops for long journeys.');
      } },
    { id: 'trip-cost', name: 'Trip Cost Estimator', inputs: [
        { id: 'fuel', label: 'Fuel cost', type: 'number', def: 60, min: 0 },
        { id: 'tolls', label: 'Tolls and parking', type: 'number', def: 10, min: 0 },
        { id: 'food', label: 'Food per day', type: 'number', def: 20, min: 0 },
        { id: 'days', label: 'Number of days', type: 'number', def: 3, min: 0 },
        { id: 'stay', label: 'Stay per night', type: 'number', def: 40, min: 0 },
        { id: 'nights', label: 'Number of nights', type: 'number', def: 2, min: 0 } ],
      calc: function (v) {
        var vals = [v.fuel, v.tolls, v.food, v.days, v.stay, v.nights];
        if (vals.some(function (x) { return isNaN(x) || x < 0; })) return err('Enter valid amounts (0 or more) for every field.');
        var total = v.fuel + v.tolls + v.food * v.days + v.stay * v.nights;
        return ok(['Fuel: ' + money(v.fuel), 'Tolls and parking: ' + money(v.tolls), 'Food: ' + money(v.food * v.days), 'Stays: ' + money(v.stay * v.nights), 'Total trip cost: ' + money(total)],
          'Total = fuel + tolls + (food × days) + (stay × nights).');
      } },
    { id: 'age-calculator', name: 'Age Calculator', inputs: [
        { id: 'dob', label: 'Date of birth', type: 'date', def: '2000-01-01' } ],
      calc: function (v) {
        if (!v.dob) return err('Enter your date of birth.');
        var dob = new Date(v.dob + 'T00:00:00'), now = new Date();
        if (isNaN(dob.getTime())) return err('Enter a valid date of birth.');
        if (dob > now) return err('Date of birth cannot be in the future.');
        var years = now.getFullYear() - dob.getFullYear();
        var months = now.getMonth() - dob.getMonth();
        var days = now.getDate() - dob.getDate();
        if (days < 0) { months -= 1; var prev = new Date(now.getFullYear(), now.getMonth(), 0); days += prev.getDate(); }
        if (months < 0) { years -= 1; months += 12; }
        var totalDays = Math.floor((now - dob) / 86400000);
        return ok(['Age: ' + years + ' years, ' + months + ' months, ' + days + ' days', 'Total days lived: ' + totalDays.toLocaleString('en-GB')],
          'Calculated from today\'s date in your browser.');
      } },
    { id: 'percentage', name: 'Percentage Calculator', inputs: [
        { id: 'mode', label: 'Calculation', type: 'select', options: ['What is X% of Y?', 'X is what % of Y?', 'X is Y% of what number?'], def: 'What is X% of Y?' },
        { id: 'x', label: 'X (first number)', type: 'number', def: 20, min: 0 },
        { id: 'y', label: 'Y (second number)', type: 'number', def: 250, min: 0 } ],
      calc: function (v) {
        if (isNaN(v.x) || isNaN(v.y)) return err('Enter valid numbers for X and Y.');
        if (v.mode === 'What is X% of Y?') return ok([fmt(v.x) + '% of ' + fmt(v.y) + ' = ' + fmt(v.x / 100 * v.y)], 'Formula: (X ÷ 100) × Y.');
        if (v.mode === 'X is what % of Y?') {
          if (v.y === 0) return err('Y must not be 0 for this calculation.');
          return ok([fmt(v.x) + ' is ' + fmt(v.x / v.y * 100) + '% of ' + fmt(v.y)], 'Formula: (X ÷ Y) × 100.');
        }
        if (v.y === 0) return err('Y (the percentage) must not be 0 for this calculation.');
        return ok([fmt(v.x) + ' is ' + fmt(v.y) + '% of ' + fmt(v.x / (v.y / 100))], 'Formula: X ÷ (Y ÷ 100).');
      } },
    { id: 'date-calculator', name: 'Date Calculator', inputs: [
        { id: 'mode', label: 'Calculation', type: 'select', options: ['Days between two dates', 'Date a number of days from a date'], def: 'Days between two dates' },
        { id: 'from', label: 'From date', type: 'date', def: '2026-11-01' },
        { id: 'to', label: 'To date', type: 'date', def: '2026-12-10' },
        { id: 'days', label: 'Number of days (for the second mode)', type: 'number', def: 30, min: 0 } ],
      calc: function (v) {
        if (!v.from) return err('Enter the from date.');
        var d1 = new Date(v.from + 'T00:00:00');
        if (isNaN(d1.getTime())) return err('Enter a valid from date.');
        var fmtD = function (d) { return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
        if (v.mode === 'Days between two dates') {
          if (!v.to) return err('Enter the to date.');
          var d2 = new Date(v.to + 'T00:00:00');
          if (isNaN(d2.getTime())) return err('Enter a valid to date.');
          var diff = Math.round((d2 - d1) / 86400000);
          return ok(['Days between ' + fmtD(d1) + ' and ' + fmtD(d2) + ': ' + diff + ' day' + (Math.abs(diff) === 1 ? '' : 's')],
            'Negative means the to date is before the from date.');
        }
        if (isNaN(v.days)) return err('Enter a valid number of days.');
        var out = new Date(d1); out.setDate(out.getDate() + Math.round(v.days));
        return ok([fmt(v.days, 0) + ' days after ' + fmtD(d1) + ' is ' + fmtD(out)], 'Calendar days, including weekends.');
      } },
    { id: 'unit-converter', name: 'Unit Converter', inputs: [
        { id: 'category', label: 'Category', type: 'select', options: ['Length', 'Weight', 'Temperature'], def: 'Length' },
        { id: 'value', label: 'Value', type: 'number', def: 10, min: 0 },
        { id: 'from', label: 'From unit', type: 'select', options: ['m', 'km', 'cm', 'mm', 'mile', 'ft', 'in'], def: 'km' },
        { id: 'to', label: 'To unit', type: 'select', options: ['m', 'km', 'cm', 'mm', 'mile', 'ft', 'in'], def: 'm' } ],
      calc: function (v) {
        if (isNaN(v.value)) return err('Enter a valid value.');
        if (v.category === 'Temperature') {
          if (['C', 'F', 'K'].indexOf(v.from) === -1 || ['C', 'F', 'K'].indexOf(v.to) === -1) {
            return err('Choose temperature units: C, F or K.');
          }
          var toC = v.from === 'C' ? v.value : v.from === 'F' ? (v.value - 32) * 5 / 9 : v.value - 273.15;
          var outT = v.to === 'C' ? toC : v.to === 'F' ? toC * 9 / 5 + 32 : toC + 273.15;
          return ok([fmt(v.value) + ' °' + v.from + ' = ' + fmt(outT) + ' °' + v.to], 'Temperature conversion.');
        }
        var len = { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, ft: 0.3048, in: 0.0254 };
        var wt = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.0283495231 };
        var table = v.category === 'Weight' ? wt : len;
        if (!(v.from in table) || !(v.to in table)) return err('Choose units from the ' + v.category + ' category: ' + Object.keys(table).join(', ') + '.');
        return ok([fmt(v.value) + ' ' + v.from + ' = ' + fmt(v.value * table[v.from] / table[v.to], 4) + ' ' + v.to],
          v.category === 'Length' ? '1 mile = 1609.344 m; 1 ft = 0.3048 m.' : '1 lb = 0.45359237 kg; 1 oz = 0.0283495231 kg.');
      } },
    { id: 'time-calculator', name: 'Time Calculator', inputs: [
        { id: 'mode', label: 'Calculation', type: 'select', options: ['Add time', 'Subtract time', 'Difference between two times'], def: 'Add time' },
        { id: 'hours', label: 'Hours', type: 'number', def: 2, min: 0 },
        { id: 'minutes', label: 'Minutes', type: 'number', def: 30, min: 0 },
        { id: 'time1', label: 'Start time (HH:MM, for difference)', type: 'text', def: '09:00' },
        { id: 'time2', label: 'End time (HH:MM, for difference)', type: 'text', def: '17:30' } ],
      calc: function (v) {
        function parseT(s) {
          var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
          if (!m) return NaN;
          var h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
          if (h < 0 || h > 23 || mi < 0 || mi > 59) return NaN;
          return h * 60 + mi;
        }
        function fmtH(mins) {
          var sign = mins < 0 ? '-' : '';
          mins = Math.abs(mins);
          return sign + Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
        }
        if (v.mode === 'Difference between two times') {
          var t1 = parseT(v.time1), t2 = parseT(v.time2);
          if (isNaN(t1) || isNaN(t2)) return err('Enter both times as HH:MM, e.g. 09:00 and 17:30.');
          var diff = t2 - t1; if (diff < 0) diff += 1440;
          return ok(['Difference: ' + fmtH(diff) + ' (' + diff + ' minutes)'], 'If the end time is earlier, it is treated as the next day.');
        }
        if (isNaN(v.hours) || isNaN(v.minutes) || v.hours < 0 || v.minutes < 0) return err('Enter valid hours and minutes (0 or more).');
        var total = v.hours * 60 + v.minutes;
        var base = parseT(v.time1);
        if (v.mode === 'Add time' && !isNaN(base)) {
          var sum = base + total;
          return ok(['Duration: ' + fmtH(total), 'Start ' + v.time1 + ' + ' + fmtH(total) + ' = ' + String(Math.floor((sum % 1440) / 60)).padStart(2, '0') + ':' + String(sum % 60).padStart(2, '0')],
            'Add: start time plus the duration.');
        }
        if (v.mode === 'Subtract time' && !isNaN(base)) {
          var diff2 = ((base - total) % 1440 + 1440) % 1440;
          return ok(['Duration: ' + fmtH(total), 'Start ' + v.time1 + ' − ' + fmtH(total) + ' = ' + String(Math.floor(diff2 / 60)).padStart(2, '0') + ':' + String(diff2 % 60).padStart(2, '0')],
            'Subtract: start time minus the duration. A result before midnight wraps to the previous day.');
        }
        return ok(['Duration: ' + fmtH(total)], v.mode === 'Subtract time' ? 'Enter a start time (HH:MM) in the Start time field to subtract this duration from it.' : '');
      } }
  ];

  var UNIT_OPTIONS = {
    Length: ['m', 'km', 'cm', 'mm', 'mile', 'ft', 'in'],
    Weight: ['kg', 'g', 'lb', 'oz'],
    Temperature: ['C', 'F', 'K']
  };

  function defById(id) { return DEFS.find(function (d) { return d.id === id; }) || DEFS[0]; }
  window.FSAI.TOOL_DEFS = DEFS;

  function buildForm(def, form) {
    form.innerHTML = '';
    def.inputs.forEach(function (inp) {
      var wrap = document.createElement('div');
      wrap.className = 'field';
      var label = document.createElement('label');
      label.setAttribute('for', 'tool-' + inp.id);
      label.textContent = inp.label;
      wrap.appendChild(label);
      var el;
      if (inp.type === 'select') {
        el = document.createElement('select');
        inp.options.forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o; opt.textContent = o; el.appendChild(opt);
        });
        el.value = inp.def;
      } else {
        el = document.createElement('input');
        el.type = inp.type === 'text' ? 'text' : inp.type;
        if (inp.type === 'number') { el.step = 'any'; if (inp.min != null) el.min = String(inp.min); }
        el.value = inp.def;
      }
      el.id = 'tool-' + inp.id;
      el.name = inp.id;
      wrap.appendChild(el);
      form.appendChild(wrap);
      if (def.id === 'unit-converter' && inp.id === 'category') {
        el.addEventListener('change', function () {
          var opts = UNIT_OPTIONS[el.value] || UNIT_OPTIONS.Length;
          ['from', 'to'].forEach(function (key) {
            var sel = form.querySelector('#tool-' + key);
            if (!sel) return;
            sel.innerHTML = '';
            opts.forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
          });
          form.querySelector('#tool-from').value = opts[0];
          form.querySelector('#tool-to').value = opts[1] || opts[0];
        });
      }
    });
    var actions = document.createElement('div');
    actions.className = 'tool-actions';
    actions.innerHTML = '<button type="submit" class="btn btn-primary">Calculate</button>' +
      '<button type="button" class="btn btn-outline" id="toolReset">Reset</button>';
    form.appendChild(actions);
    var reset = actions.querySelector('#toolReset');
    reset.addEventListener('click', function () {
      form.reset();
      def.inputs.forEach(function (inp) {
        var el = form.querySelector('#tool-' + inp.id);
        if (el) el.value = inp.def;
      });
      var out = document.getElementById('toolResult');
      if (out) out.innerHTML = '<p class="muted">Enter values and press Calculate.</p>';
    });
  }

  function readValues(def, form) {
    var vals = {};
    def.inputs.forEach(function (inp) {
      var el = form.querySelector('#tool-' + inp.id);
      if (!el) return;
      vals[inp.id] = inp.type === 'number' ? num(el.value) : el.value;
    });
    return vals;
  }

  function showTool(id) {
    var def = defById(id);
    var title = document.getElementById('toolTitle');
    var desc = document.getElementById('toolDescription');
    var form = document.getElementById('toolForm');
    var out = document.getElementById('toolResult');
    var list = document.getElementById('toolList');
    if (title) title.textContent = def.name;
    if (desc) {
      var meta = F.TOOLS.find(function (t) { return t.id === def.id; });
      desc.textContent = meta ? meta.description : '';
    }
    if (list) {
      list.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-tool') === def.id);
        b.setAttribute('aria-current', b.getAttribute('data-tool') === def.id ? 'true' : 'false');
      });
    }
    if (form) {
      buildForm(def, form);
      form.onsubmit = function (e) {
        e.preventDefault();
        var r = def.calc(readValues(def, form));
        if (out) {
          if (r.error) out.innerHTML = '<p class="tool-error" role="alert">' + F.esc(r.error) + '</p>';
          else out.innerHTML = '<ul class="tool-result-list">' + r.lines.map(function (l) { return '<li>' + F.esc(l) + '</li>'; }).join('') + '</ul>' +
            (r.note ? '<p class="muted">' + F.esc(r.note) + '</p>' : '');
        }
      };
    }
    if (out) out.innerHTML = '<p class="muted">Enter values and press Calculate.</p>';
    if (window.history && window.history.replaceState) {
      try { window.history.replaceState(null, '', '?tool=' + def.id); } catch (e) {}
    }
  }

  window.FSAI.showTool = showTool;

  document.addEventListener('DOMContentLoaded', function () {
    var list = document.getElementById('toolList');
    if (list) {
      list.innerHTML = DEFS.map(function (d) {
        var meta = F.TOOLS.find(function (t) { return t.id === d.id; });
        return '<button type="button" class="tool-chip" data-tool="' + d.id + '">' + F.esc(d.name) +
          (meta ? ' <span class="muted">(' + F.esc(meta.category) + ')</span>' : '') + '</button>';
      }).join('');
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tool]');
        if (btn) showTool(btn.getAttribute('data-tool'));
      });
    }
    var params = new URLSearchParams(window.location.search);
    var wanted = params.get('tool');
    if (document.getElementById('toolForm')) showTool(wanted && defById(wanted) ? wanted : DEFS[0].id);
    var grid = document.getElementById('toolGridHome');
    if (grid) {
      grid.innerHTML = F.TOOLS.slice(0, 8).map(function (t) {
        return '<article class="card tool-card reveal visible"><h3>' + F.esc(t.name) + '</h3><p class="card-tag">' + F.esc(t.category) + '</p><p>' + F.esc(t.description) + '</p>' +
          '<a class="btn btn-outline" href="pages/tools.html?tool=' + t.id + '">Open tool →</a></article>';
      }).join('');
    }
  });
})();
