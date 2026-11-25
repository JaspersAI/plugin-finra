import { definePlugin, defineView } from '@jaspers-ai/sdk'
import { z } from 'zod'
import { shortsSummary, TABS } from './finra.ts'
import { ShortsView } from './ShortsView.tsx'
import { atsVolume, regShoDaily, shortInterest, traceTreasury } from './sources.ts'

const ShortsStateSchema = z.object({
  ticker: z.string().default(''),
  tab: z.enum(TABS).default('short-interest'),
  limit: z.number().int().min(1).max(200).default(40),
})

const ShortsOutputSchema = z.object({
  ticker: z.string(),
  tab: z.enum(TABS),
  count: z.number(),
  latestDate: z.string().nullable(),
  shortShares: z.number().nullable(),
  daysToCover: z.number().nullable(),
  dailyShortRatio: z.number().nullable(),
  topVenue: z.string().nullable(),
  topVenueShares: z.number().nullable(),
})

export default definePlugin({
  id: 'finra',
  secrets: {
    finraToken: {
      label: 'FINRA API OAuth Bearer token (optional, only for Fixed Income / TRACE)',
      optional: true,
    },
  },
  sources: {
    'short-interest': shortInterest,
    'regsho-daily': regShoDaily,
    'ats-volume': atsVolume,
    'trace-treasury': traceTreasury,
  },
  views: {
    shorts: defineView(ShortsView, {
      title: 'FINRA Short & Dark Pools',
      state: ShortsStateSchema,
      output: ShortsOutputSchema,
      instructions:
        'FINRA equity short positioning and dark-pool venue volume for one ticker (no key needed). Set state.ticker (e.g. "AAPL") and state.tab to "short-interest" (twice-monthly settlement short shares & days to cover), "regsho-daily" (nightly TRF short-sale ratio), or "ats-volume" (weekly dark-pool venue shares & average trade size by MPID).',
      renders: [shortInterest, regShoDaily, atsVolume],
      summarize: shortsSummary,
    }),
  },
})
