import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Keyboard,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { showToastMessage } from '@components/Toast';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { searchPlaces } from '@utils/placeSearch';

// Full-screen destination picker rendered with Leaflet + OpenStreetMap inside a
// WebView — NO Google Maps API key (react-native-maps' Android base is Google
// Maps, which renders blank without a key; a WebView/Leaflet map avoids Google
// entirely). The default Esri street map labels places in English and the
// local language; Satellite (Esri) lets the driver find the real building when
// search can't, and OpenStreetMap stays available for extra detail. The driver searches a place (phone geocoder + Photon +
// Nominatim, nearest first — see placeSearch.js) and/or taps the map to drop a
// marker, then taps Confirm. We reverse-geocode the marker to a readable name
// and hand {name, latitude, longitude} back to VehicleTrackingForm via the
// `onPicked` route param. Odoo then find-or-creates the matching vehicle.location.

const SUGGEST_DELAY_MS = 450;
const SUGGEST_MIN_CHARS = 3;

const buildLeafletHtml = (lat, lng, zoom) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{height:100%;width:100%;margin:0;padding:0;background:#e9e9e9;}</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  function post(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }
  window.onerror = function (message, src, line, col) {
    post({ type: 'error', msg: String(message) + ' @' + line + ':' + col });
  };
  (function () {
    if (typeof L === 'undefined') {
      post({ type: 'error', msg: 'Leaflet (L) failed to load — CDN blocked or no internet' });
      return;
    }
    post({ type: 'log', msg: 'leaflet loaded, init map' });
    var map = L.map('map', { zoomControl: true }).setView([${lat}, ${lng}], ${zoom});
    var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    // Default: Esri street map — labels in English as well as the local
    // language (OSM's standard map shows only the local name, e.g. Arabic).
    var tiles = L.tileLayer(esri + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles © Esri'
    });
    tiles.on('tileerror', function () { post({ type: 'tileerror' }); });
    tiles.on('load', function () { post({ type: 'tilesloaded' }); });
    tiles.addTo(map);
    // OpenStreetMap — more buildings/small roads, local-language labels.
    var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    });
    // Satellite photo + place labels — find the real building when search can't.
    var satellite = L.layerGroup([
      L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles © Esri'
      }),
      L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19
      })
    ]);
    L.control.layers(
      { 'Map': tiles, 'Satellite': satellite, 'OpenStreetMap': osm },
      null,
      { collapsed: false }
    ).addTo(map);
    var marker = null;
    function place(la, ln) {
      if (marker) { marker.setLatLng([la, ln]); }
      else { marker = L.marker([la, ln]).addTo(map); }
    }
    map.on('click', function (e) {
      place(e.latlng.lat, e.latlng.lng);
      post({ type: 'click', lat: e.latlng.lat, lng: e.latlng.lng });
    });
    window.setMarker = function (la, ln, z) {
      place(la, ln);
      map.setView([la, ln], z || 16);
    };
    // Leaflet sometimes needs a nudge to size correctly inside a WebView.
    setTimeout(function () { map.invalidateSize(); post({ type: 'ready' }); }, 300);
  })();
  true;
</script>
</body>
</html>`;

const DestinationMapPicker = ({ route }) => {
  const navigation = useNavigation();
  const {
    initialLatitude, initialLongitude, initialName, originLatitude, originLongitude, onPicked,
  } = route?.params || {};

  // Center on the driver's current location when we have it, else a sensible
  // default (roughly central India) so the map isn't stuck in the ocean.
  const startLat = Number.isFinite(Number(initialLatitude)) ? Number(initialLatitude) : 20.5937;
  const startLng = Number.isFinite(Number(initialLongitude)) ? Number(initialLongitude) : 78.9629;
  const hasInitial = Number.isFinite(Number(initialLatitude)) && Number.isFinite(Number(initialLongitude));

  // Search results are ranked nearest to the driver (fall back to map centre).
  const searchOrigin = Number.isFinite(Number(originLatitude)) && Number.isFinite(Number(originLongitude))
    ? { latitude: Number(originLatitude), longitude: Number(originLongitude) }
    : (hasInitial ? { latitude: startLat, longitude: startLng } : null);

  const webViewRef = useRef(null);
  const htmlRef = useRef(buildLeafletHtml(startLat, startLng, hasInitial ? 14 : 5));

  const [marker, setMarker] = useState(null);
  const [placeName, setPlaceName] = useState(initialName || '');
  const [resolvingName, setResolvingName] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);

  // Reverse-geocode a coordinate to a readable place name (OS-provided via
  // expo-location — no extra API key).
  const resolveName = useCallback(async (lat, lng) => {
    setResolvingName(true);
    try {
      const rg = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (rg && rg.length > 0) {
        const p = rg[0];
        const name = [p.name, p.street, p.city, p.region].filter(Boolean).join(', ');
        setPlaceName(name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      } else {
        setPlaceName(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    } catch (e) {
      setPlaceName(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setResolvingName(false);
    }
  }, []);

  // Messages from the WebView (Leaflet) — typed: ready/log/error/tileerror/click.
  const handleMessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch (_) {
      console.log('[dest-map] non-JSON message:', event.nativeEvent.data);
      return;
    }
    switch (data?.type) {
      case 'ready':
        console.log('[dest-map] Leaflet map ready');
        return;
      case 'log':
        console.log('[dest-map] web:', data.msg);
        return;
      case 'error':
        console.log('[dest-map] WEBVIEW JS ERROR:', data.msg);
        return;
      case 'tileerror':
        console.log('[dest-map] map tile load error (network/blocked?)');
        return;
      case 'tilesloaded':
        console.log('[dest-map] map tiles loaded');
        return;
      case 'click': {
        const lat = Number(data.lat);
        const lng = Number(data.lng);
        console.log('[dest-map] map tap:', lat, lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setMarker({ latitude: lat, longitude: lng });
          resolveName(lat, lng);
        }
        return;
      }
      default:
        console.log('[dest-map] unknown message:', JSON.stringify(data));
    }
  };

  // Recenter + drop the pin inside the WebView map.
  const moveWebMarker = (lat, lng) => {
    webViewRef.current?.injectJavaScript(`window.setMarker(${lat}, ${lng}, 16); true;`);
  };

  // Only the newest search may show its results (older ones can finish later).
  const searchSeqRef = useRef(0);
  const suggestTimerRef = useRef(null);

  // Free place search — no Google key. `full` (Search button) also asks
  // Nominatim; typing suggestions skip it (its policy forbids autocomplete).
  const doSearch = useCallback(async (text, full) => {
    const q = text.trim();
    if (!q) return;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    if (full) setResults([]);
    const list = await searchPlaces(q, searchOrigin, { includeNominatim: full });
    if (seq !== searchSeqRef.current) return;
    setSearching(false);
    setResults(list);
    if (full && list.length === 0) {
      showToastMessage('Not found. Switch to Satellite and tap the building.', 'info');
    }
  }, [searchOrigin?.latitude, searchOrigin?.longitude]);

  const runSearch = useCallback(() => {
    clearTimeout(suggestTimerRef.current);
    Keyboard.dismiss();
    doSearch(searchText, true);
  }, [searchText, doSearch]);

  const handleSearchTextChange = (text) => {
    setSearchText(text);
    clearTimeout(suggestTimerRef.current);
    if (text.trim().length < SUGGEST_MIN_CHARS) {
      searchSeqRef.current++;
      setSearching(false);
      setResults([]);
      return;
    }
    suggestTimerRef.current = setTimeout(() => doSearch(text, false), SUGGEST_DELAY_MS);
  };

  useEffect(() => () => clearTimeout(suggestTimerRef.current), []);

  const handleSelectResult = (item) => {
    const lat = item.latitude;
    const lng = item.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const label = [item.name, item.subtitle].filter(Boolean).join(', ');
    console.log('[dest-map] search result picked:', label, lat, lng);
    searchSeqRef.current++;
    setSearching(false);
    setMarker({ latitude: lat, longitude: lng });
    setPlaceName(label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    moveWebMarker(lat, lng);
    setResults([]);
    setSearchText('');
    Keyboard.dismiss();
  };

  const handleConfirm = () => {
    if (!marker) {
      showToastMessage('Tap the map to choose a destination first', 'info');
      return;
    }
    console.log('[dest-map] confirm destination:', placeName, marker.latitude, marker.longitude);
    if (typeof onPicked === 'function') {
      onPicked({
        name: placeName || `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}`,
        latitude: marker.latitude,
        longitude: marker.longitude,
      });
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView>
      <NavigationHeader title="Select Destination" onBackPress={() => navigation.goBack()} />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <MaterialCommunityIcons name="magnify" size={20} color={COLORS.gray} style={{ marginLeft: 10 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search a place, shop or company"
          placeholderTextColor={COLORS.gray}
          value={searchText}
          onChangeText={handleSearchTextChange}
          onSubmitEditing={runSearch}
          returnKeyType="search"
        />
        {searching ? (
          <ActivityIndicator size="small" color={COLORS.primaryThemeColor} style={{ marginRight: 12 }} />
        ) : (
          <TouchableOpacity onPress={runSearch} style={styles.searchBtn}>
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search results dropdown */}
      {results.length > 0 && (
        <View style={styles.resultsBox}>
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.resultRow} onPress={() => handleSelectResult(item)}>
                <MaterialCommunityIcons name="map-marker-outline" size={18} color={COLORS.primaryThemeColor} />
                <View style={styles.resultTextWrap}>
                  <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
                  {!!item.subtitle && (
                    <Text style={styles.resultText} numberOfLines={1}>{item.subtitle}</Text>
                  )}
                </View>
                {item.distanceKm != null && (
                  <Text style={styles.resultDistance}>
                    {item.distanceKm < 10 ? item.distanceKm.toFixed(1) : Math.round(item.distanceKm)} km
                  </Text>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <View style={styles.mapWrap}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: htmlRef.current }}
          onMessage={handleMessage}
          onLoadStart={() => console.log('[dest-map] WebView load start')}
          onLoadEnd={() => console.log('[dest-map] WebView load end')}
          onError={(e) => console.log('[dest-map] WebView ERROR:', e?.nativeEvent?.description)}
          onHttpError={(e) => console.log('[dest-map] WebView HTTP ERROR:', e?.nativeEvent?.statusCode, e?.nativeEvent?.url)}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.mapLoading}>
              <ActivityIndicator size="large" color={COLORS.primaryThemeColor} />
            </View>
          )}
          style={StyleSheet.absoluteFill}
        />

        {/* Hint when nothing picked yet */}
        {!marker && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>Tap on the map to drop a destination pin</Text>
          </View>
        )}
      </View>

      {/* Selected place + confirm */}
      <View style={styles.footer}>
        <View style={styles.selectedRow}>
          <MaterialCommunityIcons name="map-marker-check" size={20} color={COLORS.primaryThemeColor} />
          <Text style={styles.selectedText} numberOfLines={2}>
            {resolvingName ? 'Resolving place…' : (placeName || 'No destination selected')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.confirmBtn, !marker && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!marker}
        >
          <Text style={styles.confirmBtnText}>Confirm Destination</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontFamily: FONT_FAMILY.urbanistRegular,
    fontSize: 14,
    color: '#222',
  },
  searchBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 8,
    marginRight: 6,
  },
  searchBtnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistSemiBold, fontSize: 13 },
  resultsBox: {
    maxHeight: 220,
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
    zIndex: 20,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  resultTextWrap: { flex: 1, marginLeft: 8 },
  resultName: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#222' },
  resultText: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistRegular, color: '#666', marginTop: 1 },
  resultDistance: { marginLeft: 8, fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: COLORS.gray },
  mapWrap: { flex: 1, margin: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#e9e9e9' },
  mapLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e9e9e9' },
  hint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  hintText: { color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  selectedText: { flex: 1, marginLeft: 8, fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222' },
  confirmBtn: {
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#B7C2CE' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistSemiBold },
});

export default DestinationMapPicker;
