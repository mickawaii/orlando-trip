#!/usr/bin/env python3
"""Scrape multi-park crowd calendars (Queue-Times + Theme Parks Guide hints).

Primary source: https://queue-times.com (free calendar with % crowd index).
Attribution required in UI: Powered by Queue-Times.com

For months not yet published on Queue-Times (e.g. Disney/Universal Nov–Dec 2026),
builds a forecast from the prior year's same holiday-aligned days and Theme Parks
Guide seasonal windows.
"""

from __future__ import annotations

import csv
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RAW = DATA / "crowd-raw"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# slug -> Queue-Times park id
PARKS = {
    "magic-kingdom": 6,
    "epcot": 5,
    "hollywood-studios": 7,
    "animal-kingdom": 8,
    "islands-of-adventure": 64,
    "universal-studios": 65,
    "epic-universe": 334,
    "seaworld": 21,
    "busch-gardens": 24,
}

# Months to attempt for each year
YEARS_MONTHS = [
    (2025, 11),
    (2025, 12),
    (2026, 7),
    (2026, 8),
    (2026, 9),
    (2026, 10),
    (2026, 11),
    (2026, 12),
]


@dataclass
class DayCrowd:
    date: str
    pct: float | None
    predicted: bool
    source: str
    opens: str | None = None
    closes: str | None = None


def fetch(url: str, retries: int = 3) -> tuple[str, str]:
    last_err: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=45) as resp:
                return resp.read().decode("utf-8", "replace"), resp.geturl()
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last_err}")


def pct_to_level(pct: float) -> str:
    # Queue-Times gradient: green (quiet) → yellow → red (busy)
    if pct <= 18:
        return "Light"
    if pct <= 35:
        return "Moderate"
    if pct <= 55:
        return "Busy"
    return "Packed"


def parse_month(html: str, park_id: int, year: int, month: int) -> list[DayCrowd]:
    soup = BeautifulSoup(html, "html.parser")
    out: list[DayCrowd] = []
    pat = re.compile(rf"/parks/{park_id}/calendar/{year}/{month:02d}/(\d{{2}})")
    seen: set[str] = set()
    for a in soup.find_all("a", href=pat):
        m = pat.search(a["href"])
        if not m:
            continue
        day = int(m.group(1))
        iso = f"{year:04d}-{month:02d}-{day:02d}"
        if iso in seen:
            continue
        seen.add(iso)
        txt = a.get_text(" ", strip=True)
        pm = re.search(r"(\d{1,3})%(\*)?", txt)
        if not pm:
            continue
        pct = float(pm.group(1))
        predicted = bool(pm.group(2))
        out.append(
            DayCrowd(
                date=iso,
                pct=pct,
                predicted=predicted,
                source="queue-times",
            )
        )
    return out


def scrape_queue_times() -> dict[str, list[DayCrowd]]:
    by_park: dict[str, list[DayCrowd]] = {slug: [] for slug in PARKS}
    for slug, pid in PARKS.items():
        for year, month in YEARS_MONTHS:
            url = f"https://queue-times.com/parks/{pid}/calendar/{year}/{month:02d}"
            try:
                html, final = fetch(url)
            except Exception as e:  # noqa: BLE001
                print(f"  ! {slug} {year}-{month:02d} fetch error: {e}")
                continue
            # Detect redirect to another month (QT clamps future months)
            final_m = re.search(rf"/parks/{pid}/calendar/(\d{{4}})/(\d{{2}})", final)
            if final_m:
                fy, fm = int(final_m.group(1)), int(final_m.group(2))
                if (fy, fm) != (year, month):
                    print(f"  · {slug} {year}-{month:02d} unavailable (got {fy}-{fm:02d})")
                    time.sleep(0.6)
                    continue
            days = parse_month(html, pid, year, month)
            print(f"  ✓ {slug} {year}-{month:02d}: {len(days)} days")
            by_park[slug].extend(days)
            # raw dump
            raw_path = RAW / f"qt-{slug}-{year}-{month:02d}.html"
            raw_path.write_text(html)
            time.sleep(0.8)
    return by_park


def thanksgiving(year: int) -> date:
    # 4th Thursday of November
    d = date(year, 11, 1)
    # weekday Mon=0..Sun=6
    first_thu = d + timedelta(days=(3 - d.weekday()) % 7)
    return first_thu + timedelta(weeks=3)


def holiday_window_2026(d: date) -> float:
    """Theme Parks Guide–inspired bias for 2026 trip window (additive pct points)."""
    md = d.month * 100 + d.day
    # Thanksgiving spike Nov 22–29 2026 (TPG)
    if 1122 <= md <= 1129:
        return 35
    # Early Dec quiet window Dec 1–12
    if 1201 <= md <= 1212:
        return -8
    # Build toward Christmas
    if 1213 <= md <= 1219:
        return 12
    if 1220 <= md <= 1231:
        return 40
    # Early Nov generally good
    if 1101 <= md <= 1120:
        return -5
    return 0


def forecast_from_prior_year(
    prior: list[DayCrowd], target_year: int, month: int
) -> list[DayCrowd]:
    """Align prior-year month to target year via Thanksgiving offset + DOW."""
    if not prior:
        return []
    prior_by_offset: dict[int, DayCrowd] = {}
    tg_prior = thanksgiving(target_year - 1)
    for row in prior:
        d = date.fromisoformat(row.date)
        if d.month != month:
            continue
        prior_by_offset[(d - tg_prior).days] = row

    # Also index by weekday for fallback
    by_dow: dict[int, list[float]] = {}
    for row in prior:
        if row.pct is None:
            continue
        d = date.fromisoformat(row.date)
        by_dow.setdefault(d.weekday(), []).append(row.pct)

    tg = thanksgiving(target_year)
    out: list[DayCrowd] = []
    # iterate all days in month
    day = date(target_year, month, 1)
    while day.month == month:
        off = (day - tg).days
        base = prior_by_offset.get(off)
        if base and base.pct is not None:
            pct = base.pct
        else:
            vals = by_dow.get(day.weekday()) or [25.0]
            pct = sum(vals) / len(vals)
        pct = max(1.0, min(95.0, pct + holiday_window_2026(day)))
        out.append(
            DayCrowd(
                date=day.isoformat(),
                pct=round(pct, 1),
                predicted=True,
                source="forecast:qt-prior+tpg",
            )
        )
        day += timedelta(days=1)
    return out


def merge_days(existing: list[DayCrowd], extra: list[DayCrowd]) -> list[DayCrowd]:
    by: dict[str, DayCrowd] = {d.date: d for d in existing}
    for d in extra:
        if d.date not in by:
            by[d.date] = d
    return [by[k] for k in sorted(by)]


def write_park_csv(slug: str, days: list[DayCrowd]) -> Path:
    path = DATA / f"{slug}.csv"
    # Keep compatible header; extend with source/pct/predicted
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "date",
                "crowd_level",
                "average_wait_min",
                "samples",
                "source",
                "crowd_pct",
                "predicted",
            ]
        )
        for d in sorted(days, key=lambda x: x.date):
            if d.pct is None:
                continue
            level = pct_to_level(d.pct)
            # approximate wait from pct for UI (optional)
            avg_wait = round(8 + d.pct * 0.7)
            w.writerow(
                [
                    d.date,
                    level,
                    avg_wait,
                    "" if d.predicted else "1",
                    d.source,
                    d.pct,
                    "1" if d.predicted else "0",
                ]
            )
    return path


def write_meta(summary: dict) -> None:
    path = DATA / "crowd-sources.json"
    import json

    path.write_text(json.dumps(summary, indent=2) + "\n")


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    print("Scraping Queue-Times calendars…")
    by_park = scrape_queue_times()

    summary = {
        "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "primary_source": "https://queue-times.com/",
        "attribution": "Powered by Queue-Times.com",
        "secondary": [
            "Theme Parks Guide 2026 seasonal windows (Thanksgiving / early Dec)",
            "Prior-year Queue-Times month aligned to Thanksgiving for missing 2026 months",
        ],
        "parks": {},
    }

    for slug, days in by_park.items():
        # Fill 2026-11 / 2026-12 if missing using 2025 same months
        have_2026_11 = any(d.date.startswith("2026-11") for d in days)
        have_2026_12 = any(d.date.startswith("2026-12") for d in days)
        prior_11 = [d for d in days if d.date.startswith("2025-11")]
        prior_12 = [d for d in days if d.date.startswith("2025-12")]
        if not have_2026_11 and prior_11:
            forecast = forecast_from_prior_year(prior_11, 2026, 11)
            days = merge_days(days, forecast)
            print(f"  + {slug}: forecasted 2026-11 from 2025 ({len(forecast)} days)")
        if not have_2026_12 and prior_12:
            forecast = forecast_from_prior_year(prior_12, 2026, 12)
            days = merge_days(days, forecast)
            print(f"  + {slug}: forecasted 2026-12 from 2025 ({len(forecast)} days)")

        # If still missing and no prior (e.g. Epic 2025), synthesize from weekday model + TPG
        if not any(d.date.startswith("2026-11") for d in days):
            synth = []
            day = date(2026, 11, 1)
            # baseline weekday pct inspired by QT Orlando averages
            base = [22, 18, 20, 24, 28, 38, 40]  # Mon..Sun -> remap
            while day.month == 11:
                # JS Sun=0 mapping: use Mon=0
                js = (day.weekday() + 1) % 7
                # convert our Mon-first base to JS Sunday-first
                mon_first = [20, 18, 19, 22, 28, 38, 36]
                pct = mon_first[day.weekday()] + holiday_window_2026(day)
                # Epic is busier
                if slug == "epic-universe":
                    pct += 12
                if slug == "hollywood-studios":
                    pct += 6
                pct = max(1, min(95, pct))
                synth.append(
                    DayCrowd(
                        date=day.isoformat(),
                        pct=float(pct),
                        predicted=True,
                        source="forecast:weekday+tpg",
                    )
                )
                day += timedelta(days=1)
            days = merge_days(days, synth)
            print(f"  + {slug}: synthesized 2026-11 ({len(synth)} days)")

        if not any(d.date.startswith("2026-12") for d in days):
            synth = []
            day = date(2026, 12, 1)
            while day.month == 12:
                mon_first = [20, 18, 19, 22, 28, 38, 36]
                pct = mon_first[day.weekday()] + holiday_window_2026(day)
                if slug == "epic-universe":
                    pct += 12
                if slug == "hollywood-studios":
                    pct += 6
                pct = max(1, min(95, pct))
                synth.append(
                    DayCrowd(
                        date=day.isoformat(),
                        pct=float(pct),
                        predicted=True,
                        source="forecast:weekday+tpg",
                    )
                )
                day += timedelta(days=1)
            days = merge_days(days, synth)
            print(f"  + {slug}: synthesized 2026-12 ({len(synth)} days)")

        path = write_park_csv(slug, days)
        qt_n = sum(1 for d in days if d.source == "queue-times")
        fc_n = sum(1 for d in days if d.source.startswith("forecast"))
        summary["parks"][slug] = {
            "file": path.name,
            "days": len(days),
            "queue_times_days": qt_n,
            "forecast_days": fc_n,
            "range": [days[0].date, days[-1].date] if days else None,
        }
        print(f"Wrote {path} ({len(days)} days; qt={qt_n} forecast={fc_n})")

    write_meta(summary)
    print("Done.", DATA / "crowd-sources.json")


if __name__ == "__main__":
    main()
