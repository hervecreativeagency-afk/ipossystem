import React, { useMemo, useState } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';
import en from 'i18n-iso-countries/langs/en.json';
import world from 'world-atlas/countries-110m.json';
import { flag } from './utils';

countries.registerLocale(en);
const W = 960, H = 470;
const shapes = feature(world, world.objects.countries).features.filter(f => f.id !== '010');   // leave out Antarctica
const projection = geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'FeatureCollection', features: shapes });
const path = geoPath(projection);
export const countryName = code => countries.getName(code, 'en') || code || 'Unknown';

/** World map: countries shaded by how much they use iPOS, dots for towns (red ring = crashes there). */
export function WorldMap({ data }) {
  const [hover, setHover] = useState(null);
  const byNumeric = useMemo(() => new Map(data.countries.map(c => [countries.alpha2ToNumeric(c.code), c])), [data.countries]);
  const max = Math.max(1, ...data.countries.map(c => c.visits + c.errors));
  const maxCity = Math.max(1, ...data.cities.map(c => c.visits + c.errors));
  const shade = n => n ? `rgba(36,105,79,${0.18 + 0.72 * Math.sqrt(n / max)})` : '#e9efeb';
  return (
    <div className="map" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Where iPOS is being used">
        {shapes.map(f => {
          const c = byNumeric.get(String(f.id).padStart(3, '0'));
          return <path key={f.id || f.properties.name} d={path(f)} fill={shade(c ? c.visits + c.errors : 0)} className="land"
            onMouseEnter={() => setHover(c ? { title: `${flag(c.code)} ${countryName(c.code)}`, text: `${c.visits} visits${c.errors ? ` · ${c.errors} crashes` : ''}` } : { title: f.properties.name, text: 'No visits yet' })} />;
        })}
        {data.cities.map(c => {
          const p = projection([c.lon, c.lat]);
          if (!p) return null;
          const r = 3 + 9 * Math.sqrt((c.visits + c.errors) / maxCity);
          return (
            <g key={c.key} onMouseEnter={() => setHover({ title: `${flag(c.country)} ${c.city || 'Unknown town'}`, text: `${c.visits} visits${c.errors ? ` · ${c.errors} crashes` : ''}` })}>
              <circle cx={p[0]} cy={p[1]} r={r} className={'dot' + (c.errors ? ' has-errors' : '')} />
            </g>
          );
        })}
      </svg>
      <div className="map-tip" aria-live="polite">{hover ? <><strong>{hover.title}</strong><span>{hover.text}</span></> : <span>Point at a country or town</span>}</div>
    </div>
  );
}
