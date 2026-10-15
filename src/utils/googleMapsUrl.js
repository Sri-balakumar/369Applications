// src/utils/googleMapsUrl.js
//
// Read a place out of a Google Maps web address, e.g.
// https://www.google.com/maps/place/Falaj+Al+Qabail/@24.42,56.61,15z/data=...!3d24.4294!4d56.6102...
// Used by GoogleMapsPlacePicker, which watches the address while the driver
// searches and taps places on the Google Maps website.

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PIN_RE = new RegExp(`!3d${NUM}!4d${NUM}`);
const CENTER_RE = new RegExp(`/@${NUM},${NUM}`);
const QUERY_RE = new RegExp(`[?&](?:q|query|ll)=${NUM}(?:,|%2C)${NUM}`, 'i');
const PLACE_RE = /\/maps\/place\/([^/@?]+)/;

const validCoords = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const decodeName = (raw) => {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
  } catch (_) {
    return raw.replace(/\+/g, ' ').trim();
  }
};

/**
 * Returns { name, latitude, longitude, isPlace } or null when the address
 * holds no coordinates. `isPlace` is true for a tapped place (/maps/place/…),
 * false for a plain map view.
 */
export const parseGoogleMapsUrl = (url) => {
  const s = String(url || '');
  if (!/google\.[a-z.]+\/maps/i.test(s)) return null;

  // Exact place pin first, then the map centre, then ?q=lat,lng.
  const m = s.match(PIN_RE) || s.match(CENTER_RE) || s.match(QUERY_RE);
  if (!m) return null;
  const latitude = parseFloat(m[1]);
  const longitude = parseFloat(m[2]);
  if (!validCoords(latitude, longitude)) return null;

  const placeMatch = s.match(PLACE_RE);
  let name = placeMatch ? decodeName(placeMatch[1]) : '';
  // A dropped pin's "place" is just its coordinates — not a name.
  if (/^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(name) || /^[\d°'".\s,NSEW-]+$/.test(name)) name = '';

  return { name, latitude, longitude, isPlace: !!placeMatch };
};

export default parseGoogleMapsUrl;
