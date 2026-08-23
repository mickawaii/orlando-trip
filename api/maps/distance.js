/**
 * Proxy Google Distance Matrix API (requer GOOGLE_MAPS_API_KEY no Vercel).
 * GET ?origins=lat,lng&destinations=lat,lng&mode=driving|walking|transit
 */
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return res.status(503).json({ error: 'no_key', message: 'GOOGLE_MAPS_API_KEY não configurada' });

    const { origins, destinations, mode = 'driving' } = req.query;
    if (!origins || !destinations) {
        return res.status(400).json({ error: 'missing_params' });
    }

    const allowed = ['driving', 'walking', 'transit', 'bicycling'];
    const travelMode = allowed.includes(mode) ? mode : 'driving';

    const params = new URLSearchParams({
        origins: String(origins),
        destinations: String(destinations),
        mode: travelMode,
        language: 'pt-BR',
        units: 'metric',
        key,
    });

    try {
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`;
        const r = await fetch(url);
        const data = await r.json();
        if (data.status !== 'OK') {
            return res.status(502).json({ error: 'google_error', status: data.status, detail: data });
        }
        const el = data.rows?.[0]?.elements?.[0];
        if (!el || el.status !== 'OK') {
            return res.status(502).json({ error: 'no_route', status: el?.status || 'UNKNOWN' });
        }
        return res.status(200).json({
            source: 'google',
            mode: travelMode,
            distance: el.distance,
            duration: el.duration,
        });
    } catch (e) {
        return res.status(500).json({ error: 'fetch_failed', message: String(e) });
    }
}
