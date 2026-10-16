import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Trophy, Wallet, PackageX, ArrowUpRight, LoaderCircle } from 'lucide-react';
import * as api from './api';
import * as offline from './offline';
import { dailySeries, topProducts, paymentMix, lowStock, changeVsPrevious } from './insights';

const dayLabel = (iso, short = true) => new Date(iso + 'T12:00:00+02:00').toLocaleDateString('en-GB', short ? { weekday: 'short' } : { weekday: 'long', day: 'numeric', month: 'short' });

function useActivity(m, uid, branchId) {
  const [state, setState] = useState({ loading: true, data: null, error: '', stale: null });
  const seq = useRef(0);
  async function load() {
    const n = ++seq.current;
    const key = offline.cacheKey(uid, m.company_id, 'activity7:' + m.role + ':' + (branchId || 'none'));
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.loadRecentActivity(m.company_id, uid, m.role, 7, branchId);
      offline.saveCache(key, data);
      if (n === seq.current) setState({ loading: false, data, error: '', stale: null });
    } catch (e) {
      if (n !== seq.current) return;
      const cached = offline.isNetworkError(e) && offline.readCache(key);
      setState(cached ? { loading: false, data: cached.data, error: '', stale: cached.savedAt } : { loading: false, data: null, error: e.message || 'Could not load sales insights.', stale: null });
    }
  }
  useEffect(() => { load(); return () => { seq.current++; }; }, [m.company_id, uid, m.role, branchId]);
  useEffect(() => offline.subscribe(ev => { if (ev.type === 'sync-end' && ev.synced) load(); }), [m.company_id, uid, m.role, branchId]);
  return state;
}

function WeekChart({ series, money, currency }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 220, padL = 8, padR = 8, padT = 26, padB = 30;
  const max = Math.max(...series.map(d => d.total), 0);
  const nice = max <= 0 ? 1 : Math.pow(10, Math.floor(Math.log10(max))) * [1, 2, 2.5, 5, 10].find(f => f * Math.pow(10, Math.floor(Math.log10(max))) >= max);
  const plotH = H - padT - padB, slot = (W - padL - padR) / series.length, bw = Math.min(54, slot * 0.56);
  const y = v => padT + plotH - (v / nice) * plotH;
  const last = series.length - 1;
  return (
    <div className="week-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales for the last 7 days">
        {[0.5, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(nice * f)} y2={y(nice * f)} className="grid-line" />
            <text x={W - padR} y={y(nice * f) - 6} textAnchor="end" className="axis-text">{money(nice * f, currency).replace(/\.00$/, '')}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="base-line" />
        {series.map((d, i) => {
          const cx = padL + slot * i + slot / 2, top = y(d.total), h = Math.max(0, y(0) - top);
          const r = Math.min(4, h / 2);
          const path = h > 0
            ? `M${cx - bw / 2},${y(0)} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${y(0)} Z`
            : '';
          return (
            <g key={d.day}>
              {path && <path d={path} className={'bar' + (i === last ? ' bar-today' : '') + (hover === i ? ' bar-hover' : '')} />}
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH + padB} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onClick={() => setHover(i)}
                tabIndex={0} aria-label={`${dayLabel(d.day, false)}: ${money(d.total, currency)}, ${d.count} sales`} />
              <text x={cx} y={H - 9} textAnchor="middle" className={'axis-text' + (i === last ? ' axis-today' : '')}>{i === last ? 'Today' : dayLabel(d.day)}</text>
              
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{money(series[hover].total, currency)}</strong>
          <span>{dayLabel(series[hover].day, false)} · {series[hover].count} {series[hover].count === 1 ? 'sale' : 'sales'}</span>
        </div>
      )}
    </div>
  );
}

function BarList({ rows, money, currency, value, detail }) {
  const max = Math.max(...rows.map(value), 0) || 1;
  return (
    <ul className="bar-list">
      {rows.map(r => (
        <li key={r.name || r.method}>
          <div className="bar-list-label"><span>{r.name || r.method}</span><strong>{money(value(r), currency)}</strong></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(value(r) > 0 ? 2 : 0, (value(r) / max) * 100)}%` }} /></div>
          {detail && <small>{detail(r)}</small>}
        </li>
      ))}
    </ul>
  );
}

export function DashboardInsights({ auth, products, money }) {
  const m = auth.membership, currency = m.companies.currency;
  const { loading, data, error, stale } = useActivity(m, auth.session.user.id, auth.branchId);
  const [showTable, setShowTable] = useState(false);
  const low = lowStock(products);
  if (loading && !data) return <div className="insights-loading" role="status"><LoaderCircle size={18} className="spin" /> Loading sales insights…</div>;
  if (!data) return error ? <div className="notice" role="alert">{error}</div> : null;
  const series = dailySeries(data.sales, 7);
  const week = series.reduce((n, d) => n + d.total, 0);
  const weekCount = series.reduce((n, d) => n + d.count, 0);
  const change = changeVsPrevious(series);
  const top = topProducts(data.items, 5);
  const mix = paymentMix(data.payments, data.sales);
  return (
    <section className="insights" aria-label="Sales insights">
      {stale && <div className="offline-banner" role="status"><strong>Offline.</strong> Showing figures saved on this device at {new Date(stale).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</div>}
      <div className="insight-card insight-wide">
        <div className="insight-head">
          <div>
            <span className="eyebrow">LAST 7 DAYS</span>
            <h2>{money(week, currency)}</h2>
            <small>{weekCount} {weekCount === 1 ? 'sale' : 'sales'} · before refunds · avg {money(weekCount ? week / weekCount : 0, currency)} per sale</small>
          </div>
          <div className="insight-head-side">
            {change != null && (
              <span className={'trend ' + (change >= 0 ? 'trend-up' : 'trend-down')}>
                {change >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
                {Math.abs(Math.round(change * 100))}% {change >= 0 ? 'above' : 'below'} daily average
              </span>
            )}
            <button className="link-button" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
          </div>
        </div>
        {showTable ? (
          <table className="mini-table">
            <thead><tr><th>Day</th><th>Sales</th><th>Total</th></tr></thead>
            <tbody>{series.map(d => <tr key={d.day}><td>{dayLabel(d.day, false)}</td><td>{d.count}</td><td>{money(d.total, currency)}</td></tr>)}</tbody>
          </table>
        ) : <WeekChart series={series} money={money} currency={currency} />}
      </div>

      <div className="insight-card">
        <div className="insight-title"><Trophy size={17} /><h3>Best sellers</h3><small>7 days, before tax</small></div>
        {top.length ? <BarList rows={top} money={money} currency={currency} value={r => r.revenue} detail={r => r.quantity + ' sold'} /> : <p className="muted">Sales will show your best sellers here.</p>}
      </div>

      <div className="insight-card">
        <div className="insight-title"><Wallet size={17} /><h3>How customers pay</h3><small>7 days</small></div>
        {mix.some(r => r.amount) ? <BarList rows={mix} money={money} currency={currency} value={r => r.amount} detail={r => Math.round(r.share * 100) + '% of payments'} /> : <p className="muted">No payments recorded yet.</p>}
      </div>

      <div className="insight-card">
        <div className="insight-title"><PackageX size={17} /><h3>Running low</h3>{auth.membership.role === 'cashier' ? <Link to="/products" className="insight-link">Products <ArrowUpRight size={14} /></Link> : <Link to="/reorder" className="insight-link">Reorder list <ArrowUpRight size={14} /></Link>}</div>
        {low.length ? (
          <ul className="low-list">
            {low.map(p => (
              <li key={p.id}>
                <span>{p.name}</span>
                <span className={'badge ' + (Number(p.stock_quantity) <= 0 ? 'red' : 'amber')}>
                  {Number(p.stock_quantity) <= 0 ? 'Out of stock' : `${p.stock_quantity} left`}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">All products are above their low-stock level.</p>}
      </div>
    </section>
  );
}
