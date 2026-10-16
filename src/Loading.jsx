import React from 'react';

// Placeholder shapes shown while a page loads, so the layout doesn't jump when data arrives.
// kind: 'table' (rows), 'cards' (product grid), 'dashboard' (stat cards + table), 'list' (a few lines)
const widths = ['62%', '48%', '71%', '55%', '66%', '44%', '58%', '69%'];

export function Skeleton({ label = 'Loading…', kind = 'table', rows = 6 }) {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-busy="true">
      {kind === 'dashboard' && (
        <div className="skeleton-stats">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton-card"><i style={{ width: '45%' }} /><b /><i style={{ width: '70%' }} /></div>)}</div>
      )}
      {kind === 'cards' ? (
        <div className="skeleton-grid">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton-tile"><span className="skeleton-img" /><i style={{ width: widths[i % 8] }} /><i style={{ width: '35%' }} /></div>)}</div>
      ) : kind === 'list' ? (
        <div className="skeleton-list">{Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: widths[i % 8] }} />)}</div>
      ) : (
        <div className="skeleton-table">
          <div className="skeleton-row head">{[18, 26, 14, 16].map((w, i) => <i key={i} style={{ width: w + '%' }} />)}</div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="skeleton-row">
              <span className="skeleton-dot" />
              <i style={{ width: 14 + (r * 7) % 12 + '%' }} /><i style={{ width: 22 + (r * 5) % 10 + '%' }} /><i style={{ width: '12%' }} /><i style={{ width: 9 + (r * 3) % 8 + '%' }} />
            </div>
          ))}
        </div>
      )}
      <p className="skeleton-label">{label}</p>
    </div>
  );
}
