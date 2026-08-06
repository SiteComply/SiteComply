/**
 * SC-014 score breakdown donut. Dependency-free inline SVG — the project has no
 * charting library, and the REV-1 mockup needs one small categorical donut, so a
 * library would be a large dependency for a single figure (same call as SC-011's
 * hand-rolled signature pad).
 *
 * Encoding notes:
 * - Categorical palette in FIXED slot order (--chart-1..6, see globals.css).
 *   Colour follows the section, never its rank, so re-ordering the weightings
 *   table never repaints a section.
 * - A 2px surface-coloured gap separates adjacent segments.
 * - Identity is never colour-alone: every segment is named in the legend with its
 *   weight and points, and the same figures appear in the weightings table.
 */

export interface DonutSlice {
  id: string;
  label: string;
  /** Share of the whole, 0–100. */
  percent: number;
  points: number;
}

const CHART_SLOTS = 6;

/** Fixed-order slot for a series index — folds past slot 6 rather than cycling hues. */
export function chartColour(index: number): string {
  return `rgb(var(--chart-${(index % CHART_SLOTS) + 1}))`;
}

export function ScoreBreakdownDonut({
  slices,
  totalPoints,
  // Sized to the SC-014 benchmark's proportion — its donut is roughly a third of
  // the Score Preview column, sitting BESIDE the legend rather than above it.
  size = 136,
  thickness = 30,
}: {
  slices: DonutSlice[];
  totalPoints: number;
  size?: number;
  thickness?: number;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const centre = size / 2;
  // 2px visual separator between neighbouring segments (marks-and-anatomy spec).
  const gap = 2;

  const total = slices.reduce((sum, s) => sum + Math.max(0, s.percent), 0);
  const usable = total > 0 ? total : 1;

  let offset = 0;
  const arcs = slices.map((slice, index) => {
    const share = Math.max(0, slice.percent) / usable;
    const length = share * circumference;
    // Mid-point of this arc as a fraction of the whole ring, for the on-segment
    // label. The benchmark prints each share ON its band, which is what lets the
    // figure be read without crossing to the legend and back.
    const midFraction = circumference > 0 ? (offset + length / 2) / circumference : 0;
    const angle = midFraction * 2 * Math.PI - Math.PI / 2;
    const arc = {
      slice,
      index,
      share,
      dash: Math.max(0, length - gap),
      rest: circumference - Math.max(0, length - gap),
      offset,
      labelX: centre + radius * Math.cos(angle),
      labelY: centre + radius * Math.sin(angle),
    };
    offset += length;
    return arc;
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`Score breakdown by section, ${totalPoints} points total`}
        className="shrink-0"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          stroke="rgb(var(--surface-sunken))"
          strokeWidth={thickness}
        />
        {arcs.map(({ slice, index, dash, rest, offset: arcOffset }) => (
          <circle
            key={slice.id}
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            stroke={chartColour(index)}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${rest}`}
            strokeDashoffset={-arcOffset}
            // Start at 12 o'clock rather than 3 o'clock.
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        ))}
        {/* On-segment shares, as the benchmark draws them. Suppressed below 6%:
            the band is thinner than the type at that point, so the label would
            sit half outside its own segment and read as the neighbour's. The
            legend still carries every share, so nothing is lost by omitting it
            here — this is decoration on top of the accessible figure, which is
            why it is aria-hidden. */}
        {arcs.map(({ slice, share, labelX, labelY }) =>
          share >= 0.06 ? (
            <text
              key={`label-${slice.id}`}
              x={labelX}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="central"
              aria-hidden="true"
              className="font-semibold"
              style={{ fontSize: 10, fill: '#fff' }}
            >
              {Math.round(slice.percent)}%
            </text>
          ) : null,
        )}
        <text
          x={centre}
          y={centre - 2}
          textAnchor="middle"
          className="fill-ink font-bold"
          style={{ fontSize: 22 }}
        >
          {totalPoints}
        </text>
        <text
          x={centre}
          y={centre + 15}
          textAnchor="middle"
          className="fill-ink-subtle"
          style={{ fontSize: 10 }}
        >
          Total Points
        </text>
      </svg>

      {/* `min-w-0` is load-bearing, not tidiness. This sits beside a `shrink-0`
          donut inside a ~380px rail; as `w-full` it demanded the container's
          full width ON TOP of the donut and, with no min-width floor, flex could
          not shrink it back — so the panel pushed the whole PAGE into horizontal
          scroll on every viewport from 1024px to 1535px. Measured: 135px of
          overflow at 1024, 29px at 1440, gone at 1536. */}
      <ul className="min-w-0 flex-1 space-y-2 text-xs">
        {slices.map((slice, index) => (
          <li key={slice.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: chartColour(index) }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-muted">
              {slice.label}{' '}
              <span className="text-ink-subtle">
                ({Math.round(slice.percent)}%)
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {slice.points} pts
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
