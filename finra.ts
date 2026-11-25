// Pure normalization, aggregation, and view state/output helpers for the FINRA plugin.

export const OUTPUT_MAX = 4096
export const TABS = ['short-interest', 'regsho-daily', 'ats-volume'] as const
export type ShortsTab = (typeof TABS)[number]

export interface ShortInterestRow {
  ticker: string
  name: string
  settlementDate: string
  shortShares: number | null
  previousShortShares: number | null
  change: number | null
  changePercent: number | null
  averageDailyVolume: number | null
  daysToCover: number | null
  market: string
  [key: string]: unknown
}

export interface RegShoDailyRow {
  ticker: string
  date: string
  shortVolume: number
  shortExemptVolume: number
  totalVolume: number
  shortRatio: number | null
  facilities: string
  [key: string]: unknown
}

export interface AtsVenueRow {
  ticker: string
  name: string
  weekStartDate: string
  mpid: string
  venue: string
  summaryType: string
  tier: string
  shares: number
  trades: number
  notional: number | null
  avgTradeShares: number | null
  [key: string]: unknown
}

export interface ShortsState {
  ticker: string
  tab: ShortsTab
  limit: number
}

export type ShortsOutput = {
  ticker: string
  tab: ShortsTab
  count: number
  latestDate: string | null
  shortShares: number | null
  daysToCover: number | null
  dailyShortRatio: number | null
  topVenue: string | null
  topVenueShares: number | null
}

function asNum(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function isoDaysAgo(from: Date, days: number): string {
  const copy = new Date(from.getTime() - days * 86_400_000)
  return copy.toISOString().slice(0, 10)
}

export function normalizeShortInterestRows(
  symbol: string,
  found: readonly Record<string, unknown>[],
  limit: number,
): ShortInterestRow[] {
  const ticker = symbol.trim().toUpperCase()
  return found
    .map((row) => ({
      ticker,
      name: String(row['issueName'] ?? ''),
      settlementDate: String(row['settlementDate'] ?? ''),
      shortShares: asNum(row['currentShortPositionQuantity']),
      previousShortShares: asNum(row['previousShortPositionQuantity']),
      change: asNum(row['changePreviousNumber']),
      changePercent: asNum(row['changePercent']),
      averageDailyVolume: asNum(row['averageDailyVolumeQuantity']),
      daysToCover: asNum(row['daysToCoverQuantity']),
      market: String(row['marketClassCode'] ?? ''),
    }))
    .filter((row) => row.settlementDate.length > 0)
    .sort((a, b) => a.settlementDate.localeCompare(b.settlementDate))
    .slice(-limit)
}

/**
 * FINRA reports daily Reg SHO short volume separately per Trade Reporting Facility (NCTRF, NQTRF, NYTRF).
 * Summing across facilities for each tradeReportDate gives the true consolidated off-exchange short ratio.
 */
export function normalizeRegShoDailyRows(
  symbol: string,
  found: readonly Record<string, unknown>[],
  limit: number,
): RegShoDailyRow[] {
  const ticker = symbol.trim().toUpperCase()
  const byDate = new Map<
    string,
    { shortVol: number; exemptVol: number; totalVol: number; facilities: Set<string> }
  >()
  for (const row of found) {
    const date = String(row['tradeReportDate'] ?? '').slice(0, 10)
    if (!date) continue
    const bucket = byDate.get(date) ?? { shortVol: 0, exemptVol: 0, totalVol: 0, facilities: new Set<string>() }
    bucket.shortVol += asNum(row['shortParQuantity']) ?? 0
    bucket.exemptVol += asNum(row['shortExemptParQuantity']) ?? 0
    bucket.totalVol += asNum(row['totalParQuantity']) ?? 0
    const fac = String(row['reportingFacilityCode'] ?? '').trim()
    if (fac) bucket.facilities.add(fac)
    byDate.set(date, bucket)
  }
  return [...byDate.entries()]
    .map(([date, b]) => {
      const shortVolume = Math.round(b.shortVol)
      const shortExemptVolume = Math.round(b.exemptVol)
      const totalVolume = Math.round(b.totalVol)
      const combinedShort = b.shortVol + b.exemptVol
      const shortRatio = b.totalVol > 0 ? Number((combinedShort / b.totalVol).toFixed(4)) : null
      return {
        ticker,
        date,
        shortVolume,
        shortExemptVolume,
        totalVolume,
        shortRatio,
        facilities: [...b.facilities].sort().join(', '),
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit)
}

export function normalizeAtsWeeklyRows(
  symbol: string,
  found: readonly Record<string, unknown>[],
  limit: number,
): AtsVenueRow[] {
  const ticker = symbol.trim().toUpperCase()
  return found
    .map((row) => {
      const shares = Math.round(asNum(row['totalWeeklyShareQuantity']) ?? 0)
      const trades = Math.round(asNum(row['totalWeeklyTradeCount']) ?? 0)
      const notional = asNum(row['totalNotionalSum'])
      const mpid = String(row['MPID'] ?? '').trim()
      const venue = String(row['marketParticipantName'] ?? (mpid || row['summaryTypeCode'] || '')).trim()
      return {
        ticker,
        name: String(row['issueName'] ?? ''),
        weekStartDate: String(row['weekStartDate'] ?? row['summaryStartDate'] ?? '').slice(0, 10),
        mpid,
        venue,
        summaryType: String(row['summaryTypeCode'] ?? ''),
        tier: String(row['tierDescription'] ?? row['tierIdentifier'] ?? ''),
        shares,
        trades,
        notional: notional !== null ? Math.round(notional) : null,
        avgTradeShares: trades > 0 ? Math.round(shares / trades) : null,
      }
    })
    .filter((row) => row.weekStartDate.length > 0 && row.shares > 0)
    .sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate) || b.shares - a.shares)
    .slice(0, limit)
}

export function readShortsState(raw: unknown): ShortsState {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const ticker = typeof obj['ticker'] === 'string' ? obj['ticker'].trim().toUpperCase() : ''
  const tabRaw = obj['tab']
  const tab: ShortsTab = TABS.includes(tabRaw as ShortsTab) ? (tabRaw as ShortsTab) : 'short-interest'
  const limitNum = typeof obj['limit'] === 'number' && Number.isFinite(obj['limit']) ? Math.trunc(obj['limit']) : 40
  const limit = Math.max(1, Math.min(200, limitNum))
  return { ticker, tab, limit }
}

export function buildShortsOutput(
  state: ShortsState,
  rows: readonly Record<string, unknown>[],
): ShortsOutput {
  if (!state.ticker || rows.length === 0) {
    return {
      ticker: state.ticker,
      tab: state.tab,
      count: 0,
      latestDate: null,
      shortShares: null,
      daysToCover: null,
      dailyShortRatio: null,
      topVenue: null,
      topVenueShares: null,
    }
  }
  if (state.tab === 'short-interest') {
    const latest = rows[rows.length - 1] ?? {}
    return {
      ticker: state.ticker,
      tab: state.tab,
      count: rows.length,
      latestDate: typeof latest['settlementDate'] === 'string' ? latest['settlementDate'].slice(0, 10) : null,
      shortShares: asNum(latest['shortShares']),
      daysToCover: asNum(latest['daysToCover']),
      dailyShortRatio: null,
      topVenue: null,
      topVenueShares: null,
    }
  }
  if (state.tab === 'regsho-daily') {
    const latest = rows[rows.length - 1] ?? {}
    return {
      ticker: state.ticker,
      tab: state.tab,
      count: rows.length,
      latestDate: typeof latest['date'] === 'string' ? latest['date'].slice(0, 10) : null,
      shortShares: asNum(latest['shortVolume']),
      daysToCover: null,
      dailyShortRatio: asNum(latest['shortRatio']),
      topVenue: null,
      topVenueShares: null,
    }
  }
  const top = rows[0] ?? {}
  return {
    ticker: state.ticker,
    tab: state.tab,
    count: rows.length,
    latestDate: typeof top['weekStartDate'] === 'string' ? top['weekStartDate'].slice(0, 10) : null,
    shortShares: null,
    daysToCover: null,
    dailyShortRatio: null,
    topVenue: typeof top['venue'] === 'string' ? top['venue'].slice(0, 120) : null,
    topVenueShares: asNum(top['shares']),
  }
}

export function shortsSummary(
  state: { ticker?: string; tab?: ShortsTab },
  output: ShortsOutput | null | undefined,
): string {
  const ticker = (state.ticker ?? output?.ticker ?? '').trim().toUpperCase()
  const tab = state.tab ?? output?.tab ?? 'short-interest'
  if (!ticker) return 'FINRA Short & Dark Pools'
  if (!output || output.count === 0) return `${ticker} FINRA (${tab})`
  if (tab === 'short-interest' && output.shortShares !== null) {
    const dtc = output.daysToCover !== null ? `, ${output.daysToCover.toFixed(1)}d to cover` : ''
    return `${ticker} short interest: ${output.shortShares.toLocaleString('en-US')} sh${dtc} (${output.latestDate ?? ''})`
  }
  if (tab === 'regsho-daily' && output.dailyShortRatio !== null) {
    return `${ticker} Reg SHO short vol: ${(output.dailyShortRatio * 100).toFixed(1)}% (${output.latestDate ?? ''})`
  }
  if (tab === 'ats-volume' && output.topVenue) {
    return `${ticker} ATS dark pools: top ${output.topVenue} (${output.latestDate ?? ''})`
  }
  return `${ticker} FINRA (${tab}): ${output.count} rows`
}

export function fmtInt(val: unknown): string {
  const n = asNum(val)
  return n === null ? '—' : Math.round(n).toLocaleString('en-US')
}

export function fmtPct(val: unknown, scale = 1): string {
  const n = asNum(val)
  return n === null ? '—' : `${(n * scale).toFixed(1)}%`
}

export function fmtDec(val: unknown, digits = 2): string {
  const n = asNum(val)
  return n === null ? '—' : n.toFixed(digits)
}
