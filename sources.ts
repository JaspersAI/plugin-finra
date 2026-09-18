import { defineSource } from '@jaspers-ai/sdk'
import { z } from 'zod'

// The published SDK types a source's arguments as unknown, since from there it cannot see the
// schema beside them. Each run names what its own input parses to.
type Args = Record<string, any>

// FINRA's public data API. No key: short interest as brokers report it, twice a month, and what
// trades away from the exchanges.

const HOST = 'api.finra.org'

/** FINRA reads its filters from a POST body; a GET takes only the page size. */
async function query(ctx: { fetch: typeof fetch }, dataset: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const response = await ctx.fetch(`https://${HOST}/data/group/otcMarket/name/${dataset}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const said = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(said?.message ?? `FINRA answered ${response.status}.`)
  }
  return (await response.json()) as Record<string, unknown>[]
}

export const shortInterest = defineSource({
  description:
    'Short interest in one stock, as reported to FINRA twice a month: shares short, the change since last time, and days to cover against average volume. Newest last, ready to chart.',
  hosts: [HOST],
  input: z.object({
    ticker: z.string().describe('A ticker, like AAPL.'),
    limit: z.number().int().min(1).max(1000).default(60).describe('Reports to read. They come twice a month, so 60 is about two and a half years.'),
  }),
  async run(raw, ctx) {
    const { ticker, limit } = raw as Args
    const symbol = ticker.trim().toUpperCase()
    // FINRA refuses to sort unless every partition key is given, and answers oldest first, so a
    // small limit reads 2020. Take the lot for this symbol and keep the newest here instead; it is
    // two reports a month, so even a long history is a few hundred rows.
    const found = await query(ctx, 'consolidatedShortInterest', {
      limit: 2000,
      compareFilters: [{ fieldName: 'symbolCode', fieldValue: symbol, compareType: 'equal' }],
    })
    if (found.length === 0) throw new Error(`FINRA has no short interest for ${symbol}.`)
    const rows = found
      .map((row) => ({
        ticker: symbol,
        name: row['issueName'],
        settlementDate: row['settlementDate'],
        shortShares: row['currentShortPositionQuantity'],
        previousShortShares: row['previousShortPositionQuantity'],
        change: row['changePreviousNumber'],
        changePercent: row['changePercent'],
        averageDailyVolume: row['averageDailyVolumeQuantity'],
        daysToCover: row['daysToCoverQuantity'],
        market: row['marketClassCode'],
      }))
      .sort((a, b) => String(a.settlementDate).localeCompare(String(b.settlementDate)))
      .slice(-limit)
    return { ticker: symbol, rows }
  },
})
