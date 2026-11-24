# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Irdani107/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Irdani107/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama tracks, fits a launch-value model from the protocols that already record a token, and ranks every protocol that records no token yet — and is not a wrapped or staked product of one that trades — by what its launch would be worth, each with a concrete farm plan.

The model is fitted at run time from the snapshot's own figures, so the same program run on a later snapshot finds launches that do not exist yet:

```
implied value = TVL x category multiple x momentum factor x age factor
```

- **Category multiple** — the median market value per TVL dollar (mcap/TVL) of launched protocols in the same category, shrunk toward the global median; peer ratios are winsorised to [0.01x, 10x] so one microcap cannot price a whole category.
- **Momentum factor** — exp(beta x 7-day TVL change), with beta fitted by least squares on ln(mcap/TVL) over the launched sample.
- **Age factor** — (days listed / 365)^gamma, with gamma fitted the same way: how long a protocol has run with no token moves its price.

The board covers the whole eligible universe of the snapshot (198 protocols, all 40 of the $50M-floor watchlist included), each row with its fitted multiple, its factors, and a five-step farm plan with position sizes, costs and cadence.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `board.json`, the static dashboard (`dashboard/` plus its generated `zdata.js` — open `index.html` from disk, it runs with no network; sortable, filterable, with a per-protocol detail view showing the full value equation and farm plan), the screenshots, and `dossier.json` built with the kit's `vendor/makefun-board.ts`.

Entered on make.fun by @irdani107 — join with my referral link: https://make.fun/r/bn71hm0w
