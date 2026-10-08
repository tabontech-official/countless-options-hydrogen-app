import { useState } from "react";

const percent = (value, total) => (total ? Math.round((value / total) * 100) : 0);

// A ring chart with its total in the middle. Segments run clockwise from 12 o'clock in the
// order given (keep it fixed, so each entity keeps its color), separated by a 2px gap.
// Hovering a segment or legend row puts that segment's numbers in the middle.
export function Ring({ segments, total, center, legend = true, label }) {
  const [active, setActive] = useState(null);
  const size = 176;
  const thickness = 13;
  const r = (size - thickness) / 2 - 3; // room for the hover swell
  const c = 2 * Math.PI * r;
  const shown = segments.filter((s) => s.value > 0);
  // A lone segment filling the ring has no neighbour to separate from.
  const gap = shown.length > 1 || shown.some((s) => s.value < total) ? 2 : 0;
  const round = shown.length === 1 && shown[0].value < total;

  let offset = 0;
  const arcs = shown.map((s, i) => {
    const length = (s.value / total) * c;
    const arc = { ...s, i, start: offset, length: Math.max(length - gap, 0.5) };
    offset += length;
    return arc;
  });
  const focus = active && shown.find((s) => s.key === active);
  const middle = focus
    ? { value: focus.value, of: total, caption: focus.label }
    : center;

  return (
    <div className="co-ringchart">
      <div className="co-ring" style={{ inlineSize: size, blockSize: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(20, 16, 60, 0.07)" strokeWidth={thickness} />
            {arcs.map((a) => (
              <g key={a.key}>
                <circle
                  className="co-ring__arc"
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={active === a.key ? thickness + 4 : thickness}
                  strokeLinecap={round ? "round" : "butt"}
                  strokeDasharray={`${a.length} ${c - a.length}`}
                  strokeDashoffset={-a.start}
                  opacity={active && active !== a.key ? 0.3 : 1}
                  style={{ animationDelay: `${0.15 + a.i * 0.08}s` }}
                />
                {/* Wider invisible stroke: an easier hover target than the arc itself. */}
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={thickness + 12}
                  strokeDasharray={`${a.length} ${c - a.length}`}
                  strokeDashoffset={-a.start}
                  pointerEvents="stroke"
                  onMouseEnter={() => setActive(a.key)}
                  onMouseLeave={() => setActive(null)}
                >
                  <title>{`${a.label}: ${a.value} (${percent(a.value, total)}%)`}</title>
                </circle>
              </g>
            ))}
          </g>
        </svg>
        <div className="co-ring__center" aria-live="polite">
          <span className="co-ring__value">
            {middle.value}
            {middle.of != null && <small>{`/${middle.of}`}</small>}
          </span>
          <span className="co-ring__caption">{middle.caption}</span>
        </div>
      </div>

      {legend && (
        <ul className="co-ringlegend">
          {segments.map((s) => (
            <li
              key={s.key}
              className={active === s.key ? "is-active" : undefined}
              onMouseEnter={() => s.value > 0 && setActive(s.key)}
              onMouseLeave={() => setActive(null)}
            >
              <i className="co-swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="co-ringlegend__label">{s.label}</span>
              <span className="co-ringlegend__value">{s.value}</span>
              <span className="co-ringlegend__pct">{`${percent(s.value, total)}%`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
