import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Trophy, Wallet, Hourglass, ArrowUpRight, Clock, Receipt, ShoppingCart, PackageX, Minus } from 'lucide-react';
import * as api from './api';
import * as offline from './offline';
import { Skeleton } from './Loading';
import { dailySeries, topProducts, paymentMix } from './insights';
import { hourly, sparkPath, pctChange } from './dashboard-utils';
import { forecast, runningOut } from './forecast-utils';
import { RunOutList } from './RunOut';

const dayLabel = (iso, short = true) => new Date(iso + 'T12:00:00+02:00').toLocaleDateString('en-GB', short ? { weekday: 'short' } : { weekday: 'long', day: 'numeric', month: 'short' });
const lusakaToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date());
const PAY_COLORS = { 'Cash': '#2f8a66', 'Airtel Money': '#d9534f', 'MTN Money': '#e3b13b', 'Bank/Card': '#4f86c6' };

function useActivity(m, uid, branchId) {
  const [state, setState] = useState({ loading: true, data: null, error: '', stale: null });
  const seq = useRef(0);
  async function load() {
    const n = ++seq.current;
    const key = offline.cacheKey(uid, m.company_id, 'activity14:' + m.role + ':' + (branchId || 'none'));
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const data = await api.loadRecentActivity(m.company_id, uid, m.role, 14, branchId);
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

function Delta({ value, suffix }) {
  if (value == null) return <span className="delta flat"><Minus size={13} /> {suffix ? 'no data yet' : ''}</span>;
  const up = value >= 0;
  return <span className={'delta ' + (Math.round(value * 100) === 0 ? 'flat' : up ? 'up' : 'down')}>{up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(Math.round(value * 100))}% {suffix}</span>;
}

function Spark({ values, label }) {
  const W = 120, H = 34, d = sparkPath(values, W, H, 3);
  if (!d) return null;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <path d={d.area} className="spark-area" />
      <path d={d.line} className="spark-line" />
      <circle cx={d.last[0]} cy={d.last[1]} r="2.6" className="spark-dot" />
    </svg>
  );
}

function Kpi({ icon: Icon, label, value, delta, spark, sparkLabel, children, tone }) {
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '') + (spark ? ' has-spark' : '')}>
      <div className="kpi-head"><span>{label}</span><Icon size={17} /></div>
      <strong className="kpi-value">{value}</strong>
      <div className="kpi-foot">{delta}{children}</div>
      {spark && <Spark values={spark} label={sparkLabel} />}
    </div>
  );
}

function WeekChart({ series, previous, money, currency }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = 230, padL = 8, padR = 8, padT = 28, padB = 30;
  const max = Math.max(...series.map(d => d.total), ...previous.map(d => d.total), 0);
  const mag = max > 0 ? Math.pow(10, Math.floor(Math.log10(max))) : 1;
  const nice = max <= 0 ? 1 : mag * [1, 2, 2.5, 5, 10].find(f => f * mag >= max);
  const plotH = H - padT - padB, slot = (W - padL - padR) / series.length, bw = Math.min(46, slot * 0.5);
  const y = v => padT + plotH - (v / nice) * plotH;
  const last = series.length - 1;
  const bar = (cx, top, w) => {
    const h = Math.max(0, y(0) - top), r = Math.min(4, h / 2);
    return h > 0 ? `M${cx - w / 2},${y(0)} V${top + r} Q${cx - w / 2},${top} ${cx - w / 2 + r},${top} H${cx + w / 2 - r} Q${cx + w / 2},${top} ${cx + w / 2},${top + r} V${y(0)} Z` : '';
  };
  return (
    <div className="week-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales this week compared with last week">
        {[0.5, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(nice * f)} y2={y(nice * f)} className="grid-line" />
            <text x={W - padR} y={y(nice * f) - 6} textAnchor="end" className="axis-text">{money(nice * f, currency).replace(/\.00$/, '')}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="base-line" />
        {series.map((d, i) => {
          const cx = padL + slot * i + slot / 2, prev = previous[i];
          return (
            <g key={d.day}>
              {prev && <path d={bar(cx, y(prev.total), bw + 10)} className="bar-prev" />}
              <path d={bar(cx, y(d.total), bw)} className={'bar' + (i === last ? ' bar-today' : '') + (hover === i ? ' bar-hover' : '')} />
              <rect x={padL + slot * i} y={padT} width={slot} height={plotH + padB} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} onClick={() => setHover(i)}
                tabIndex={0} aria-label={`${dayLabel(d.day, false)}: ${money(d.total, currency)}, ${d.count} sales. Same day last week: ${money(prev?.total || 0, currency)}`} />
              <text x={cx} y={H - 9} textAnchor="middle" className={'axis-text' + (i === last ? ' axis-today' : '')}>{i === last ? 'Today' : dayLabel(d.day)}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
          <strong>{money(series[hover].total, currency)}</strong>
          <span>{dayLabel(series[hover].day, false)} · {series[hover].count} {series[hover].count === 1 ? 'sale' : 'sales'}</span>
          <span className="tip-prev">Last week: {money(previous[hover]?.total || 0, currency)}</span>
        </div>
      )}
      <div className="chart-legend"><span><i className="lg-now" /> This week</span><span><i className="lg-prev" /> Same day last week</span></div>
    </div>
  );
}

function HourChart({ rows, money, currency }) {
  const W = 360, H = 170, padT = 14, padB = 24, padX = 4;
  const max = Math.max(1, ...rows.map(r => Math.max(r.today, r.usual)));
  const slot = (W - padX * 2) / rows.length, bw = Math.max(4, slot * 0.6), plotH = H - padT - padB;
  const y = v => padT + plotH - (v / max) * plotH;
  const now = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lusaka', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return (
    <svg className="hour-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales by hour today compared with a usual day">
      <line x1={padX} x2={W - padX} y1={y(0)} y2={y(0)} className="base-line" />
      {rows.map((r, i) => {
        const cx = padX + slot * i + slot / 2;
        return (
          <g key={r.hour}>
            <title>{`${String(r.hour).padStart(2, '0')}:00 — today ${money(r.today, currency)}, usually ${money(r.usual, currency)}`}</title>
            {r.today > 0 && <rect x={cx - bw / 2} y={y(r.today)} width={bw} height={Math.max(1, y(0) - y(r.today))} rx="2" className={'hbar' + (r.hour === now ? ' hbar-now' : '')} />}
            {r.usual > 0 && <line x1={cx - bw / 2 - 2} x2={cx + bw / 2 + 2} y1={y(r.usual)} y2={y(r.usual)} className="usual-tick" />}
            {i % Math.ceil(rows.length / 6) === 0 && <text x={cx} y={H - 7} textAnchor="middle" className="axis-text">{String(r.hour).padStart(2, '0')}h</text>}
          </g>
        );
      })}
    </svg>
  );
}

function Donut({ rows, money, currency }) {
  const total = rows.reduce((n, r) => n + r.amount, 0);
  const R = 42, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 110 110" role="img" aria-label="How customers paid">
        <circle cx="55" cy="55" r={R} className="donut-track" />
        {rows.filter(r => r.amount > 0).map(r => {
          const len = (r.amount / total) * C, el = <circle key={r.method} cx="55" cy="55" r={R} fill="none" stroke={PAY_COLORS[r.method] || '#8a978f'} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 55 55)" />;
          offset += len; return el;
        })}
        <text x="55" y="52" textAnchor="middle" className="donut-big">{Math.round((rows.find(r => r.method === 'Cash')?.share || 0) * 100)}%</text>
        <text x="55" y="67" textAnchor="middle" className="donut-small">cash</text>
      </svg>
      <ul className="donut-legend">
        {rows.map(r => <li key={r.method}><i style={{ background: PAY_COLORS[r.method] || '#8a978f' }} /><span>{r.method}</span><strong>{money(r.amount, currency)}</strong></li>)}
      </ul>
    </div>
  );
}

function BarList({ rows, money, currency }) {
  const max = Math.max(...rows.map(r => r.revenue), 0) || 1;
  return (
    <ul className="bar-list">
      {rows.map((r, i) => (
        <li key={r.name}>
          <div className="bar-list-label"><span><b className="rank">{i + 1}</b>{r.name}</span><strong>{money(r.revenue, currency)}</strong></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(r.revenue > 0 ? 2 : 0, (r.revenue / max) * 100)}%` }} /></div>
          <small>{r.quantity} sold</small>
        </li>
      ))}
    </ul>
  );
}

/**
 * Home dashboard: today's numbers with small trend lines, this week against last week,
 * what is about to run out, best sellers, sales by hour and how customers pay.
 * today = { total (after refunds), count, items } from the dashboard's own "today" figures.
 */
export function DashboardInsights({ auth, products, money, today }) {
  const m = auth.membership, currency = m.companies.currency;
  const { loading, data, error, stale } = useActivity(m, auth.session.user.id, auth.branchId);
  const [showTable, setShowTable] = useState(false);
  if (loading && !data) return <Skeleton kind="dashboard" label="Loading your sales…" />;
  if (!data) return error ? <div className="notice" role="alert">{error}</div> : null;

  const day = lusakaToday();
  const series14 = dailySeries(data.sales, 14), week = series14.slice(7), prevWeek = series14.slice(0, 7);
  const weekTotal = week.reduce((n, d) => n + d.total, 0), prevTotal = prevWeek.reduce((n, d) => n + d.total, 0);
  const weekCount = week.reduce((n, d) => n + d.count, 0);
  const lastWeekSameDay = prevWeek[6];
  const avgToday = today.count ? today.total / today.count : 0;
  const avg7 = weekCount ? weekTotal / weekCount : 0;
  const weekIds = new Set(data.sales.filter(s => week.some(d => d.day === new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Lusaka' }).format(new Date(s.created_at)))).map(s => s.id));
  const top = topProducts(data.items.filter(i => weekIds.has(i.sale_id)), 5);
  const mix = paymentMix(data.payments.filter(p => weekIds.has(p.sale_id)), data.sales.filter(s => weekIds.has(s.id)));
  const hours = hourly(data.sales, day, 14);
  const predicted = forecast({ products, sales: data.sales, items: data.items, today: day, days: 14 });
  const soon = runningOut(predicted, 14), urgent = soon.filter(r => r.daysLeft < 7);
  const outCount = products.filter(p => Number(p.stock_quantity) <= 0).length;
  const reorderLink = m.role === 'cashier' ? '/products' : '/reorder';

  return (
    <section className="insights home-dash" aria-label="Sales at a glance">
      {stale && <div className="offline-banner" role="status"><strong>Offline.</strong> Showing figures saved on this device at {new Date(stale).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</div>}

      <div className="kpi-row">
        <Kpi icon={Wallet} label="Today's sales" value={money(today.total, currency)} spark={week.map(d => d.total)} sparkLabel="Sales each day this week"
          delta={<Delta value={pctChange(week[6]?.total || 0, lastWeekSameDay?.total || 0)} suffix={`vs last ${dayLabel(day, true)}`} />} />
        <Kpi icon={Receipt} label="Sales today" value={today.count} spark={week.map(d => d.count)} sparkLabel="Number of sales each day this week"
          delta={<Delta value={pctChange(today.count, lastWeekSameDay?.count || 0)} suffix={`vs last ${dayLabel(day, true)}`} />} />
        <Kpi icon={ShoppingCart} label="Average sale" value={money(avgToday, currency)}
          delta={<Delta value={today.count ? pctChange(avgToday, avg7) : null} suffix="vs this week" />}>
          <small className="kpi-note">{today.items} {today.items === 1 ? 'item' : 'items'} sold today</small>
        </Kpi>
        <Kpi icon={PackageX} label="Running out" value={urgent.length} tone={urgent.length ? 'warn' : ''}
          delta={<span className="kpi-note">{outCount ? `${outCount} out of stock · ` : ''}within 7 days</span>}>
          <Link to={reorderLink} className="kpi-link">See list <ArrowUpRight size={13} /></Link>
        </Kpi>
      </div>

      <div className="dash-grid">
        <div className="insight-card insight-wide">
          <div className="insight-head">
            <div>
              <span className="eyebrow">THIS WEEK</span>
              <h2>{money(weekTotal, currency)}</h2>
              <small>{weekCount} {weekCount === 1 ? 'sale' : 'sales'} in 7 days · before refunds · last week {money(prevTotal, currency)}</small>
            </div>
            <div className="insight-head-side">
              <Delta value={pctChange(weekTotal, prevTotal)} suffix="vs last week" />
              <button className="link-button" onClick={() => setShowTable(!showTable)}>{showTable ? 'Show chart' : 'Show as table'}</button>
            </div>
          </div>
          {showTable ? (
            <table className="mini-table">
              <thead><tr><th>Day</th><th>Sales</th><th>Total</th><th>Same day last week</th></tr></thead>
              <tbody>{week.map((d, i) => <tr key={d.day}><td>{dayLabel(d.day, false)}</td><td>{d.count}</td><td>{money(d.total, currency)}</td><td>{money(prevWeek[i].total, currency)}</td></tr>)}</tbody>
            </table>
          ) : <WeekChart series={week} previous={prevWeek} money={money} currency={currency} />}
        </div>

        <div className="insight-card runout-card">
          <div className="insight-title"><Hourglass size={17} /><h3>Running out</h3><Link to={reorderLink} className="insight-link">Reorder list <ArrowUpRight size={14} /></Link></div>
          <RunOutList rows={soon} today={day} limit={5} compact />
        </div>
      </div>

      <div className="dash-grid three">
        <div className="insight-card">
          <div className="insight-title"><Trophy size={17} /><h3>Best sellers</h3><small>this week</small></div>
          {top.length ? <BarList rows={top} money={money} currency={currency} /> : <p className="muted">Sales will show your best sellers here.</p>}
        </div>
        <div className="insight-card">
          <div className="insight-title"><Clock size={17} /><h3>Sales by hour</h3><small>today</small></div>
          {hours.length ? <><HourChart rows={hours} money={money} currency={currency} /><div className="chart-legend"><span><i className="lg-now" /> Today</span><span><i className="lg-usual" /> A usual day</span></div></> : <p className="muted">No sales in the last two weeks yet.</p>}
        </div>
        <div className="insight-card">
          <div className="insight-title"><Wallet size={17} /><h3>How customers pay</h3><small>this week</small></div>
          {mix.some(r => r.amount) ? <Donut rows={mix} money={money} currency={currency} /> : <p className="muted">No payments recorded yet.</p>}
        </div>
      </div>
    </section>
  );
}
