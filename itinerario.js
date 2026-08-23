/**
 * Planejador de itinerário do dia — edição, tempos de deslocamento e mapa.
 * Dados originais: data/itinerario-original.json (intacto).
 * Edições: localStorage.
 */

const ITINERARIO_STORAGE_KEY = 'orlando_itinerario_v1';
const TRAVEL_MODES = [
    { id: 'driving', label: 'Carro', icon: '🚗' },
    { id: 'walking', label: 'A pé', icon: '🚶' },
    { id: 'transit', label: 'Transporte', icon: '🚌' },
];

let itinerarioOriginal = null;
let itinerarioEditMode = false;
let itinerarioTravelMode = 'driving';
let itinerarioMap = null;
let itinerarioMapLayer = null;
let itinerarioRouteLayer = null;
let itinerarioMarkers = [];
let itinerarioSelectedStopId = null;
const legCache = new Map();

export async function ensureItinerarioData() {
    if (itinerarioOriginal) return;
    const res = await fetch('data/itinerario-original.json');
    if (!res.ok) throw new Error('itinerario-original missing');
    itinerarioOriginal = await res.json();
}

function loadItinerarioEdits() {
    try { return JSON.parse(localStorage.getItem(ITINERARIO_STORAGE_KEY) || '{}'); }
    catch { return {}; }
}

function saveItinerarioEdits(map) {
    localStorage.setItem(ITINERARIO_STORAGE_KEY, JSON.stringify(map));
}

export function getDayStops(date) {
    const edits = loadItinerarioEdits();
    if (edits[date]?.stops) return JSON.parse(JSON.stringify(edits[date].stops));
    const day = itinerarioOriginal?.days?.[date];
    return day?.stops ? JSON.parse(JSON.stringify(day.stops)) : [];
}

function persistDayStops(date, stops) {
    const edits = loadItinerarioEdits();
    edits[date] = { stops, updatedAt: new Date().toISOString() };
    saveItinerarioEdits(edits);
}

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '—';
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}min` : `${h}h`;
}

function formatDistance(meters) {
    if (!meters || meters < 0) return '';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
}

function legCacheKey(a, b, mode) {
    return `${a.lat},${a.lng}|${b.lat},${b.lng}|${mode}`;
}

async function fetchLegGoogle(from, to, mode) {
    const origins = `${from.lat},${from.lng}`;
    const destinations = `${to.lat},${to.lng}`;
    const res = await fetch(`/api/maps/distance?origins=${encodeURIComponent(origins)}&destinations=${encodeURIComponent(destinations)}&mode=${mode}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.duration) return null;
    return {
        source: 'google',
        mode,
        durationSec: data.duration.value,
        durationText: data.duration.text,
        distanceM: data.distance?.value ?? 0,
        distanceText: data.distance?.text ?? '',
    };
}

async function fetchLegOsrm(from, to, mode) {
    const profile = mode === 'walking' ? 'foot' : 'driving';
    const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        const route = data.routes?.[0];
        if (!route) return null;
        return {
            source: 'osrm',
            mode,
            durationSec: route.duration,
            durationText: formatDuration(route.duration),
            distanceM: route.distance,
            distanceText: formatDistance(route.distance),
        };
    } catch {
        return null;
    }
}

async function fetchLeg(from, to, mode) {
    const key = legCacheKey(from, to, mode);
    if (legCache.has(key)) return legCache.get(key);

    const promise = (async () => {
        let leg = null;
        if (mode !== 'transit') {
            leg = await fetchLegGoogle(from, to, mode);
            if (!leg) leg = await fetchLegOsrm(from, to, mode);
        } else {
            leg = await fetchLegGoogle(from, to, mode);
            if (!leg) leg = await fetchLegOsrm(from, to, mode);
        }
        if (!leg) {
            const dist = haversineM(from.lat, from.lng, to.lat, to.lng);
            const speed = mode === 'walking' ? 1.4 : 13.9; // m/s
            leg = {
                source: 'estimate',
                mode,
                durationSec: dist / speed,
                durationText: formatDuration(dist / speed),
                distanceM: dist,
                distanceText: formatDistance(dist),
            };
        }
        return leg;
    })();

    legCache.set(key, promise);
    return promise;
}

function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function googleDirectionsUrl(from, to, mode) {
    const travelmode = mode === 'walking' ? 'walking' : mode === 'transit' ? 'transit' : 'driving';
    const origin = `${from.lat},${from.lng}`;
    const dest = `${to.lat},${to.lng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=${travelmode}`;
}

function renderLegHtml(from, to, leg, mode) {
    const modeMeta = TRAVEL_MODES.find(m => m.id === mode) || TRAVEL_MODES[0];
    const dirUrl = googleDirectionsUrl(from, to, mode);
    const src = leg?.source === 'google' ? 'Google' : leg?.source === 'osrm' ? 'OSRM' : '~';
    return `<div class="itin-leg" data-leg>
        <div class="itin-leg-line" aria-hidden="true"></div>
        <div class="itin-leg-body">
            <span class="itin-leg-icon">${modeMeta.icon}</span>
            <span class="itin-leg-time">${leg ? leg.durationText : '…'}</span>
            ${leg?.distanceText ? `<span class="itin-leg-dist">· ${leg.distanceText}</span>` : ''}
            <a class="itin-leg-dir" href="${dirUrl}" target="_blank" rel="noopener">Rotas</a>
            <span class="itin-leg-src">${src}</span>
        </div>
    </div>`;
}

function renderStopRow(stop, index, date, editMode) {
    const maps = stop.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(stop.address || stop.name)}`;
  const editBtns = editMode
        ? `<div class="itin-stop-actions">
            <button type="button" class="itin-icon-btn" title="Editar" onclick="window.itinEditStop('${date}','${stop.id}')">✎</button>
            <button type="button" class="itin-icon-btn danger" title="Remover" onclick="window.itinRemoveStop('${date}','${stop.id}')">×</button>
           </div>`
        : '';
    return `<div class="itin-stop" data-stop-id="${escapeHtml(stop.id)}">
        <div class="itin-stop-marker">${index + 1}</div>
        <div class="itin-stop-card">
            <div class="itin-stop-top">
                <strong>${escapeHtml(stop.name)}</strong>
                ${editBtns}
            </div>
            ${stop.address ? `<p class="itin-stop-addr">${escapeHtml(stop.address)}</p>` : ''}
            ${stop.note ? `<p class="itin-stop-note">${escapeHtml(stop.note)}</p>` : ''}
            <a class="itin-maps-link" href="${escapeHtml(maps)}" target="_blank" rel="noopener">Abrir no Google Maps ↗</a>
        </div>
    </div>`;
}

async function hydrateLegs(host, stops, mode) {
    const legEls = host.querySelectorAll('[data-leg]');
    for (let i = 0; i < stops.length - 1; i++) {
        const from = stops[i];
        const to = stops[i + 1];
        if (!from.lat || !to.lat) continue;
        const leg = await fetchLeg(from, to, mode);
        const el = legEls[i];
        if (!el) continue;
        const body = el.querySelector('.itin-leg-body');
        if (!body) continue;
        const modeMeta = TRAVEL_MODES.find(m => m.id === mode) || TRAVEL_MODES[0];
        const dirUrl = googleDirectionsUrl(from, to, mode);
        const src = leg?.source === 'google' ? 'Google' : leg?.source === 'osrm' ? 'OSRM' : '~';
        body.innerHTML = `
            <span class="itin-leg-icon">${modeMeta.icon}</span>
            <span class="itin-leg-time">${leg.durationText}</span>
            ${leg.distanceText ? `<span class="itin-leg-dist">· ${leg.distanceText}</span>` : ''}
            <a class="itin-leg-dir" href="${dirUrl}" target="_blank" rel="noopener">Rotas</a>
            <span class="itin-leg-src">${src}</span>`;
    }
}

export async function renderItinerarioDay(host, day) {
    if (!host || !day) return;
    await ensureItinerarioData();
    const stops = getDayStops(day.date);

    if (!stops.length) {
        host.innerHTML = `<section class="itin-section">
            <p class="itin-empty">Sem paradas geográficas para este dia.</p>
        </section>`;
        return;
    }

    const modeChips = TRAVEL_MODES.map(m =>
        `<button type="button" class="itin-mode-chip ${m.id === itinerarioTravelMode ? 'active' : ''}" onclick="window.itinSetTravelMode('${m.id}')">${m.icon} ${m.label}</button>`
    ).join('');

    let listHtml = '';
    for (let i = 0; i < stops.length; i++) {
        listHtml += renderStopRow(stops[i], i, day.date, itinerarioEditMode);
        if (i < stops.length - 1) {
            listHtml += renderLegHtml(stops[i], stops[i + 1], null, itinerarioTravelMode);
        }
    }

    host.innerHTML = `<section class="itin-section">
        <div class="itin-section-head">
            <div>
                <h4>Itinerário do dia</h4>
                <p class="itin-sub">Paradas, tempos e mapa — editável sem alterar o roteiro original</p>
            </div>
            <div class="itin-head-actions">
                <button type="button" class="itin-map-btn" onclick="window.openItinMap('${day.date}')" title="Ver no mapa">🗺️</button>
                <button type="button" class="itin-edit-toggle ${itinerarioEditMode ? 'active' : ''}" onclick="window.toggleItinEditMode()">${itinerarioEditMode ? 'Pronto' : 'Editar'}</button>
            </div>
        </div>
        <div class="itin-mode-row">${modeChips}</div>
        ${itinerarioEditMode ? `<div class="itin-add-row">
            <button type="button" class="itin-add-btn" onclick="window.itinAddStop('${day.date}')">+ Adicionar parada</button>
            <button type="button" class="itin-reset-btn" onclick="window.itinResetDay('${day.date}')">Restaurar original</button>
        </div>` : ''}
        <div class="itin-list" id="itin-sortable-list">${listHtml}</div>
    </section>`;

    if (itinerarioEditMode && window.Sortable) {
        const list = document.getElementById('itin-sortable-list');
        if (list && !list._sortable) {
            list._sortable = Sortable.create(list, {
                animation: 150,
                handle: '.itin-stop-marker',
                draggable: '.itin-stop',
                onEnd: () => {
                    const ids = [...list.querySelectorAll('.itin-stop')].map(el => el.dataset.stopId);
                    const current = getDayStops(day.date);
                    const reordered = ids.map(id => current.find(s => s.id === id)).filter(Boolean);
                    persistDayStops(day.date, reordered);
                    renderItinerarioDay(host, day);
                },
            });
        }
    }

    hydrateLegs(host, stops, itinerarioTravelMode);
}

export function bindItinerarioGlobals(getCurrentDay, rerenderDay) {
    window.toggleItinEditMode = function () {
        itinerarioEditMode = !itinerarioEditMode;
        const day = getCurrentDay();
        const host = document.getElementById('itin-day-host');
        if (host && day) renderItinerarioDay(host, day);
    };

    window.itinSetTravelMode = function (mode) {
        itinerarioTravelMode = mode;
        legCache.clear();
        const day = getCurrentDay();
        const host = document.getElementById('itin-day-host');
        if (host && day) renderItinerarioDay(host, day);
    };

    window.itinAddStop = function (date) {
        const name = prompt('Nome do lugar:');
        if (!name?.trim()) return;
        const address = prompt('Endereço (opcional):', name) || name;
        const latStr = prompt('Latitude (opcional — deixe vazio se não souber):', '');
        const lngStr = prompt('Longitude (opcional):', '');
        const stops = getDayStops(date);
        const stop = {
            id: `${date}-${Date.now()}`,
            name: name.trim(),
            address: address.trim(),
            lat: latStr ? parseFloat(latStr) : null,
            lng: lngStr ? parseFloat(lngStr) : null,
            mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(address)}`,
            note: '',
            kind: 'custom',
        };
        stops.push(stop);
        persistDayStops(date, stops);
        rerenderDay();
    };

    window.itinEditStop = function (date, id) {
        const stops = getDayStops(date);
        const stop = stops.find(s => s.id === id);
        if (!stop) return;
        const name = prompt('Nome:', stop.name);
        if (!name?.trim()) return;
        const address = prompt('Endereço:', stop.address || '') ?? stop.address;
        const note = prompt('Nota:', stop.note || '') ?? stop.note;
        stop.name = name.trim();
        stop.address = address.trim();
        stop.note = note.trim();
        stop.mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(stop.address || stop.name)}`;
        const latStr = prompt('Latitude (vazio = manter):', stop.lat ?? '');
        const lngStr = prompt('Longitude:', stop.lng ?? '');
        if (latStr) stop.lat = parseFloat(latStr);
        if (lngStr) stop.lng = parseFloat(lngStr);
        persistDayStops(date, stops);
        rerenderDay();
    };

    window.itinRemoveStop = function (date, id) {
        if (!confirm('Remover esta parada?')) return;
        const stops = getDayStops(date).filter(s => s.id !== id);
        persistDayStops(date, stops);
        rerenderDay();
    };

    window.itinResetDay = function (date) {
        if (!confirm('Restaurar o itinerário original deste dia? Suas edições serão perdidas.')) return;
        const edits = loadItinerarioEdits();
        delete edits[date];
        saveItinerarioEdits(edits);
        legCache.clear();
        rerenderDay();
    };

    window.openItinMap = function (date) {
        openItinerarioMap(date);
    };

    window.closeItinMap = function () {
        const modal = document.getElementById('itin-map-modal');
        if (modal) modal.classList.remove('open');
        if (itinerarioMap) {
            itinerarioMap.remove();
            itinerarioMap = null;
            itinerarioMapLayer = null;
            itinerarioRouteLayer = null;
            itinerarioMarkers = [];
        }
    };

    window.selectItinMapStop = function (stopId) {
        itinerarioSelectedStopId = stopId;
        updateItinMapSelection();
    };
}

async function fetchRouteGeometry(stops, mode) {
    const coords = stops.filter(s => s.lat && s.lng).map(s => [s.lng, s.lat]);
    if (coords.length < 2) return null;
    const profile = mode === 'walking' ? 'foot' : 'driving';
    const coordStr = coords.map(c => c.join(',')).join(';');
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.routes?.[0]?.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) || null;
    } catch {
        return null;
    }
}

async function openItinerarioMap(date) {
    await ensureItinerarioData();
    const stops = getDayStops(date).filter(s => s.lat && s.lng);
    const modal = document.getElementById('itin-map-modal');
    const mapEl = document.getElementById('itin-map-canvas');
    const panel = document.getElementById('itin-map-panel');
    if (!modal || !mapEl || !stops.length) {
        alert('Nenhuma parada com coordenadas para mostrar no mapa.');
        return;
    }

    modal.classList.add('open');
    modal.dataset.date = date;
    itinerarioSelectedStopId = stops[0].id;

    if (itinerarioMap) {
        itinerarioMap.remove();
        itinerarioMap = null;
    }

    itinerarioMap = L.map(mapEl, { zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
    }).addTo(itinerarioMap);

    itinerarioMarkers = [];
    stops.forEach((stop, i) => {
        const marker = L.marker([stop.lat, stop.lng], {
            icon: L.divIcon({
                className: 'itin-map-pin',
                html: `<span>${i + 1}</span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
            }),
        }).addTo(itinerarioMap);
        marker.on('click', () => {
            itinerarioSelectedStopId = stop.id;
            updateItinMapSelection();
        });
        marker._stopId = stop.id;
        marker._stopData = stop;
        itinerarioMarkers.push(marker);
    });

    const bounds = L.latLngBounds(stops.map(s => [s.lat, s.lng]));
    itinerarioMap.fitBounds(bounds.pad(0.15));

    itinerarioRouteLayer = L.polyline([], { color: '#e11d48', weight: 4, opacity: 0.85 }).addTo(itinerarioMap);
    const route = await fetchRouteGeometry(stops, itinerarioTravelMode);
    if (route?.length) itinerarioRouteLayer.setLatLngs(route);

    updateItinMapSelection();
}

async function updateItinMapSelection() {
    const modal = document.getElementById('itin-map-modal');
    const panel = document.getElementById('itin-map-panel');
    const date = modal?.dataset.date;
    if (!panel || !date) return;

    const stops = getDayStops(date).filter(s => s.lat && s.lng);
    const idx = stops.findIndex(s => s.id === itinerarioSelectedStopId);
    const stop = stops[idx] ?? stops[0];
    if (!stop) return;

    itinerarioMarkers.forEach(m => {
        const el = m.getElement();
        if (el) el.classList.toggle('selected', m._stopId === stop.id);
    });

    const maps = stop.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(stop.address || stop.name)}`;
    let legHtml = '';
    if (idx > 0) {
        const from = stops[idx - 1];
        const leg = await fetchLeg(from, stop, itinerarioTravelMode);
        const dirUrl = googleDirectionsUrl(from, stop, itinerarioTravelMode);
        legHtml = `<p class="itin-map-leg">Do anterior: <strong>${leg.durationText}</strong>${leg.distanceText ? ` · ${leg.distanceText}` : ''} · <a href="${dirUrl}" target="_blank" rel="noopener">Rotas</a></p>`;
    }

    let routeToNext = '';
    if (idx < stops.length - 1) {
        const to = stops[idx + 1];
        const leg = await fetchLeg(stop, to, itinerarioTravelMode);
        const dirUrl = googleDirectionsUrl(stop, to, itinerarioTravelMode);
        routeToNext = `<p class="itin-map-leg">Próximo: <strong>${leg.durationText}</strong>${leg.distanceText ? ` · ${leg.distanceText}` : ''} · <a href="${dirUrl}" target="_blank" rel="noopener">Rotas</a></p>`;
        if (itinerarioRouteLayer) {
            const seg = await fetchRouteGeometry([stop, to], itinerarioTravelMode);
            if (seg?.length) itinerarioRouteLayer.setLatLngs(seg);
        }
    }

    panel.innerHTML = `
        <div class="itin-map-panel-head">
            <span class="itin-map-panel-num">${idx + 1}</span>
            <div>
                <strong>${escapeHtml(stop.name)}</strong>
                <p>${escapeHtml(stop.address || '')}</p>
            </div>
            <button type="button" class="itin-map-close" onclick="window.closeItinMap()">×</button>
        </div>
        ${stop.note ? `<p class="itin-map-note">${escapeHtml(stop.note)}</p>` : ''}
        ${legHtml}
        ${routeToNext}
        <a class="itin-maps-link block" href="${escapeHtml(maps)}" target="_blank" rel="noopener">Abrir no Google Maps ↗</a>
    `;
}
