#!/usr/bin/env python3
"""Gera data/itinerario-original.json a partir do roteiro (somente leitura)."""

import json
import re
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROTEIRO = ROOT / "data" / "roteiro-nov-dez-2026.json"
OUT = ROOT / "data" / "itinerario-original.json"

# Coordenadas conhecidas (lat, lng)
PLACES = {
    "helios": (28.4689, -81.4672),
    "gru": (-23.4356, -46.4731),
    "mco": (28.4312, -81.3081),
    "seaworld": (28.4110, -81.4610),
    "epic": (28.4317, -81.4667),
    "usf": (28.4744, -81.4677),
    "ioa": (28.4712, -81.4707),
    "ak": (28.3574, -81.5908),
    "epcot": (28.3747, -81.5494),
    "dhs": (28.3575, -81.5582),
    "busch": (28.0370, -82.4197),
    "church": (28.5383, -81.3792),
    "citywalk": (28.4730, -81.4665),
    "disney_springs": (28.3707, -81.5190),
    "sharks": (28.4110, -81.4610),
    "leaky": (28.4790, -81.4685),
    "mythos": (28.4715, -81.4720),
    "satuli": (28.3558, -81.5923),
    "via_napoli": (28.3715, -81.5515),
    "scifi": (28.3560, -81.5595),
    "flora": (28.4689, -81.4672),
    "blue_dragon": (28.4317, -81.4667),
    "toadette": (28.4317, -81.4667),
}

MEAL_PLACE_HINTS = [
    (r"sharks", "sharks", "Sharks Underwater Grill"),
    (r"leaky", "leaky", "Leaky Cauldron"),
    (r"mythos", "mythos", "Mythos Restaurant"),
    (r"satu", "satuli", "Satu'li Canteen"),
    (r"via napoli", "via_napoli", "Via Napoli"),
    (r"sci-fi|scifi", "scifi", "Sci-Fi Dine-In Theater"),
    (r"flora", "flora", "Flora Taverna"),
    (r"blue dragon", "blue_dragon", "Blue Dragon Pan-Asian Restaurant"),
    (r"toadette", "toadette", "Toadette's Café"),
    (r"citywalk", "citywalk", "Universal CityWalk"),
    (r"disney springs", "disney_springs", "Disney Springs"),
    (r"helios", "helios", "Helios Grand Hotel"),
    (r"busch", "busch", "Busch Gardens Tampa Bay"),
    (r"seaworld", "seaworld", "SeaWorld Orlando"),
    (r"epic", "epic", "Universal Epic Universe"),
    (r"church|oicc", "church", "Orlando International Christian Church"),
    (r"mco|aeroporto", "mco", "Orlando International Airport"),
    (r"gru|guarulhos", "gru", "Aeroporto Internacional de Guarulhos"),
]


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower())
    return s.strip("-")[:48] or "stop"


def maps_url(name: str, address: str = "") -> str:
    q = address or name
    return "https://maps.google.com/?q=" + urllib.parse.quote(q)


def park_key_from_day(day: dict) -> str | None:
    addr = (day.get("parkInfo") or {}).get("address", "").lower()
    title = day.get("title", "").lower()
    if "seaworld" in title or "seaworld" in addr:
        return "seaworld"
    if "epic" in title or "epic" in addr:
        return "epic"
    if "islands" in title or "adventure" in title:
        return "ioa"
    if "studios" in title and "hollywood" not in title:
        return "usf"
    if "animal kingdom" in title or "animal kingdom" in addr:
        return "ak"
    if "epcot" in title or "epcot" in addr:
        return "epcot"
    if "hollywood" in title or "studio" in title:
        return "dhs"
    if "busch" in title:
        return "busch"
    if "gru" in addr or "guarulhos" in addr:
        return "gru"
    if "mco" in addr or "orlando international airport" in addr.lower():
        return "mco"
    if "church" in addr or "christian" in addr:
        return "church"
    if "helios" in addr or "kirkman" in addr:
        return "helios"
    return None


def meal_stop(meal: dict, suffix: str) -> dict | None:
    if not meal:
        return None
    where = (meal.get("where") or "").strip()
    if not where:
        return None
    low = where.lower()
    skip = ("no parque", "parque", "hotel", "voo", "a bordo", "caminho", "outlets", "próximo", "escolha", "são paulo", "aeroporto")
    if any(x in low for x in skip) and not any(k in low for k in ("gru", "mco", "helios", "flora", "citywalk")):
        return None
    key = None
    name = where
    for pattern, pk, label in MEAL_PLACE_HINTS:
        if re.search(pattern, low):
            key = pk
            name = label
            break
    if not key:
        return None
    lat, lng = PLACES[key]
    when = meal.get("when", "")
    return {
        "id": f"{suffix}-{slug(name)}",
        "name": name,
        "address": where,
        "lat": lat,
        "lng": lng,
        "mapsUrl": maps_url(name, where),
        "note": f"{when} · {meal.get('what', '')}".strip(" ·"),
        "kind": "meal",
    }


def stop_from_parkinfo(day: dict, sid: str) -> dict | None:
    p = day.get("parkInfo") or {}
    if not p.get("name"):
        return None
    pk = park_key_from_day(day)
    lat, lng = PLACES.get(pk, (None, None)) if pk else (None, None)
    if lat is None:
        return None
    return {
        "id": sid,
        "name": p["name"],
        "address": p.get("address", ""),
        "lat": lat,
        "lng": lng,
        "mapsUrl": p.get("mapsUrl") or maps_url(p["name"], p.get("address", "")),
        "note": day.get("strategy", ""),
        "kind": "main",
    }


def build_day_stops(day: dict, hotel: dict) -> list:
    stops = []
    dtype = day.get("type")
    date = day["date"]
    pk = park_key_from_day(day)

    if dtype == "travel" and pk == "gru":
        stops.append({
            "id": f"{date}-gru",
            "name": "GRU — embarque",
            "address": "Aeroporto Internacional de Guarulhos (GRU)",
            "lat": PLACES["gru"][0],
            "lng": PLACES["gru"][1],
            "mapsUrl": maps_url("Aeroporto Internacional de Guarulhos"),
            "note": "Partida noturna sábado",
            "kind": "travel",
        })
        return stops

    if dtype == "travel" and pk == "mco":
        stops.append({
            "id": f"{date}-mco",
            "name": "MCO — chegada",
            "address": "Orlando International Airport (MCO)",
            "lat": PLACES["mco"][0],
            "lng": PLACES["mco"][1],
            "mapsUrl": maps_url("Orlando International Airport"),
            "note": "Imigração + bagagem",
            "kind": "travel",
        })
        stops.append({
            "id": f"{date}-helios",
            "name": hotel.get("name", "Helios Grand Hotel"),
            "address": hotel.get("address", ""),
            "lat": PLACES["helios"][0],
            "lng": PLACES["helios"][1],
            "mapsUrl": hotel.get("mapsUrl") or maps_url("Helios Grand Hotel Orlando"),
            "note": "Check-in",
            "kind": "hotel",
        })
        dinner = meal_stop((day.get("meals") or {}).get("dinner"), date)
        if dinner:
            stops.append(dinner)
        return stops

    if dtype == "travel" and date == "2026-12-12":
        stops.append({
            "id": f"{date}-helios",
            "name": hotel.get("name", "Helios Grand Hotel"),
            "address": hotel.get("address", ""),
            "lat": PLACES["helios"][0],
            "lng": PLACES["helios"][1],
            "mapsUrl": hotel.get("mapsUrl") or maps_url("Helios Grand Hotel Orlando"),
            "note": "Check-out",
            "kind": "hotel",
        })
        stops.append({
            "id": f"{date}-mco-dep",
            "name": "MCO — embarque",
            "address": "Orlando International Airport (MCO)",
            "lat": PLACES["mco"][0],
            "lng": PLACES["mco"][1],
            "mapsUrl": maps_url("Orlando International Airport"),
            "note": "Voo de volta",
            "kind": "travel",
        })
        return stops

    # Orlando days: hotel → destino → almoço → volta hotel (se parque)
    in_orlando = date >= "2026-11-29" and date <= "2026-12-12"
    if in_orlando and pk not in ("gru", "mco"):
        if pk != "helios":
            stops.append({
                "id": f"{date}-helios-out",
                "name": "Helios Grand Hotel",
                "address": hotel.get("address", ""),
                "lat": PLACES["helios"][0],
                "lng": PLACES["helios"][1],
                "mapsUrl": hotel.get("mapsUrl") or maps_url("Helios Grand Hotel Orlando"),
                "note": "Saída do hotel",
                "kind": "hotel",
            })

        main = stop_from_parkinfo(day, f"{date}-main")
        if main:
            stops.append(main)

        lunch = meal_stop((day.get("meals") or {}).get("lunch"), date)
        if lunch and all(s["id"] != lunch["id"] for s in stops):
            stops.append(lunch)

        if dtype == "park" or pk == "busch":
            stops.append({
                "id": f"{date}-helios-back",
                "name": "Helios Grand Hotel",
                "address": hotel.get("address", ""),
                "lat": PLACES["helios"][0],
                "lng": PLACES["helios"][1],
                "mapsUrl": hotel.get("mapsUrl") or maps_url("Helios Grand Hotel Orlando"),
                "note": "Volta ao hotel",
                "kind": "hotel",
            })

    return stops


def main():
    roteiro = json.loads(ROTEIRO.read_text(encoding="utf-8"))
    hotel = roteiro.get("hotel") or {}
    days_out = {}
    for day in roteiro.get("days", []):
        stops = build_day_stops(day, hotel)
        if stops:
            days_out[day["date"]] = {
                "title": day.get("title", ""),
                "type": day.get("type", ""),
                "stops": stops,
            }

    out = {
        "version": 1,
        "source": "roteiro-nov-dez-2026.json",
        "generated_note": "Cópia de referência — edições ficam no navegador (localStorage). O roteiro JSON original não é alterado.",
        "hotel": {
            "name": hotel.get("name", "Helios Grand Hotel"),
            "address": hotel.get("address", ""),
            "lat": PLACES["helios"][0],
            "lng": PLACES["helios"][1],
            "mapsUrl": hotel.get("mapsUrl") or maps_url("Helios Grand Hotel Orlando"),
        },
        "days": days_out,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(days_out)} days)")


if __name__ == "__main__":
    main()
