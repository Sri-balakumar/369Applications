// src/utils/addressFromCoords.js
//
// Turn GPS coordinates into a real street address, e.g.
// "12, 2nd Street, Sivamurugan Colony, Dindigul, Tamil Nadu 624001".
//
// 1) OS geocoder (expo-location) — Android gives a full `formattedAddress`;
//    otherwise we build one from street / district / city parts.
// 2) If the OS result has no street or area (common on devices without
//    Google services), fall back to OpenStreetMap Nominatim, which knows
//    colonies / neighbourhoods.

import * as Location from 'expo-location';

const NOMINATIM_HEADERS = {
  'User-Agent': 'AlphalizeApp/1.0 (visit address lookup)',
  'Accept': 'application/json',
};

// Google plus codes ("6XQ8+2P") are useless to a reader — drop them.
const PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3}$/i;
const LEADING_PLUS_CODE_RE = /^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3}[\s,]*/i;

// Join parts, skipping blanks, plus codes and case-insensitive duplicates.
const joinParts = (parts) => {
  const seen = new Set();
  const out = [];
  parts.forEach((raw) => {
    const s = (raw == null ? '' : String(raw)).trim();
    if (!s || PLUS_CODE_RE.test(s)) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  });
  return out.join(', ');
};

const fromExpoPlace = (p) => {
  if (!p) return { address: '', detailed: false };
  const detailed = !!(p.street || p.district);
  if (p.formattedAddress) {
    const formatted = String(p.formattedAddress).replace(LEADING_PLUS_CODE_RE, '').trim();
    if (formatted) return { address: formatted, detailed };
  }
  const street = [p.streetNumber, p.street].filter(Boolean).join(' ');
  const cityLine = [p.city, p.region].filter(Boolean).join(', ');
  const address = joinParts([
    p.name !== p.street && p.name !== p.streetNumber ? p.name : '',
    street,
    p.district,
    cityLine,
    p.postalCode,
  ]);
  return { address, detailed };
};

const fromNominatim = async (lat, lng) => {
  const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18'
    + `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
  const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
  const data = await resp.json();
  const a = data?.address;
  if (!a) return '';
  return joinParts([
    a.house_number,
    a.road,
    a.neighbourhood || a.residential,
    a.suburb || a.quarter,
    a.village || a.town || a.city,
    a.state,
    a.postcode,
  ]);
};

/**
 * Best-effort street address for a coordinate. Never throws; returns ''
 * when nothing could be resolved.
 */
export const getAddressFromCoords = async (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return '';

  let osAddress = '';
  let detailed = false;
  try {
    const rg = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    ({ address: osAddress, detailed } = fromExpoPlace(rg?.[0]));
  } catch (e) {
    console.log('[addressFromCoords] OS reverse geocode failed:', e?.message);
  }
  if (osAddress && detailed) return osAddress;

  try {
    const osm = await fromNominatim(lat, lng);
    if (osm) return osm;
  } catch (e) {
    console.log('[addressFromCoords] Nominatim reverse failed:', e?.message);
  }
  return osAddress;
};

export default getAddressFromCoords;
