#!/usr/bin/env python3
"""
Backfill TSE/IFB daily history into the dashboard so the 1-month stock screen
works immediately (instead of waiting ~20 trading days).

Stdlib only (runs in Termux / any Python 3.9+). Run it from a machine whose IP
TSETMC accepts (usually an Iranian IP).

Sources, in order:
  1) TSETMC CDN market watch  -> symbol universe + insCode
  2) TSETMC CDN daily closing  -> per-symbol history (pClosing, qTotCap)
  3) TSETMC CDN index history  -> overall index (TEDPIX) daily
  or  --csv file.csv            -> columns: symbol,date,close,value   (date = YYYY-MM-DD, value in rial)

Examples:
  python3 scripts/backfill_tse.py --url https://your-app.vercel.app --secret $ADMIN_SECRET --probe
  python3 scripts/backfill_tse.py --url https://your-app.vercel.app --secret $ADMIN_SECRET --days 60 --top 300
  python3 scripts/backfill_tse.py --url https://your-app.vercel.app --secret $ADMIN_SECRET --csv history.csv
  python3 scripts/backfill_tse.py --days 60 --top 50 --dry-run > out.json
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

CDN = "https://cdn.tsetmc.com/api"
TEDPIX_INSCODE = "32097828799138957"
UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"
MIN_TRADE_VALUE_RIAL = 5e9  # same idea as TSE_MIN_TVAL on the server


def norm_symbol(s: str) -> str:
    return " ".join(str(s or "").replace("ي", "ی").replace("ى", "ی").replace("ك", "ک").split())


def http_json(url: str, body=None, headers=None, timeout=25, retries=3):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    h = {"User-Agent": UA, "Accept": "application/json"}
    if data is not None:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=h, method="POST" if data is not None else "GET")
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read()[:200]!r}"
            if e.code in (400, 401, 403, 404):
                break
        except Exception as e:  # timeout, DNS, JSON
            last = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{url} -> {last}")


def d_even_to_iso(d) -> str:
    return datetime.strptime(str(int(d)), "%Y%m%d").strftime("%Y-%m-%d")


# ---------- TSETMC ----------

def market_watch():
    """Current market watch: stocks (paperType 1) and IFB stocks (paperType 2)."""
    url = (f"{CDN}/ClosingPrice/GetMarketWatch?market=0&industrialGroup="
           "&paperTypes%5B0%5D=1&paperTypes%5B1%5D=2&showTraded=false&withBestLimits=false")
    j = http_json(url)
    rows = j.get("marketwatch") or j.get("marketWatch") or []
    out = []
    for r in rows:
        sym = norm_symbol(r.get("lVal18AFC") or r.get("lva") or "")
        ins = r.get("insCode") or r.get("insID")
        if not sym or not ins:
            continue
        # skip rights / subscription symbols (ending in ح) — same as the server screen
        if sym.endswith("ح") and len(sym) > 2:
            continue
        out.append({"symbol": sym, "insCode": str(ins), "value": float(r.get("qTotCap") or 0)})
    return out


def symbol_history(ins_code: str, days: int):
    j = http_json(f"{CDN}/ClosingPrice/GetClosingPriceDailyList/{ins_code}/{max(days + 10, 30)}")
    rows = j.get("closingPriceDaily") or []
    pts = []
    for r in rows:
        close = r.get("pClosing")
        if not close or not r.get("dEven"):
            continue
        if float(r.get("zTotTran") or 0) <= 0:  # no trades that day (halted)
            continue
        pts.append({"date": d_even_to_iso(r["dEven"]), "close": float(close), "value": float(r.get("qTotCap") or 0)})
    pts.sort(key=lambda p: p["date"])
    return pts[-days:]


def index_history(days: int):
    j = http_json(f"{CDN}/Index/GetIndexB2History/{TEDPIX_INSCODE}")
    rows = j.get("indexB2") or []
    pts = [{"date": d_even_to_iso(r["dEven"]), "value": float(r["xNivInuClMresIbs"])}
           for r in rows if r.get("dEven") and r.get("xNivInuClMresIbs")]
    pts.sort(key=lambda p: p["date"])
    return pts[-max(days, 400):]


# ---------- CSV ----------

def read_csv(path: str):
    symbols = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sym = norm_symbol(row.get("symbol", ""))
            try:
                pt = {"date": row["date"][:10], "close": float(row["close"])}
                if row.get("value"):
                    pt["value"] = float(row["value"])
            except (KeyError, ValueError):
                continue
            if sym:
                symbols.setdefault(sym, []).append(pt)
    return symbols


# ---------- push ----------

def post(url, secret, payload, dry):
    if dry:
        return {"dry_run": True}
    return http_json(f"{url.rstrip('/')}/api/ingest", body=payload, headers={"x-admin-secret": secret}, timeout=60)


def push_symbols(url, secret, symbols, chunk, dry):
    names = list(symbols)
    for i in range(0, len(names), chunk):
        part = {n: symbols[n] for n in names[i:i + chunk]}
        res = post(url, secret, {"kind": "tse", "symbols": part}, dry)
        print(f"  ingest tse {i + 1}-{i + len(part)} / {len(names)} -> {res}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description="Backfill TSE history into Iran Market Board")
    ap.add_argument("--url", default=os.environ.get("BOARD_URL", ""), help="dashboard base URL")
    ap.add_argument("--secret", default=os.environ.get("ADMIN_SECRET", ""), help="ADMIN_SECRET")
    ap.add_argument("--days", type=int, default=60, help="trading days per symbol (server keeps 80)")
    ap.add_argument("--top", type=int, default=300, help="most-traded symbols to fetch")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--chunk", type=int, default=60, help="symbols per ingest request")
    ap.add_argument("--csv", help="ingest a CSV instead of TSETMC (symbol,date,close,value)")
    ap.add_argument("--no-index", action="store_true", help="skip index history")
    ap.add_argument("--probe", action="store_true", help="test TSETMC access with 3 symbols, push nothing")
    ap.add_argument("--dry-run", action="store_true", help="print JSON to stdout instead of posting")
    a = ap.parse_args()

    if not a.dry_run and not a.probe and (not a.url or not a.secret):
        ap.error("--url and --secret are required (or use --dry-run / --probe)")

    if a.csv:
        symbols = read_csv(a.csv)
        print(f"CSV: {len(symbols)} symbols", file=sys.stderr)
        if a.dry_run:
            json.dump({"kind": "tse", "symbols": symbols}, sys.stdout, ensure_ascii=False)
        else:
            push_symbols(a.url, a.secret, symbols, a.chunk, False)
        return

    print("fetching market watch …", file=sys.stderr)
    universe = market_watch()
    universe = [u for u in universe if u["value"] >= MIN_TRADE_VALUE_RIAL] or universe
    universe.sort(key=lambda u: u["value"], reverse=True)
    universe = universe[: (3 if a.probe else a.top)]
    print(f"universe: {len(universe)} symbols", file=sys.stderr)
    if not universe:
        sys.exit("market watch returned nothing — TSETMC may be blocking this IP or the session is closed; try --csv")

    symbols, failed = {}, []
    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        futs = {ex.submit(symbol_history, u["insCode"], a.days): u["symbol"] for u in universe}
        for n, fut in enumerate(as_completed(futs), 1):
            sym = futs[fut]
            try:
                pts = fut.result()
                if len(pts) >= 5:
                    symbols[sym] = pts
            except Exception as e:
                failed.append((sym, str(e)[:120]))
            if n % 25 == 0:
                print(f"  history {n}/{len(universe)}", file=sys.stderr)

    print(f"history ok: {len(symbols)}, failed: {len(failed)}", file=sys.stderr)
    for sym, err in failed[:5]:
        print(f"  ✗ {sym}: {err}", file=sys.stderr)

    idx = []
    if not a.no_index:
        try:
            idx = index_history(a.days)
            print(f"index points: {len(idx)}", file=sys.stderr)
        except Exception as e:
            print(f"index history failed: {e}", file=sys.stderr)

    if a.probe:
        sample = {k: v[-3:] for k, v in symbols.items()}
        print(json.dumps({"sample": sample, "index_tail": idx[-3:]}, ensure_ascii=False, indent=2))
        return

    if a.dry_run:
        json.dump({"tse": {"kind": "tse", "symbols": symbols},
                   "index": {"kind": "daily", "asset": "tse", "points": idx}}, sys.stdout, ensure_ascii=False)
        return

    if idx:
        print(f"  ingest index -> {post(a.url, a.secret, {'kind': 'daily', 'asset': 'tse', 'points': idx}, False)}", file=sys.stderr)
    push_symbols(a.url, a.secret, symbols, a.chunk, False)
    print("done. open the dashboard — the stock section should switch to history mode.", file=sys.stderr)


if __name__ == "__main__":
    main()
