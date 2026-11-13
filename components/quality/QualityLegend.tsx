import type { KritikLibrary } from "@arkaik/schema";
import { gradeBands } from "@/lib/utils/quality";

/**
 * What the matrix's colours and marks mean.
 *
 * It earns its place on one line: a grade a letter worse than its own number is
 * unexplainable without it. The grade bands are one connected tinted strip —
 * the tiles' own tones, in the grade track's order — so the key reads as a
 * piece of the matrix rather than a footnote under it; the cap is said once.
 *
 * No severity key. It explained the cards' finding dots, and nothing on this
 * page draws dots any more: the heatmap and worst-first tiles carry a score, a
 * grade and a movement, and the Overall gauges a grade track. A key to marks
 * the reader cannot find is the opposite of honest data.
 */
export function QualityLegend({ library }: { library?: KritikLibrary }) {
  const bands = gradeBands(library);

  return (
    <aside className="kq-scope kq-legend" aria-label="How to read the matrix">
      <span className="kq-legend-strip">
        {bands.map((band, index) => (
          <span key={band.grade} className="kq-legend-band" data-kq-grade={band.grade}>
            <b>{band.grade}</b> {band.min === 0 && index > 0 ? `below ${bands[index - 1].min}` : `${band.min}+`}
          </span>
        ))}
      </span>
      <span className="kq-legend-note">
        <b>*</b> an open Critical or High capped the grade below its score&apos;s band
      </span>
    </aside>
  );
}
