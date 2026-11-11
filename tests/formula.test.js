// FS AI — formula tests for the 20 free digital tools.
// Self-contained: the formulas under test are defined in this file, so the
// suite runs with no other source files and no network access.
// Run: node --test tests/formula.test.js  (or: npm test)
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Helpers under test (the same formulas the Digital Tools agent ships)
// ---------------------------------------------------------------------------
function fuelCost(distanceKm, mileageKmPerLitre, pricePerLitre) {
  if (distanceKm < 0 || mileageKmPerLitre <= 0 || pricePerLitre < 0) {
    throw new RangeError('distance, mileage and price must be non-negative; mileage must be > 0');
  }
  return (distanceKm / mileageKmPerLitre) * pricePerLitre;
}

function loanMonthlyPayment(principal, annualRatePct, months) {
  if (principal <= 0 || annualRatePct < 0 || months <= 0) {
    throw new RangeError('principal and months must be > 0; rate must be >= 0');
  }
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  const factor = Math.pow(1 + r, months);
  return (principal * r * factor) / (factor - 1);
}

function savingsMonthly(goalAmount, months) {
  if (goalAmount < 0 || months <= 0) throw new RangeError('goal must be >= 0; months must be > 0');
  return goalAmount / months;
}

function percentageOf(percent, total) {
  return (total * percent) / 100;
}

function percentChange(oldValue, newValue) {
  if (oldValue === 0) throw new RangeError('old value must not be 0');
  return ((newValue - oldValue) / oldValue) * 100;
}

function ageOn(birthIso, asOfIso) {
  const birth = new Date(birthIso + 'T00:00:00Z');
  const asOf = new Date(asOfIso + 'T00:00:00Z');
  if (Number.isNaN(birth.getTime()) || Number.isNaN(asOf.getTime()) || asOf < birth) {
    throw new RangeError('invalid dates: birth must be a valid date on or before as-of');
  }
  let years = asOf.getUTCFullYear() - birth.getUTCFullYear();
  let months = asOf.getUTCMonth() - birth.getUTCMonth();
  let days = asOf.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 0));
    days += prevMonth.getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

const kmToMiles = (km) => km * 0.621371;
const milesToKm = (miles) => miles / 0.621371;
const kgToLb = (kg) => kg * 2.20462;
const lbToKg = (lb) => lb / 2.20462;
const celsiusToFahrenheit = (c) => (c * 9) / 5 + 32;
const fahrenheitToCelsius = (f) => ((f - 32) * 5) / 9;

function bmi(weightKg, heightM) {
  if (weightKg <= 0 || heightM <= 0) throw new RangeError('weight and height must be > 0');
  return weightKg / (heightM * heightM);
}

function tipAmount(bill, tipPct) {
  if (bill < 0 || tipPct < 0) throw new RangeError('bill and tip must be >= 0');
  return (bill * tipPct) / 100;
}
function totalPerPerson(bill, tipPct, people) {
  if (people <= 0) throw new RangeError('people must be > 0');
  return (bill + tipAmount(bill, tipPct)) / people;
}

function salePrice(price, discountPct) {
  if (price < 0 || discountPct < 0 || discountPct > 100) {
    throw new RangeError('price must be >= 0; discount must be 0–100');
  }
  return price * (1 - discountPct / 100);
}
const amountSaved = (price, discountPct) => price - salePrice(price, discountPct);

function compoundInterest(principal, annualRatePct, compoundsPerYear, years) {
  if (principal < 0 || annualRatePct < 0 || compoundsPerYear <= 0 || years < 0) {
    throw new RangeError('invalid compound-interest inputs');
  }
  return principal * Math.pow(1 + annualRatePct / 100 / compoundsPerYear, compoundsPerYear * years);
}

// EMI uses the same amortisation formula as a loan payment.
const emi = (principal, annualRatePct, months) => loanMonthlyPayment(principal, annualRatePct, months);

function travelBudgetTotal(daily, days) {
  if (days <= 0) throw new RangeError('days must be > 0');
  const perDay = daily.transport + daily.stay + daily.food + daily.activities;
  return perDay * days;
}

function dailyCalories({ sex, weightKg, heightCm, ageYears, activityFactor }) {
  if (weightKg <= 0 || heightCm <= 0 || ageYears <= 0 || activityFactor <= 0) {
    throw new RangeError('calorie inputs must be > 0');
  }
  // Mifflin-St Jeor BMR, then activity multiplier.
  const bmr =
    sex === 'female'
      ? 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161
      : 10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5;
  return bmr * activityFactor;
}

function wordCount(text) {
  const words = text.trim() === '' ? [] : text.trim().split(/\s+/);
  const characters = text.length;
  const readingMinutes = Math.ceil(words.length / 200);
  return { words: words.length, characters, readingMinutes };
}

function generatePassword(length, charset) {
  if (length <= 0 || !charset) throw new RangeError('length must be > 0 and charset non-empty');
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += charset[Math.floor(Math.random() * charset.length)];
  }
  return out;
}

const mphToKmh = (mph) => mph * 1.60934;
const kmhToMph = (kmh) => kmh / 1.60934;
const knotsToKmh = (knots) => knots * 1.852;

const acresToSqm = (acres) => acres * 4046.86;
const sqftToSqm = (sqft) => sqft * 0.092903;

const convertCurrency = (amount, rate) => amount * rate;

// Time-zone conversion by UTC-offset difference (minutes).
function convertTimeZone(timeHHMM, fromOffsetMinutes, toOffsetMinutes) {
  const [h, m] = timeHHMM.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new RangeError('time must be HH:MM, 24-hour');
  }
  const total = (h * 60 + m - fromOffsetMinutes + toOffsetMinutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
function approx(actual, expected, epsilon = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

describe('Fuel Cost Calculator', () => {
  it('300 km at 15 km/L and $1.50/L costs $30.00', () => {
    assert.equal(fuelCost(300, 15, 1.5), 30);
  });
  it('0 km costs 0', () => assert.equal(fuelCost(0, 15, 1.5), 0));
  it('rejects zero mileage', () => assert.throws(() => fuelCost(100, 0, 1.5), RangeError));
});

describe('Loan Payment / EMI Calculator', () => {
  it('$10,000 at 12% over 12 months pays $888.49/month', () => {
    approx(loanMonthlyPayment(10000, 12, 12), 888.49);
  });
  it('0% interest splits the principal evenly', () => {
    assert.equal(loanMonthlyPayment(1200, 0, 12), 100);
  });
  it('EMI: $5,000 at 10% over 24 months pays $230.72/month', () => {
    approx(emi(5000, 10, 24), 230.72);
  });
  it('rejects a non-positive term', () => assert.throws(() => loanMonthlyPayment(1000, 5, 0), RangeError));
});

describe('Savings Goal Calculator', () => {
  it('$1,200 over 12 months needs $100/month', () => {
    assert.equal(savingsMonthly(1200, 12), 100);
  });
  it('$5,000 over 10 months needs $500/month', () => {
    assert.equal(savingsMonthly(5000, 10), 500);
  });
});

describe('Percentage Calculator', () => {
  it('20% of 250 is 50', () => assert.equal(percentageOf(20, 250), 50));
  it('a rise from 80 to 100 is +25%', () => assert.equal(percentChange(80, 100), 25));
  it('a fall from 200 to 150 is -25%', () => assert.equal(percentChange(200, 150), -25));
});

describe('Age Calculator', () => {
  it('born 2000-01-15, as of 2026-11-11: 26 years, 9 months, 27 days', () => {
    assert.deepEqual(ageOn('2000-01-15', '2026-11-11'), { years: 26, months: 9, days: 27 });
  });
  it('same day gives 0 years, 0 months, 0 days', () => {
    assert.deepEqual(ageOn('2026-11-11', '2026-11-11'), { years: 0, months: 0, days: 0 });
  });
  it('rejects an as-of date before birth', () => {
    assert.throws(() => ageOn('2026-01-01', '2020-01-01'), RangeError);
  });
});

describe('Unit Converter', () => {
  it('100 km = 62.1371 miles', () => approx(kmToMiles(100), 62.1371, 0.0001));
  it('62.1371 miles = 100 km (round trip)', () => approx(milesToKm(62.1371), 100, 0.001));
  it('10 kg = 22.0462 lb', () => approx(kgToLb(10), 22.0462, 0.0001));
  it('22.0462 lb = 10 kg (round trip)', () => approx(lbToKg(22.0462), 10, 0.001));
  it('0°C = 32°F and 100°C = 212°F', () => {
    assert.equal(celsiusToFahrenheit(0), 32);
    assert.equal(celsiusToFahrenheit(100), 212);
  });
  it('32°F = 0°C', () => assert.equal(fahrenheitToCelsius(32), 0));
});

describe('BMI Calculator', () => {
  it('70 kg at 1.75 m gives BMI 22.86', () => approx(bmi(70, 1.75), 22.86));
  it('rejects zero height', () => assert.throws(() => bmi(70, 0), RangeError));
});

describe('Currency Converter', () => {
  it('$100 at rate 0.85 converts to 85', () => assert.equal(convertCurrency(100, 0.85), 85));
});

describe('Tip Calculator', () => {
  it('15% tip on $100 is $15', () => assert.equal(tipAmount(100, 15), 15));
  it('$100 bill + 15% tip split 4 ways is $28.75 each', () => {
    assert.equal(totalPerPerson(100, 15, 4), 28.75);
  });
});

describe('Discount Calculator', () => {
  it('25% off $200 gives a $150 sale price and $50 saved', () => {
    assert.equal(salePrice(200, 25), 150);
    assert.equal(amountSaved(200, 25), 50);
  });
  it('rejects a discount above 100%', () => assert.throws(() => salePrice(100, 101), RangeError));
});

describe('Compound Interest Calculator', () => {
  it('$1,000 at 5% compounded monthly for 5 years grows to $1,283.36', () => {
    approx(compoundInterest(1000, 5, 12, 5), 1283.36, 0.05);
  });
  it('0 years returns the principal', () => {
    assert.equal(compoundInterest(1000, 5, 12, 0), 1000);
  });
});

describe('Travel Budget Calculator', () => {
  it('$110/day for 5 days totals $550', () => {
    assert.equal(
      travelBudgetTotal({ transport: 20, stay: 50, food: 30, activities: 10 }, 5),
      550,
    );
  });
});

describe('Calorie Calculator (Mifflin-St Jeor)', () => {
  it('male, 80 kg, 180 cm, 30 y, factor 1.55 needs 2,759 kcal/day', () => {
    approx(
      dailyCalories({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 30, activityFactor: 1.55 }),
      2759,
    );
  });
  it('female, 80 kg, 180 cm, 30 y, factor 1.375 needs 2,219.25 kcal/day', () => {
    approx(
      dailyCalories({ sex: 'female', weightKg: 80, heightCm: 180, ageYears: 30, activityFactor: 1.375 }),
      2219.25,
    );
  });
});

describe('Word Counter', () => {
  it('"hello world" is 2 words, 11 characters', () => {
    const result = wordCount('hello world');
    assert.equal(result.words, 2);
    assert.equal(result.characters, 11);
  });
  it('empty text is 0 words', () => assert.equal(wordCount('   ').words, 0));
  it('400 words reads in 2 minutes at 200 wpm', () => {
    assert.equal(wordCount('word '.repeat(400).trim()).readingMinutes, 2);
  });
});

describe('Password Generator', () => {
  it('returns the requested length using only the given charset', () => {
    const charset = 'abc123';
    const password = generatePassword(12, charset);
    assert.equal(password.length, 12);
    assert.ok([...password].every((ch) => charset.includes(ch)));
  });
  it('rejects length 0', () => assert.throws(() => generatePassword(0, 'abc'), RangeError));
});

describe('Speed Converter', () => {
  it('60 mph = 96.5604 km/h', () => approx(mphToKmh(60), 96.5604, 0.0001));
  it('100 km/h = 62.1373 mph', () => approx(kmhToMph(100), 62.1373, 0.0001));
  it('10 knots = 18.52 km/h', () => approx(knotsToKmh(10), 18.52, 0.001));
});

describe('Area Converter', () => {
  it('1 acre = 4046.86 sq m', () => approx(acresToSqm(1), 4046.86, 0.01));
  it('100 sq ft = 9.2903 sq m', () => approx(sqftToSqm(100), 9.2903, 0.0001));
});

describe('Time Zone Converter', () => {
  it('12:00 at UTC+6 is 06:00 at UTC+0', () => {
    assert.equal(convertTimeZone('12:00', 360, 0), '06:00');
  });
  it('23:30 at UTC+0 is 05:30 next day at UTC+6', () => {
    assert.equal(convertTimeZone('23:30', 0, 360), '05:30');
  });
  it('rejects an invalid time', () => {
    assert.throws(() => convertTimeZone('25:00', 0, 60), RangeError);
  });
});
