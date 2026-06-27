const PAGE_SIZE = 20;
const MAX_RESULTS = 60;

function json(statusCode, payload) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(payload) };
}
function normalizeSpace(value = '') { return String(value || '').replace(/\s+/g, ' ').trim(); }
function numberValue(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function buildQuery(keyword, location) { return [normalizeSpace(keyword), normalizeSpace(location)].filter(Boolean).join(' '); }
function mapsUrl(result, query) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', result.title || result.name || query);
  return url.toString();
}
function scoreResult(result) {
  let score = 35;
  if (result.phone) score += 25;
  if (result.website) score += 20;
  if (numberValue(result.rating) >= 4) score += 10;
  if (numberValue(result.reviews) >= 20) score += 5;
  if (result.type) score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}
function normalizeResult(result, keyword, location, index, query) {
  const lead = {
    id: Date.now() + index,
    place_id: result.place_id || '',
    data_id: result.data_id || '',
    name: normalizeSpace(result.title || result.name || 'Unknown company'),
    phone: normalizeSpace(result.phone || result.phone_number || ''),
    email: '',
    website: normalizeSpace(result.website || result.link || ''),
    address: normalizeSpace(result.address || result.full_address || ''),
    type: normalizeSpace(result.type || result.category || (Array.isArray(result.types) ? result.types[0] : '') || ''),
    rating: result.rating || '',
    reviews: result.reviews || result.reviews_original || '',
    keyword: normalizeSpace(keyword),
    location: normalizeSpace(location),
    maps_url: result.place_id ? 'https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(result.place_id) : mapsUrl(result, query),
    source: 'serpapi-google-maps-netlify',
    updated_at: new Date().toISOString()
  };
  lead.score = scoreResult(lead);
  return lead;
}
async function fetchSerpApiPage(apiKey, query, start) {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_maps');
  url.searchParams.set('type', 'search');
  url.searchParams.set('q', query);
  url.searchParams.set('start', String(start));
  url.searchParams.set('api_key', apiKey);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error || 'SerpApi error ' + response.status);
  return data.local_results || data.place_results || [];
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const requiredPassword = normalizeSpace(process.env.ACCESS_PASSWORD || '');
  if (requiredPassword) {
    const provided = normalizeSpace(event.headers['x-access-password'] || event.headers['X-Access-Password'] || '');
    if (provided !== requiredPassword) return json(401, { error: 'Mật khẩu truy cập không đúng.' });
  }
  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Body JSON không hợp lệ.' }); }
  const keyword = normalizeSpace(payload.keyword);
  const location = normalizeSpace(payload.location);
  const apiKey = normalizeSpace(payload.serpapi_key || payload.api_key);
  if (!keyword) return json(400, { error: 'Nhập từ khóa.' });
  if (!location) return json(400, { error: 'Nhập địa điểm.' });
  if (!apiKey) return json(400, { error: 'Nhập SerpApi key.' });
  const query = buildQuery(keyword, location);
  const seen = new Set();
  const results = [];
  try {
    for (let start = 0; start < MAX_RESULTS; start += PAGE_SIZE) {
      const page = await fetchSerpApiPage(apiKey, query, start);
      if (!page.length) break;
      for (const item of page) {
        const lead = normalizeResult(item, keyword, location, results.length + 1, query);
        const key = lead.place_id || lead.data_id || lead.website || (lead.name + '|' + lead.address).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(lead);
      }
      if (page.length < PAGE_SIZE) break;
    }
  } catch (error) {
    return json(400, { error: error instanceof Error ? error.message : String(error), query });
  }
  return json(200, { query, count: results.length, results });
}
