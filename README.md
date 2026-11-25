# FINRA for Jaspers Terminal

Equity short interest, nightly Reg SHO off-exchange short volume, weekly ATS dark-pool venue volume by MPID, and optional TRACE Treasury aggregates from FINRA's Query API (`api.finra.org`).

- **Sources:** `finra/short-interest`, `finra/regsho-daily`, `finra/ats-volume`, `finra/trace-treasury`
- **Views:** `finra/shorts` (`Short Interest`, `Daily Reg SHO`, and `ATS Dark Pools` tabs)

## Keys

- **No key needed** for `short-interest`, `regsho-daily`, `ats-volume`, or the `finra/shorts` view.
- `trace-treasury` uses an optional FINRA API OAuth bearer token (`finraToken` in **Settings > Plugins**).

## Working on it

```sh
npm ci
npm run typecheck
npm test
npm run package
```

MIT.
