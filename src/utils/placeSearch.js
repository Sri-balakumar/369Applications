// src/utils/placeSearch.js
//
// Free place search (no Google API key) for the destination picker. Asks three
// sources at once and merges them, nearest first:
//   1) the phone's own geocoder (expo-location) — Google data on most Android
//      phones, good for shops and company names;
//   2) Photon (komoot) — OpenStreetMap search that tolerates typos and allows
//      search-as-you-type;
//   3) Nominatim — OpenStreetMap search; only on an explicit search, because
//      its usage policy forbids autocomplete.
// Results are limited to the user's country and labelled in English.

import * as Location from 'expo-location';

const NOMINATIM_HEADERS = {
  'User-Agent': 'AlphalizeApp/1.0 (vehicle-tracking destination picker)',
  'Accept': 'application/json',
  'Accept-Language': 'en',
};

const MAX_RESULTS = 10;

// Country of the user's location, e.g. 'om'. Cached per coordinate (rounded).
let countryCache = { key: '', code: '' };

const toRad = (d) => (d * Math.PI) / 180;
const distanceKm = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const joinParts = (parts, exclude = '') => {
  const seen = new Set([String(exclude).trim().toLowerCase()]);
  const out = [];
  parts.forEach((raw) => {
    const s = (raw == null ? '' : String(raw)).trim();
    const key = s.toLowerCase();
    if (!s || seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out.join(', ');
};

const getCountryCode = async (origin) => {
  if (!origin) return '';
  const key = `${origin.latitude.toFixed(1)},${origin.longitude.toFixed(1)}`;
  if (countryCache.key === key) return countryCache.code;
  try {
    const rg = await Location.reverseGeocodeAsync(origin);
    const code = (rg?.[0]?.isoCountryCode || '').toLowerCase();
    countryCache = { key, code };
    return code;
  } catch (e) {
    return '';
  }
};

const fromPhoton = async (q, origin) => {
  let url = 'https://photon.komoot.io/api/?lang=en&limit=15&q=' + encodeURIComponent(q);
  if (origin) url += `&lat=${origin.latitude}&lon=${origin.longitude}`;
  const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
  const data = await resp.json();
  return (data?.features || []).map((f) => {
    const p = f.properties || {};
    const [lng, lat] = f.geometry?.coordinates || [];
    const name = p.name || joinParts([p.housenumber, p.street]);
    return {
      name,
      subtitle: joinParts([p.street, p.district, p.city, p.state, p.country], name),
      latitude: Number(lat),
      longitude: Number(lng),
      country: (p.countrycode || '').toLowerCase(),
    };
  });
};

const fromNominatim = async (q, origin, country) => {
  let url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1'
    + '&accept-language=en&limit=10&q=' + encodeURIComponent(q);
  if (country) url += `&countrycodes=${country}`;
  if (origin) {
    const { latitude: la, longitude: ln } = origin;
    url += `&viewbox=${ln - 1},${la + 1},${ln + 1},${la - 1}`;
  }
  const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
  const data = await resp.json();
  return (Array.isArray(data) ? data : []).map((x) => {
    const [first, ...rest] = String(x.display_name || '').split(',');
    return {
      name: x.name || first.trim(),
      subtitle: rest.join(',').trim(),
      latitude: parseFloat(x.lat),
      longitude: parseFloat(x.lon),
      country: (x.address?.country_code || '').toLowerCase(),
    };
  });
};

const fromPhoneGeocoder = async (q) => {
  const hits = (await Location.geocodeAsync(q)) || [];
  return Promise.all(hits.slice(0, 3).map(async ({ latitude, longitude }) => {
    let p = null;
    try {
      p = (await Location.reverseGeocodeAsync({ latitude, longitude }))?.[0];
    } catch (_) { /* label falls back to the query */ }
    const name = p?.name && !/\+/.test(p.name) ? p.name : q;
    return {
      name,
      subtitle: joinParts([p?.street, p?.district, p?.city, p?.region, p?.country], name),
      latitude,
      longitude,
      country: (p?.isoCountryCode || '').toLowerCase(),
    };
  }));
};

/**
 * Search places by name. `origin` ({latitude, longitude}) ranks nearby results
 * first and keeps them in the user's country. Never throws; returns
 * [{ id, name, subtitle, latitude, longitude, distanceKm }].
 */
export const searchPlaces = async (query, origin = null, { includeNominatim = true } = {}) => {
  const q = String(query || '').trim();
  if (!q) return [];
  const o = origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude)
    ? origin : null;
  const country = await getCountryCode(o);

  const settled = await Promise.allSettled([
    fromPhoneGeocoder(q),
    fromPhoton(q, o),
    includeNominatim ? fromNominatim(q, o, country) : Promise.resolve([]),
  ]);
  settled.forEach((s, i) => {
    if (s.status === 'rejected') console.log('[placeSearch] source', i, 'failed:', s.reason?.message);
  });

  const merged = [];
  settled.forEach((s) => {
    if (s.status !== 'fulfilled') return;
    s.value.forEach((r) => {
      if (!r.name || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return;
      if (country && r.country && r.country !== country) return;
      const dup = merged.some((m) => m.name.toLowerCase() === r.name.toLowerCase()
        && distanceKm(m.latitude, m.longitude, r.latitude, r.longitude) < 0.15);
      if (dup) return;
      merged.push({
        ...r,
        distanceKm: o ? distanceKm(o.latitude, o.longitude, r.latitude, r.longitude) : null,
      });
    });
  });

  if (o) merged.sort((a, b) => a.distanceKm - b.distanceKm);
  return merged.slice(0, MAX_RESULTS).map((r, idx) => ({
    id: `${idx}-${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`,
    name: r.name,
    subtitle: r.subtitle,
    latitude: r.latitude,
    longitude: r.longitude,
    distanceKm: r.distanceKm,
  }));
};

export default searchPlaces;
