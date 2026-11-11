/**
 * FS AI — Tools route. The 20 real free tools.
 * All tools run client-side / on the free tier; none require sign-up or payment.
 * Currency conversion uses a manually entered rate — no live-rate claim is made.
 */
import { jsonOk, jsonError } from '../middleware/validation.js';

export const TOOLS = [
  { id: 1, slug: 'fuel-cost', name: 'Fuel Cost', category: 'Automotive', description: 'Estimate fuel cost for a trip from distance, mileage and fuel price.' },
  { id: 2, slug: 'mileage', name: 'Mileage', category: 'Automotive', description: 'Calculate vehicle mileage (km per litre) from distance and fuel used.' },
  { id: 3, slug: 'maintenance-planner', name: 'Maintenance Planner', category: 'Automotive', description: 'Plan routine car maintenance by date and mileage.' },
  { id: 4, slug: 'tyre-pressure', name: 'Tyre Pressure', category: 'Automotive', description: 'Convert tyre pressure between PSI, bar and kPa.' },
  { id: 5, slug: 'monthly-budget', name: 'Monthly Budget', category: 'Finance', description: 'Split monthly income using the 50/30/20 budgeting rule.' },
  { id: 6, slug: 'savings', name: 'Savings', category: 'Finance', description: 'Project savings growth from a regular monthly amount.' },
  { id: 7, slug: 'loan-payment', name: 'Loan Payment', category: 'Finance', description: 'Calculate monthly loan payments and total interest.' },
  { id: 8, slug: 'currency-manual-rate', name: 'Currency (manual rate)', category: 'Finance', description: 'Convert currency with a rate you enter yourself — no live-rate claim.' },
  { id: 9, slug: 'storage', name: 'Storage', category: 'Digital', description: 'Convert storage units: bytes, KB, MB, GB and TB.' },
  { id: 10, slug: 'internet-speed', name: 'Internet Speed', category: 'Digital', description: 'Convert internet speed units and estimate download times.' },
  { id: 11, slug: 'data-unit', name: 'Data Unit', category: 'Digital', description: 'Convert data units between bits, bytes and larger units.' },
  { id: 12, slug: 'file-size', name: 'File Size', category: 'Digital', description: 'Convert file sizes and estimate how many files fit a storage size.' },
  { id: 13, slug: 'travel-budget', name: 'Travel Budget', category: 'Travel', description: 'Plan a trip budget across transport, stay, food and activities.' },
  { id: 14, slug: 'distance', name: 'Distance', category: 'Travel', description: 'Convert distances between kilometres, miles, metres and feet.' },
  { id: 15, slug: 'trip-cost', name: 'Trip Cost', category: 'Travel', description: 'Estimate the total cost of a trip, including fuel or fares.' },
  { id: 16, slug: 'age', name: 'Age', category: 'General', description: 'Calculate age from a date of birth.' },
  { id: 17, slug: 'percentage', name: 'Percentage', category: 'General', description: 'Percentage, percentage change and percentage-of calculations.' },
  { id: 18, slug: 'date', name: 'Date', category: 'General', description: 'Date difference and adding or subtracting days from a date.' },
  { id: 19, slug: 'unit', name: 'Unit', category: 'General', description: 'General unit converter for length, weight and temperature.' },
  { id: 20, slug: 'time', name: 'Time', category: 'General', description: 'Convert time units and time-zone-friendly duration calculations.' },
];

export async function handleTools(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (method !== 'GET') return jsonError('Method not allowed', 405);

  if (parts.length === 3) {
    const slug = decodeURIComponent(parts[2]);
    if (env.DB) {
      const { results } = await env.DB.prepare('SELECT * FROM tools WHERE slug = ? LIMIT 1').bind(slug).all();
      if (!results.length) return jsonError('Tool not found', 404);
      return jsonOk({ tool: results[0], source: 'd1' });
    }
    const tool = TOOLS.find((t) => t.slug === slug);
    if (!tool) return jsonError('Tool not found', 404);
    return jsonOk({ tool, source: 'fallback' });
  }

  const category = url.searchParams.get('category');
  if (env.DB) {
    const { results } = await env.DB.prepare('SELECT * FROM tools ORDER BY id ASC').all();
    const tools = category ? results.filter((t) => t.category === category) : results;
    return jsonOk({ tools, total: tools.length, source: 'd1' });
  }
  const tools = category ? TOOLS.filter((t) => t.category === category) : TOOLS;
  return jsonOk({ tools, total: tools.length, source: 'fallback' });
}
