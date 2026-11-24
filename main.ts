// Token Launch Radar — main.ts
//
// Reads the sealed DefiLlama snapshot, fits a launch-value model from the
// protocols in it that already record a token, and ranks every protocol
// that records no token (and is not a wrapped or staked product of one
// that trades) by the value its launch would carry. The model is fitted
// at run time from the snapshot's own figures, so the same program run
// on a later snapshot finds launches that do not exist yet.
//
// Writes board.json, the dashboard with its data file, and dossier.json
// into the output directory.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

type Proto = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};
type Snapshot = { as_of: string; floor_usd: number; protocols: Proto[]; watchlist: string[] };

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const inputPath = argValue('--input') ?? '/input/snapshot.json';
const outputDir = argValue('--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const repoDir = new URL('.', import.meta.url).pathname;

const snap: Snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
const asOfMs = new Date(snap.as_of + 'T00:00:00Z').getTime();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function olsSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 8) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den === 0 ? 0 : num / den;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round3 = (x: number) => Math.round(x * 1000) / 1000;
function ageDays(p: Proto): number | null {
  if (!p.listed_at) return null;
  const t = new Date(p.listed_at + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((asOfMs - t) / 86400000));
}

// ---- Fit the model on the protocols that already record a token ----
// Base term: the market value the market gives each dollar of TVL,
// mcap/TVL, taken as a median per category and shrunk toward the global
// median so a category with two launches cannot shout down forty. Each
// peer's ratio is winsorised to [0.01, 10] first: a handful of launched
// microcaps carry ratios in the hundreds, and one such peer must not
// set a whole category's price.
function ratioOf(p: Proto): number {
  return clamp((p.mcap_usd as number) / p.tvl_usd, 0.01, 10);
}
const launched = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const globalMedian = median(launched.map(ratioOf));
const byCat = new Map<string, number[]>();
for (const p of launched) {
  const c = p.category ?? 'Uncategorised';
  if (!byCat.has(c)) byCat.set(c, []);
  (byCat.get(c) as number[]).push(ratioOf(p));
}
const SHRINK = 4;
function categoryMultiple(cat: string | null): { m: number; n: number } {
  const xs = byCat.get(cat ?? 'Uncategorised');
  if (!xs || xs.length === 0) return { m: globalMedian, n: 0 };
  return { m: (xs.length * median(xs) + SHRINK * globalMedian) / (xs.length + SHRINK), n: xs.length };
}
// Momentum and age terms: least-squares slopes of ln(mcap/TVL) on the
// 7-day TVL change and on ln(days listed), fitted on the same sample.
const momX: number[] = [];
const momY: number[] = [];
const ageX: number[] = [];
const ageY: number[] = [];
for (const p of launched) {
  const r = ratioOf(p);
  if (p.change_7d !== null) {
    momX.push(p.change_7d);
    momY.push(Math.log(r));
  }
  const a = ageDays(p);
  if (a !== null && a >= 30) {
    ageX.push(Math.log(a));
    ageY.push(Math.log(r));
  }
}
const beta = olsSlope(momX, momY);
const gamma = olsSlope(ageX, ageY);

// ---- Who is still to come ----
// A protocol belongs on the board when it records no token (gecko_id and
// symbol both null) and is not a wrapped, staked or bridged product of a
// token that already trades: the house exclusions by category, by a
// version marker at the end of the name, by the whole words wrapped,
// staked or staking in the name, and by an exchange name at its start.
const BAD_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const BAD_WORDS = new Set(['wrapped', 'staked', 'staking']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
function isProductOfTraded(p: Proto): boolean {
  if (p.category !== null && BAD_CATS.has(p.category)) return true;
  const words = p.name.split(/\s+/);
  if (/^(v\d+|\d+\.\d+)$/i.test(words[words.length - 1])) return true;
  for (const w of words) if (BAD_WORDS.has(w.toLowerCase())) return true;
  for (const e of EXCHANGES) if (p.name.startsWith(e)) return true;
  return false;
}

// ---- The farm plan: concrete steps per protocol ----
// Position sizes scale with the protocol's TVL tier; the core action
// follows its category; every plan ends with a weekly cadence and a
// launch-readiness step, because snapshots reward history, not bursts.
function sizeFor(tvl: number): string {
  if (tvl >= 500_000_000) return '$2,000-$5,000';
  if (tvl >= 100_000_000) return '$1,000-$2,000';
  if (tvl >= 50_000_000) return '$500-$1,000';
  return '$250-$500';
}
function coreAction(p: Proto): string {
  const c = (p.category ?? '').toLowerCase();
  const chain = p.chains[0] ?? 'its main chain';
  if (c.includes('lend')) return `Supply blue-chip collateral (ETH or a major stablecoin) on ${p.name} and borrow lightly against it, keeping the health factor above 2.0 so the position survives a 30% drop without liquidation.`;
  if (c.includes('dex') || c.includes('swap')) return `Provide liquidity to the flagship pair on ${p.name} on ${chain} and route your own swaps through it weekly; concentrated ranges earn more but need a 10-minute rebalance check twice a week.`;
  if (c.includes('yield')) return `Deposit into the highest-TVL vault on ${p.name} and leave the position untouched; compounding vaults reward duration, and churning between vaults resets the history that snapshots usually measure.`;
  if (c.includes('cdp') || c.includes('stable')) return `Open a collateralised position on ${p.name} at over 200% collateral ratio, mint a modest amount of its stablecoin and hold or lend it inside the same ecosystem to build two-sided history.`;
  if (c.includes('deriv') || c.includes('perp') || c.includes('option')) return `Trade small, hedged perpetual positions on ${p.name} two or three times a week; steady volume with low net exposure builds a trader history without paying for it in liquidations.`;
  if (c.includes('rwa')) return `Buy a small position in the flagship real-world-asset vault on ${p.name} and complete its onboarding early; RWA launches usually reward holders who passed verification before the snapshot, not after.`;
  if (c.includes('game') || c.includes('nft')) return `Play or trade on ${p.name} weekly with real assets: finish the seasonal quests, hold one mid-tier asset, and keep activity spread over months rather than done in a single weekend.`;
  if (c.includes('launch')) return `Take part in one launch on ${p.name} with a small ticket and hold the allocation; launchpads score completed participations and holding time far more than ticket size.`;
  return `Use the core product of ${p.name} on ${chain} with real funds every week: deposit, transact and withdraw on a human cadence, because retroactive drops measure sustained use, not one large visit.`;
}
function farmSteps(p: Proto): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const size = sizeFor(p.tvl_usd);
  return [
    `Open a fresh wallet for ${p.name} and bridge ${size} of working capital to ${chain}; budget about $15-$40 for bridge and gas fees, and keep the wallet separate so its history reads as one real user. Setup takes about 20 minutes.`,
    coreAction(p),
    `Register on the protocol's points or rewards page if one exists and link the same wallet; then vote in at least one governance poll or forum discussion per month, since several past launches weighted voters above pure depositors. About 10 minutes a month.`,
    `Repeat the core action weekly for at least 8-12 weeks, varying amounts and days; a steady 3-month history on ${chain} is the pattern earlier retroactive airdrops paid for, and it costs only the gas you would spend anyway.`,
    `Keep records (dates, amounts, transaction hashes) in a simple log and watch the protocol's official channels for a snapshot or checker announcement; when a claim opens you typically have 30-90 days, and prepared wallets claim on day one.`,
  ];
}

// ---- Value every protocol still to come ----
// implied = TVL x category multiple x momentum factor x age factor,
// each factor fitted above from the launched sample, clamped so one hot
// week or one ancient listing cannot dominate the board.
const watch = new Set(snap.watchlist);
type Scored = {
  p: Proto;
  m: number;
  peers: number;
  g: number;
  a: number | null;
  af: number;
  val: number;
};
const scored: Scored[] = snap.protocols
  .filter((p) => p.gecko_id === null && p.symbol === null && !isProductOfTraded(p))
  .map((p) => {
    const { m, n } = categoryMultiple(p.category);
    const g = p.change_7d === null ? 1 : clamp(Math.exp(beta * p.change_7d), 0.6, 1.8);
    const a = ageDays(p);
    const af = a === null ? 1 : clamp(Math.pow(Math.max(a, 1) / 365, gamma), 0.7, 1.5);
    const val = clamp(Math.round(p.tvl_usd * m * g * af), 1, 100_000_000_000_000);
    return { p, m, peers: n, g, a, af, val };
  })
  .sort((x, y) => y.val - x.val || (x.p.slug < y.p.slug ? -1 : 1));

// ---- Write the board, the dashboard data and the dossier ----
const model = {
  launched_sample: launched.length,
  global_median_multiple: round3(globalMedian),
  momentum_beta: round3(beta),
  age_gamma: round3(gamma),
  shrinkage: SHRINK,
  winsorised_ratio: [0.01, 10],
  categories: [...byCat.entries()]
    .map(([c, xs]) => ({ category: c, peers: xs.length, multiple: round3(categoryMultiple(c).m) }))
    .sort((x, y) => (x.category < y.category ? -1 : 1)),
};
const rows = scored.map((b, i) => ({
  slug: b.p.slug,
  name: b.p.name,
  rank: i + 1,
  implied_value_usd: b.val,
  farm_steps: farmSteps(b.p),
  tvl_usd: b.p.tvl_usd,
  category: b.p.category,
  chains: b.p.chains,
  change_7d: b.p.change_7d,
  age_days: b.a,
  multiple: round3(b.m),
  peers: b.peers,
  momentum: round3(b.g),
  age_factor: round3(b.af),
  watchlist: watch.has(b.p.slug),
}));

mkdirSync(join(outputDir, 'dashboard'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
for (const f of readdirSync(join(repoDir, 'dashboard'))) {
  copyFileSync(join(repoDir, 'dashboard', f), join(outputDir, 'dashboard', f));
}
for (const f of readdirSync(join(repoDir, 'screenshots'))) {
  copyFileSync(join(repoDir, 'screenshots', f), join(outputDir, 'screenshots', f));
}
writeFileSync(
  join(outputDir, 'board.json'),
  JSON.stringify({ as_of: snap.as_of, floor_usd: snap.floor_usd, model, rows }, null, 1),
);
writeFileSync(
  join(outputDir, 'dashboard', 'zdata.js'),
  'window.RADAR=' + JSON.stringify({ as_of: snap.as_of, floor_usd: snap.floor_usd, model, rows }) + ';\n',
);
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, { text_max_bytes: 65536 }));
console.log(`radar: ${rows.length} protocols ranked, top ${rows[0].name} at $${rows[0].implied_value_usd}`);
