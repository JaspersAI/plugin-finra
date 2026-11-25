import { defineSource } from '@jaspers-ai/sdk'
import { z } from 'zod'
import {
  isoDaysAgo,
  normalizeAtsWeeklyRows,
  normalizeRegShoDailyRows,
  normalizeShortInterestRows,
} from './finra.ts'

// FINRA's public Query API (api.finra.org).
// Equity OTC datasets (consolidatedShortInterest, regShoDaily, weeklySummary) answer without an API key;
// Fixed Income / TRACE datasets require a free FINRA API OAuth bearer token.

const HOST = 'api.finra.org'

async function queryOtc(
  ctx: { fetch: typeof fetch },
  dataset: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const response = await ctx.fetch(`https://${HOST}/data/group/otcMarket/name/${dataset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 204) return []
  if (!response.ok) {
    const said = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(said?.message ?? `FINRA answered ${response.status}.`)
  }
  return (await response.json()) as Record<string, unknown>[]
}

export const shortInterest = defineSource({
  description:
    'Short interest in one stock, as reported to FINRA twice a month: shares short, the change since last time, and days to cover against average volume. Newest last, ready to chart. No key needed.',
  hosts: [HOST],
  input: z.object({
    ticker: z.string().describe('A ticker, like AAPL.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(60)
      .describe('Reports to read. They come twice a month, so 60 is about two and a half years.'),
  }),
  async run({ ticker, limit }, ctx) {
    const symbol = ticker.trim().toUpperCase()
    const found = await queryOtc(ctx, 'consolidatedShortInterest', {
      limit: 2000,
      compareFilters: [{ fieldName: 'symbolCode', fieldValue: symbol, compareType: 'equal' }],
    })
    if (found.length === 0) throw new Error(`FINRA has no short interest for ${symbol}.`)
    const rows = normalizeShortInterestRows(symbol, found, limit)
    return { ticker: symbol, rows }
  },
})

export const regShoDaily = defineSource({
  description:
    'Daily off-exchange Reg SHO short sale volume vs. total FINRA TRF volume for one ticker, consolidated across reporting facilities (NCTRF, NQTRF, NYTRF) with shortRatio. Updates nightly. No key needed.',
  hosts: [HOST],
  input: z.object({
    ticker: z.string().describe('A ticker, like AAPL or NVDA.'),
    days: z
      .number()
      .int()
      .min(1)
      .max(250)
      .default(60)
      .describe('Trading days to return, oldest first, ready to chart.'),
  }),
  async run({ ticker, days }, ctx) {
    const symbol = ticker.trim().toUpperCase()
    const now = new Date()
    // Pull enough calendar days to cover `days` trading sessions across up to 4 TRF facilities per day.
    const lookbackCalendarDays = Math.max(90, Math.ceil(days * 1.7) + 20)
    const startDate = isoDaysAgo(now, lookbackCalendarDays)
    const endDate = isoDaysAgo(now, -2)
    const found = await queryOtc(ctx, 'regShoDaily', {
      limit: 5000,
      compareFilters: [
        {
          fieldName: 'securitiesInformationProcessorSymbolIdentifier',
          fieldValue: symbol,
          compareType: 'equal',
        },
      ],
      dateRangeFilters: [{ fieldName: 'tradeReportDate', startDate, endDate }],
    })
    if (found.length === 0) throw new Error(`FINRA has no recent Reg SHO daily short volume for ${symbol}.`)
    const rows = normalizeRegShoDailyRows(symbol, found, days)
    return { ticker: symbol, rows }
  },
})

export const atsVolume = defineSource({
  description:
    'Weekly ATS dark-pool and non-ATS OTC equity trading volume and trade counts by venue/MPID (e.g. Virtu, UBS ATS, Liquidnet, Interactive Brokers, Citadel) for one ticker from FINRA weeklySummary. No key needed.',
  hosts: [HOST],
  input: z.object({
    ticker: z.string().describe('A ticker, like AAPL or TSLA.'),
    weeks: z
      .number()
      .int()
      .min(1)
      .max(52)
      .default(8)
      .describe('Recent calendar weeks to query (FINRA publishes ATS symbol-firm rows with a 2-to-4-week delay).'),
    summaryType: z
      .enum(['ats-venues', 'otc-firms', 'aggregates', 'all'])
      .default('ats-venues')
      .describe(
        'ats-venues = individual dark pools (ATS_W_SMBL_FIRM); otc-firms = non-ATS wholesalers (OTC_W_SMBL_FIRM); aggregates = total ATS/OTC summary; all = every row.',
      ),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async run({ ticker, weeks, summaryType, limit }, ctx) {
    const symbol = ticker.trim().toUpperCase()
    const now = new Date()
    // Add 35 days buffer for FINRA's Tier 1/Tier 2 ATS publication lag.
    const startDate = isoDaysAgo(now, weeks * 7 + 35)
    const endDate = isoDaysAgo(now, -2)
    const compareFilters: Record<string, unknown>[] = [
      { fieldName: 'issueSymbolIdentifier', fieldValue: symbol, compareType: 'equal' },
    ]
    if (summaryType === 'ats-venues') {
      compareFilters.push({ fieldName: 'summaryTypeCode', fieldValue: 'ATS_W_SMBL_FIRM', compareType: 'equal' })
    } else if (summaryType === 'otc-firms') {
      compareFilters.push({ fieldName: 'summaryTypeCode', fieldValue: 'OTC_W_SMBL_FIRM', compareType: 'equal' })
    } else if (summaryType === 'aggregates') {
      compareFilters.push({ fieldName: 'summaryTypeCode', fieldValue: 'ATS_W_SMBL', compareType: 'equal' })
    }
    const found = await queryOtc(ctx, 'weeklySummary', {
      limit: 5000,
      compareFilters,
      dateRangeFilters: [{ fieldName: 'weekStartDate', startDate, endDate }],
    })
    if (found.length === 0) throw new Error(`FINRA has no weekly ATS/OTC volume rows for ${symbol} in that window.`)
    const rows = normalizeAtsWeeklyRows(symbol, found, limit)
    return { ticker: symbol, summaryType, rows }
  },
})

export const traceTreasury = defineSource({
  description:
    'Daily U.S. Treasury secondary-market TRACE volume aggregates by security category (Bills, FRNs, Nominal Coupons, TIPS) and counterparty type. Requires an optional FINRA API OAuth bearer token.',
  hosts: [HOST],
  input: z.object({
    days: z.number().int().min(1).max(120).default(30).describe('Lookback calendar days to fetch.'),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async run({ days, limit }, ctx) {
    const now = new Date()
    const startDate = isoDaysAgo(now, days + 7)
    const endDate = isoDaysAgo(now, -2)
    const response = await ctx.fetch(`https://${HOST}/data/group/fixedIncomeMarket/name/treasuryDailyAggregates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: 'Bearer ${secret:finraToken}',
      },
      body: JSON.stringify({
        limit,
        dateRangeFilters: [{ fieldName: 'tradeDate', startDate, endDate }],
      }),
    })
    if (response.status === 204) return { rows: [] }
    if (!response.ok) {
      const said = (await response.json().catch(() => null)) as { message?: string } | null
      throw new Error(said?.message ?? `FINRA Fixed Income answered ${response.status}.`)
    }
    const rows = (await response.json()) as Record<string, unknown>[]
    return { rows }
  },
})
