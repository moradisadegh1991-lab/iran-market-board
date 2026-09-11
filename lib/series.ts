// Daily price series per asset: our own recorded closes, bridged backwards with the best available long history.
// Fallback chains mean one blocked source (e.g. Nobitex from Vercel) no longer leaves an asset with "1 day of data".
import { cachedSource } from '@/lib/sources/cache';
import { fetchCgDaily } from '@/lib/sources/coingecko';
import { fetchNobitexDaily } from '@/lib/sources/nobitex';
import { TGJU_SLUGS, fetchTgjuHistory, fetchTseIndexHistory, pairsFromDated, type DatedPairs } from '@/lib/sources/history';
import { dailyMap, loadDaily, pairsToMap, productMap, spliceSeries, type DailyStore } from '@/lib/history';
import type { AssetKey, RiskAssetKey, SourceStatus } from '@/lib/types';

const H12 = 12 * 3600;
const D10 = 10 * 24 * 3600;
const MIN_USEFUL = 30;

export interface SeriesInputs {
  daily: DailyStore;
  maps: {
    tgjuUsd: Map<string, number>;
    tgjuCoin: Map<string, number>;
    tgjuG18: Map<string, number>;
    tgjuOns: Map<string, number>;
    usdtUdf: Map<string, number>;
    paxg: Map<string, number>;
    btc: Map<string, number>;
    eth: Map<string, number>;
    tseIdx: Map<string, number>;
  };
  tseVia: string | null;
  statuses: SourceStatus[];
}

export async function loadSeriesInputs(daily?: DailyStore): Promise<SeriesInputs> {
  const [usd, coin, g18, ons, udf, paxg, btc, eth, tse, store] = await Promise.all([
    cachedSource<DatedPairs>('tgjuHistUsd', H12, () => fetchTgjuHistory(TGJU_SLUGS.usd), D10),
    cachedSource<DatedPairs>('tgjuHistCoin', H12, () => fetchTgjuHistory(TGJU_SLUGS.coin), D10),
    cachedSource<DatedPairs>('tgjuHistG18', H12, () => fetchTgjuHistory(TGJU_SLUGS.g18), D10),
    cachedSource<DatedPairs>('tgjuHistOns', H12, () => fetchTgjuHistory(TGJU_SLUGS.ons), D10),
    cachedSource<[number, number][]>('histUsdt', H12, () => fetchNobitexDaily('USDTIRT'), D10),
    cachedSource<[number, number][]>('histPaxg', H12, () => fetchCgDaily('pax-gold'), D10),
    cachedSource<[number, number][]>('histBtc', H12, () => fetchCgDaily('bitcoin'), D10),
    cachedSource<[number, number][]>('histEth', H12, () => fetchCgDaily('ethereum'), D10),
    cachedSource<{ pairs: DatedPairs; via: string }>('tseIndexHist', H12, fetchTseIndexHistory, D10),
    daily ? Promise.resolve(daily) : loadDaily(),
  ]);
  return {
    daily: store,
    maps: {
      tgjuUsd: pairsFromDated(usd.data),
      tgjuCoin: pairsFromDated(coin.data),
      tgjuG18: pairsFromDated(g18.data),
      tgjuOns: pairsFromDated(ons.data),
      usdtUdf: pairsToMap(udf.data),
      paxg: pairsToMap(paxg.data),
      btc: pairsToMap(btc.data),
      eth: pairsToMap(eth.data),
      tseIdx: pairsFromDated(tse.data?.pairs),
    },
    tseVia: tse.data?.via ?? null,
    statuses: [usd, coin, g18, ons, udf, paxg, btc, eth, tse].map((r) => r.status),
  };
}

interface Candidate {
  map: Map<string, number>;
  label: string;
}

const first = (cands: Candidate[]): Candidate => cands.find((c) => c.map.size >= MIN_USEFUL) ?? { map: new Map(), label: '' };

export interface AssetSeries {
  dates: string[];
  prices: number[];
  basis: string; // human label of the long-history source
  reconstructed: boolean; // levels derived from a different instrument (e.g. PAXG × USDT)
}

export function buildSeries(inp: SeriesInputs, key: RiskAssetKey): AssetSeries {
  const m = inp.maps;
  const own = (k: AssetKey) => dailyMap(inp.daily, k);
  const usdLong = first([
    { map: m.tgjuUsd, label: 'TGJU' },
    { map: m.usdtUdf, label: 'تتر نوبیتکس' },
  ]);
  const goldIrr = first([
    { map: productMap(m.paxg, m.tgjuUsd), label: 'PAXG × دلار TGJU' },
    { map: productMap(m.paxg, m.usdtUdf), label: 'PAXG × تتر' },
  ]);
  let actual: Map<string, number>;
  let proxy: Candidate;
  let reconstructed = false;
  switch (key) {
    case 'usd':
      actual = own('usd');
      proxy = usdLong;
      reconstructed = proxy.label !== 'TGJU';
      break;
    case 'usdt':
      actual = own('usdt');
      proxy = first([
        { map: m.usdtUdf, label: 'نوبیتکس' },
        { map: m.tgjuUsd, label: 'دلار TGJU' },
      ]);
      reconstructed = proxy.label !== 'نوبیتکس';
      break;
    case 'g18':
      actual = own('g18');
      proxy = first([{ map: m.tgjuG18, label: 'TGJU' }, goldIrr]);
      reconstructed = proxy.label !== 'TGJU';
      break;
    case 'coin':
      actual = own('coin');
      proxy = first([{ map: m.tgjuCoin, label: 'TGJU' }, goldIrr]);
      reconstructed = proxy.label !== 'TGJU';
      break;
    case 'ons':
      actual = own('ons');
      proxy = first([
        { map: m.tgjuOns, label: 'TGJU' },
        { map: m.paxg, label: 'PAXG' },
      ]);
      break;
    case 'btc':
      actual = own('btc');
      proxy = { map: m.btc, label: 'CoinGecko' };
      break;
    case 'eth':
      actual = own('eth');
      proxy = { map: m.eth, label: 'CoinGecko' };
      break;
    case 'tse':
      actual = own('tse');
      proxy = { map: m.tseIdx, label: inp.tseVia ?? '' };
      break;
    case 'btc_irt':
    default:
      actual = productMap(own('btc'), own('usdt'));
      proxy = { map: productMap(m.btc, usdLong.map), label: `BTC × ${usdLong.label}` };
      reconstructed = true;
  }
  const { dates, prices } = spliceSeries(actual, proxy.map);
  return { dates, prices, basis: proxy.map.size ? proxy.label : 'فقط داده ثبت‌شده در همین سایت', reconstructed };
}

/** Plain [date, price] series for an arbitrary CoinGecko id (altcoins). */
export async function coinSeries(id: string): Promise<{ dates: string[]; prices: number[]; status: SourceStatus }> {
  const r = await cachedSource<[number, number][]>(`histCg_${id}`, H12, () => fetchCgDaily(id), D10);
  const map = pairsToMap(r.data);
  const dates = [...map.keys()].sort();
  return { dates, prices: dates.map((d) => map.get(d)!), status: r.status };
}
