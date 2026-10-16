import React from 'react';
import { Link } from 'react-router-dom';
import { Hourglass, ArrowUpRight, TrendingUp, TrendingDown } from 'lucide-react';
import { runOutSentence, adviceLine } from './forecast-utils';

const TONE = { out: 'red', urgent: 'red', soon: 'amber', watch: 'green', ok: 'green' };
const label = r => r.stock <= 0 ? 'Out' : r.daysLeft < 1 ? '< 1 day' : `${Math.floor(r.daysLeft)} ${Math.floor(r.daysLeft) === 1 ? 'day' : 'days'}`;

/** "You'll run out of …" list with a bar showing days of stock left (full bar = 14 days). */
export function RunOutList({ rows, today, limit = 6, compact = false, link = true }) {
  if (!rows.length) return <p className="muted runout-empty">Nothing will run out in the next two weeks at the current pace.</p>;
  return (
    <>
      <ul className={'runout-list' + (compact ? ' compact' : '')}>
        {rows.slice(0, limit).map(r => (
          <li key={r.product_id} className={'runout-item ' + r.status}>
            <div className="runout-top">
              <span className="runout-text">{compact ? r.name : runOutSentence(r)}</span>
              <span className={'badge ' + TONE[r.status]}>{label(r)}</span>
            </div>
            <div className="runout-track" aria-hidden="true"><i style={{ width: `${Math.max(r.stock > 0 ? 3 : 0, Math.min(100, r.daysLeft / 14 * 100))}%` }} /></div>
            <small>
              {r.trend === 'faster' && <TrendingUp size={12} aria-label="Selling faster" />}{r.trend === 'slower' && <TrendingDown size={12} aria-label="Selling slower" />}
              {compact ? `${r.stock} left · ${adviceLine(r, today)}` : adviceLine(r, today)}
            </small>
          </li>
        ))}
      </ul>
      {link && rows.length > limit && <Link className="insight-link runout-more" to="/reorder">{rows.length - limit} more on the reorder list <ArrowUpRight size={14} /></Link>}
    </>
  );
}

export function RunOutPanel({ rows, today }) {
  return (
    <section className="runout-panel" aria-label="When you'll run out">
      <div className="insight-title"><Hourglass size={17} /><h3>When you'll run out</h3><small>at the speed each item sells</small></div>
      <RunOutList rows={rows} today={today} limit={8} link={false} />
    </section>
  );
}
