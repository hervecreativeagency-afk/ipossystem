import React from 'react';

const pct = v => `${v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(1)}%`;

/** Accounting-style statement: label | this period | comparison | change. rows come from statements.compare(). */
export function StatementTable({ rows, fmt, current, previous }) {
  const showPrev = rows.some(r => r.prev !== undefined);
  const cell = (v, kind) => v === undefined ? '' : v === null ? <span className="not-recorded">Not recorded</span> : kind === 'percent' ? pct(v) : fmt(v);
  return (
    <div className="table-scroll">
      <table className="statement-table">
        <thead>
          <tr><th scope="col"><span className="sr-only">Line</span></th><th scope="col" className="num">{current}</th>{showPrev && <><th scope="col" className="num">{previous}</th><th scope="col" className="num">Change</th></>}</tr>
        </thead>
        <tbody>
          {rows.map(r => r.kind === 'header' ? (
            <tr key={r.key} className="st-header"><th scope="rowgroup" colSpan={showPrev ? 4 : 2}>{r.label}</th></tr>
          ) : (
            <tr key={r.key} className={'st-' + r.kind + (r.indent ? ' st-indent' : '')}>
              <th scope="row">{r.label}</th>
              <td className={'num' + (typeof r.value === 'number' && r.value < 0 ? ' neg' : '')}>{cell(r.value, r.kind)}</td>
              {showPrev && <>
                <td className={'num muted-num' + (typeof r.prev === 'number' && r.prev < 0 ? ' neg' : '')}>{cell(r.prev, r.kind)}</td>
                <td className={'num change' + (r.change > 0 ? ' up' : r.change < 0 ? ' down' : '')}>{r.change == null ? '' : `${r.change > 0 ? '▲' : r.change < 0 ? '▼' : ''} ${Math.abs(r.change * 100).toFixed(0)}%`}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
