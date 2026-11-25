import { useEffect, useState, type ReactElement } from 'react'
import { useData, usePanelState, usePublish, type PanelRef } from '@jaspers-ai/sdk'
import {
  buildShortsOutput,
  fmtDec,
  fmtInt,
  fmtPct,
  readShortsState,
  type ShortsState,
  type ShortsTab,
} from './finra.ts'
import './styles.css'

const TAB_LABELS: { id: ShortsTab; label: string }[] = [
  { id: 'short-interest', label: 'Short Interest' },
  { id: 'regsho-daily', label: 'Daily Reg SHO' },
  { id: 'ats-volume', label: 'ATS Dark Pools' },
]

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    const rows = (data as Record<string, unknown>)['rows']
    if (Array.isArray(rows)) return rows as Record<string, unknown>[]
  }
  return []
}

export function ShortsView({ panel }: { panel: PanelRef }): ReactElement {
  const initial = useData(`workspaces/${panel.workspaceId}/panels/${panel.id}/state`)
  if (initial === undefined) return <div className="fn-root"><p className="fn-note">Loading…</p></div>
  return <ShortsPanel panel={panel} initial={initial} />
}

function ShortsPanel({ panel, initial }: { panel: PanelRef; initial: unknown }): ReactElement {
  const first = readShortsState(initial)
  const [ticker, setTicker] = usePanelState<string>(panel, 'ticker', first.ticker)
  const [tab, setTab] = usePanelState<ShortsTab>(panel, 'tab', first.tab)
  const [limit] = usePanelState<number>(panel, 'limit', first.limit)
  const state = readShortsState({ ticker, tab, limit })
  const [draft, setDraft] = useState(state.ticker)

  useEffect(() => {
    setDraft(state.ticker)
  }, [state.ticker])

  return (
    <div className="fn-root">
      <div className="fn-bar">
        <input
          className="fn-input"
          value={draft}
          placeholder="AAPL"
          aria-label="Ticker symbol"
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setTicker(draft.trim().toUpperCase())
          }}
          onBlur={() => {
            const next = draft.trim().toUpperCase()
            if (next && next !== state.ticker) setTicker(next)
          }}
        />
        <div className="fn-tabs">
          {TAB_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`fn-tab ${state.tab === item.id ? 'fn-tab-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fn-body">
        {!state.ticker ? (
          <Empty panel={panel} state={state} />
        ) : state.tab === 'short-interest' ? (
          <ShortInterestBody panel={panel} state={state} />
        ) : state.tab === 'regsho-daily' ? (
          <RegShoBody panel={panel} state={state} />
        ) : (
          <AtsBody panel={panel} state={state} />
        )}
      </div>
    </div>
  )
}

function Empty({ panel, state }: { panel: PanelRef; state: ShortsState }): ReactElement {
  usePublish(panel, buildShortsOutput(state, []))
  return <p className="fn-note">Enter a ticker symbol (e.g. AAPL, NVDA, GME) to inspect FINRA short and dark-pool data.</p>
}

function ShortInterestBody({ panel, state }: { panel: PanelRef; state: ShortsState }): ReactElement {
  const run = useData('finra/short-interest', { ticker: state.ticker, limit: state.limit })
  const rows = rowsOf(run.data)
  usePublish(panel, buildShortsOutput(state, rows))
  if (run.error) return <p className="fn-error">{run.error}</p>
  if (run.loading && rows.length === 0) return <p className="fn-note">Loading short interest…</p>
  const newestFirst = [...rows].reverse()
  return (
    <table className="fn-table">
      <thead>
        <tr>
          <th>Settlement</th>
          <th className="fn-num">Short Shares</th>
          <th className="fn-num">Change %</th>
          <th className="fn-num">Avg Daily Vol</th>
          <th className="fn-num">Days to Cover</th>
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((row, idx) => {
          const chg = typeof row['changePercent'] === 'number' ? row['changePercent'] : null
          return (
            <tr key={`${String(row['settlementDate'] ?? idx)}`}>
              <td>{String(row['settlementDate'] ?? '')}</td>
              <td className="fn-num">{fmtInt(row['shortShares'])}</td>
              <td className={`fn-num ${chg !== null ? (chg > 0 ? 'fn-down' : chg < 0 ? 'fn-up' : '') : ''}`}>
                {fmtPct(chg)}
              </td>
              <td className="fn-num">{fmtInt(row['averageDailyVolume'])}</td>
              <td className="fn-num">{fmtDec(row['daysToCover'], 2)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RegShoBody({ panel, state }: { panel: PanelRef; state: ShortsState }): ReactElement {
  const run = useData('finra/regsho-daily', { ticker: state.ticker, days: state.limit })
  const rows = rowsOf(run.data)
  usePublish(panel, buildShortsOutput(state, rows))
  if (run.error) return <p className="fn-error">{run.error}</p>
  if (run.loading && rows.length === 0) return <p className="fn-note">Loading Reg SHO daily short volume…</p>
  const newestFirst = [...rows].reverse()
  return (
    <table className="fn-table">
      <thead>
        <tr>
          <th>Trade Date</th>
          <th className="fn-num">Short Vol</th>
          <th className="fn-num">Exempt Vol</th>
          <th className="fn-num">Total TRF Vol</th>
          <th className="fn-num">Short Ratio</th>
          <th>Facilities</th>
        </tr>
      </thead>
      <tbody>
        {newestFirst.map((row, idx) => (
          <tr key={`${String(row['date'] ?? idx)}`}>
            <td>{String(row['date'] ?? '')}</td>
            <td className="fn-num">{fmtInt(row['shortVolume'])}</td>
            <td className="fn-num">{fmtInt(row['shortExemptVolume'])}</td>
            <td className="fn-num">{fmtInt(row['totalVolume'])}</td>
            <td className="fn-num">{fmtPct(row['shortRatio'], 100)}</td>
            <td>{String(row['facilities'] ?? '')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AtsBody({ panel, state }: { panel: PanelRef; state: ShortsState }): ReactElement {
  const run = useData('finra/ats-volume', {
    ticker: state.ticker,
    weeks: 8,
    summaryType: 'ats-venues',
    limit: state.limit,
  })
  const rows = rowsOf(run.data)
  usePublish(panel, buildShortsOutput(state, rows))
  if (run.error) return <p className="fn-error">{run.error}</p>
  if (run.loading && rows.length === 0) return <p className="fn-note">Loading ATS dark-pool venue volume…</p>
  return (
    <table className="fn-table">
      <thead>
        <tr>
          <th>Week Start</th>
          <th>MPID</th>
          <th>Dark Pool / Venue</th>
          <th className="fn-num">Shares</th>
          <th className="fn-num">Trades</th>
          <th className="fn-num">Avg Trade</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={`${String(row['weekStartDate'] ?? '')}-${String(row['mpid'] ?? idx)}`}>
            <td>{String(row['weekStartDate'] ?? '')}</td>
            <td>{String(row['mpid'] ?? '')}</td>
            <td>{String(row['venue'] ?? '')}</td>
            <td className="fn-num">{fmtInt(row['shares'])}</td>
            <td className="fn-num">{fmtInt(row['trades'])}</td>
            <td className="fn-num">{fmtInt(row['avgTradeShares'])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
