import type { ReactNode } from "react";

type Rail = "violet" | "teal" | "amber" | "green" | "blue" | "zinc";

const RAIL: Record<Rail, string> = {
  violet: "#8b5cf6",
  teal: "#14b8a6",
  amber: "#f59e0b",
  green: "#22c55e",
  blue: "#3b82f6",
  zinc: "#71717a",
};

const CARD_W = 108;
const CARD_H = 40;

interface CardProps { x: number; y: number; title: string; subtitle: string; rail: Rail }

/** An Arkaik node card, in SVG: card ground, border, coloured left rail, title, muted subtitle. */
function Card({ x, y, title, subtitle, rail }: CardProps) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={CARD_W} height={CARD_H} rx="8" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
      <path d={`M8 0h3v${CARD_H}h-3a8 8 0 0 1 -8 -8v-${CARD_H - 16}a8 8 0 0 1 8 -8z`} fill={RAIL[rail]} />
      <text x="18" y="17" fontSize="9.5" fontWeight="600" fill="currentColor">{title}</text>
      <text x="18" y="30" fontSize="8" fill="hsl(var(--muted-foreground))">{subtitle}</text>
    </g>
  );
}

/** A curved compose-style edge between two card anchors; horizontal by default, `vertical` bends down. */
function Edge({ from, to, vertical = false }: { from: [number, number]; to: [number, number]; vertical?: boolean }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const d = vertical
    ? `M${x1} ${y1} C${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`
    : `M${x1} ${y1} C${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`;
  return (
    <path
      d={d}
      fill="none"
      stroke="hsl(var(--muted-foreground))"
      strokeWidth="1.2"
      markerEnd="url(#mcp-arrow)"
    />
  );
}

function Figure({ viewBox, label, children }: { viewBox: string; label: string; children: ReactNode }) {
  return (
    <figure className="m-0 min-w-0">
      <svg viewBox={viewBox} className="block w-full text-foreground" role="img" aria-label={label}>
        <defs>
          <pattern id="mcp-dots" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="hsl(var(--border))" />
          </pattern>
          <marker id="mcp-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L8 4L0 8z" fill="hsl(var(--muted-foreground))" />
          </marker>
        </defs>
        <rect width="100%" height="100%" rx="6" fill="url(#mcp-dots)" />
        {children}
      </svg>
      <figcaption className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** Edge anchor points of a card at (x, y). */
const right = (x: number, y: number): [number, number] => [x + CARD_W, y + CARD_H / 2];
const left = (x: number, y: number): [number, number] => [x, y + CARD_H / 2];
const bottom = (x: number, y: number): [number, number] => [x + CARD_W / 2, y + CARD_H];
const top = (x: number, y: number): [number, number] => [x + CARD_W / 2, y];

/**
 * Two figures in the canvas's own vocabulary (spec § D2 diagram). Figure 1:
 * one schema projection, three consumers, the same result. Figure 2: the
 * write path from an agent host to the journal. Pure SVG, theme through the
 * app's CSS variables; only the rails are literal colours.
 */
export function McpDiagram() {
  // Figure 1 — audience symmetry. Projection left, consumers right.
  const P: [number, number] = [16, 64];
  const C1: [number, number] = [236, 12];
  const C2: [number, number] = [236, 64];
  const C3: [number, number] = [236, 116];
  // Figure 2 — the write path, on two rows so the cards keep figure 1's scale:
  // host → server → store, then down to the validator and back to the journal.
  const W1: [number, number] = [16, 12];
  const W2: [number, number] = [136, 12];
  const W3: [number, number] = [256, 12];
  const W4: [number, number] = [256, 76];
  const W5: [number, number] = [136, 76];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Figure viewBox="0 0 360 168" label="One projection, three readers">
        <Card x={P[0]} y={P[1]} title="@arkaik/schema" subtitle="computeDeliveryItems" rail="zinc" />
        <Card x={C1[0]} y={C1[1]} title="Delivery page" subtitle="the board" rail="blue" />
        <Card x={C2[0]} y={C2[1]} title="arkaik CLI" subtitle="arkaik log" rail="amber" />
        <Card x={C3[0]} y={C3[1]} title="MCP tool" subtitle="get_backlog" rail="teal" />
        <Edge from={right(...P)} to={left(...C1)} />
        <Edge from={right(...P)} to={left(...C2)} />
        <Edge from={right(...P)} to={left(...C3)} />
      </Figure>
      <Figure viewBox="0 0 380 128" label="The write path">
        <Card x={W1[0]} y={W1[1]} title="Agent host" subtitle="Claude Code" rail="violet" />
        <Card x={W2[0]} y={W2[1]} title="arkaik-mcp" subtitle="update_node" rail="teal" />
        <Card x={W3[0]} y={W3[1]} title="Store" subtitle="repo · hosted" rail="amber" />
        <Card x={W4[0]} y={W4[1]} title="Validator" subtitle="hard gate" rail="green" />
        <Card x={W5[0]} y={W5[1]} title="Journal" subtitle="append only" rail="blue" />
        <Edge from={right(...W1)} to={left(...W2)} />
        <Edge from={right(...W2)} to={left(...W3)} />
        <Edge from={bottom(...W3)} to={top(...W4)} vertical />
        <Edge from={left(...W4)} to={right(...W5)} />
      </Figure>
    </div>
  );
}
