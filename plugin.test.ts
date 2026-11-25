import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildShortsOutput,
  normalizeAtsWeeklyRows,
  normalizeRegShoDailyRows,
  normalizeShortInterestRows,
  OUTPUT_MAX,
  readShortsState,
  shortsSummary,
} from './finra.ts'
import * as sources from './sources.ts'

const all = Object.entries(sources).filter(([, one]) => (one as { kind?: string }).kind === 'source')

test('it declares all four FINRA sources', () => {
  assert.deepEqual(
    all.map(([name]) => name).sort(),
    ['atsVolume', 'regShoDaily', 'shortInterest', 'traceTreasury'],
  )
})

test('every source says what it is for, and which hosts it reaches', () => {
  for (const [name, source] of all) {
    const one = source as { description?: string; hosts?: string[] }
    assert.ok((one.description ?? '').length > 30, `${name} has no description worth reading`)
    assert.ok((one.hosts ?? []).length > 0, `${name} declares no hosts`)
    for (const host of one.hosts ?? []) assert.match(host, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, host)
  }
})

test('short interest rows sort oldest to newest and slice to the newest limit', () => {
  const rows = normalizeShortInterestRows(
    'aapl',
    [
      {
        issueName: 'Apple Inc.',
        settlementDate: '2026-10-30',
        currentShortPositionQuantity: 125_000_000,
        previousShortPositionQuantity: 120_000_000,
        changePreviousNumber: 5_000_000,
        changePercent: 4.17,
        averageDailyVolumeQuantity: 50_000_000,
        daysToCoverQuantity: 2.5,
        marketClassCode: 'NNM',
      },
      {
        issueName: 'Apple Inc.',
        settlementDate: '2026-10-15',
        currentShortPositionQuantity: 120_000_000,
        previousShortPositionQuantity: 118_000_000,
        changePreviousNumber: 2_000_000,
        changePercent: 1.69,
        averageDailyVolumeQuantity: 48_000_000,
        daysToCoverQuantity: 2.5,
        marketClassCode: 'NNM',
      },
    ],
    1,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.ticker, 'AAPL')
  assert.equal(rows[0]!.settlementDate, '2026-10-30')
  assert.equal(rows[0]!.shortShares, 125_000_000)
})

test('regShoDaily consolidates NCTRF and NQTRF rows per tradeReportDate and computes shortRatio', () => {
  const rows = normalizeRegShoDailyRows(
    'AAPL',
    [
      {
        tradeReportDate: '2026-11-02',
        reportingFacilityCode: 'NCTRF',
        shortParQuantity: 162_093.07,
        shortExemptParQuantity: 226,
        totalParQuantity: 269_381.43,
      },
      {
        tradeReportDate: '2026-11-02',
        reportingFacilityCode: 'NQTRF',
        shortParQuantity: 4_837_680.93,
        shortExemptParQuantity: 0,
        totalParQuantity: 9_730_618.57,
      },
    ],
    10,
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.date, '2026-11-02')
  assert.equal(rows[0]!.shortVolume, 4_999_774)
  assert.equal(rows[0]!.shortExemptVolume, 226)
  assert.equal(rows[0]!.totalVolume, 10_000_000)
  assert.equal(rows[0]!.shortRatio, 0.5)
  assert.equal(rows[0]!.facilities, 'NCTRF, NQTRF')
})

test('ATS dark-pool rows sort newest week first, then largest share volume, and compute avgTradeShares', () => {
  const rows = normalizeAtsWeeklyRows(
    'AAPL',
    [
      {
        issueName: 'Apple Inc.',
        weekStartDate: '2026-10-19',
        MPID: 'LQNA',
        marketParticipantName: 'LQNA LIQUIDNET H2O ATS',
        summaryTypeCode: 'ATS_W_SMBL_FIRM',
        tierDescription: 'NMS Tier 1',
        totalWeeklyShareQuantity: 120_000,
        totalWeeklyTradeCount: 12,
        totalNotionalSum: 27_600_000,
      },
      {
        issueName: 'Apple Inc.',
        weekStartDate: '2026-10-19',
        MPID: 'KCGM',
        marketParticipantName: 'KCGM VIRTU MATCHIT ATS',
        summaryTypeCode: 'ATS_W_SMBL_FIRM',
        tierDescription: 'NMS Tier 1',
        totalWeeklyShareQuantity: 400_000,
        totalWeeklyTradeCount: 4_000,
        totalNotionalSum: 92_000_000,
      },
    ],
    10,
  )
  assert.equal(rows[0]!.mpid, 'KCGM')
  assert.equal(rows[0]!.avgTradeShares, 100)
  assert.equal(rows[1]!.mpid, 'LQNA')
  assert.equal(rows[1]!.avgTradeShares, 10_000)
})

test('view state, summary, and 4 KB output cap hold even on very long venue strings', () => {
  const state = readShortsState({ ticker: ' aapl ', tab: 'ats-volume', limit: 999 })
  assert.deepEqual(state, { ticker: 'AAPL', tab: 'ats-volume', limit: 200 })
  const output = buildShortsOutput(state, [
    {
      weekStartDate: '2026-10-19',
      venue: 'VIRTU MATCHIT '.repeat(40),
      shares: 400_000,
    },
  ])
  assert.ok(new TextEncoder().encode(JSON.stringify(output)).length <= OUTPUT_MAX)
  assert.match(shortsSummary(state, output), /^AAPL ATS dark pools: top VIRTU MATCHIT/)
})
