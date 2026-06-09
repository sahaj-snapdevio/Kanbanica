import type { CSSProperties } from "react";
import { Fragment } from "react";

/**
 * "Provision programmatically" diagram — one API request creates one Cube; loop
 * it to stand up as many as you need (no batch magic, no artificial cap). The
 * grid of Cubes cascades in on scroll (CSS `.krova-node` + `--node-delay` via
 * an enclosing `<Reveal>`), conveying "create as many as you want".
 */
export function DiagramFleet() {
  const node = (delayMs: number): CSSProperties =>
    ({ "--node-delay": `${delayMs}ms` }) as CSSProperties;

  const cols = [262, 312, 362, 412, 462];
  const rows = [78, 128, 178];

  return (
    <svg
      aria-label="An API request to create a Cube, repeated in a loop, producing a grid of many isolated Cubes."
      className="h-auto w-full"
      fill="none"
      role="img"
      viewBox="0 0 580 260"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        className="fill-primary"
        fontSize="11"
        fontWeight="600"
        x="24"
        y="40"
      >
        PROVISION PROGRAMMATICALLY
      </text>

      {/* Request node */}
      <rect
        className="fill-card stroke-border"
        height="120"
        strokeWidth="1.5"
        width="186"
        x="24"
        y="62"
      />
      <rect className="fill-muted" height="26" width="186" x="24" y="62" />
      <text className="fill-foreground" fontSize="11" x="36" y="80">
        POST /v1/cubes
      </text>
      {[112, 134, 156].map((y, i) => (
        <g className="krova-node" key={`req-${y}`} style={node(i * 120)}>
          <circle className="fill-primary" cx="40" cy={y - 4} r="3" />
          <text className="fill-muted-foreground" fontSize="10.5" x="54" y={y}>
            201 created · cube_{i + 1}
          </text>
        </g>
      ))}
      <text className="fill-primary" fontSize="10" x="36" y="176">
        × as many as you need
      </text>

      {/* Arrow into the grid */}
      <line
        className="stroke-border"
        strokeWidth="1.5"
        x1="210"
        x2="250"
        y1="122"
        y2="122"
      />
      <path className="fill-muted-foreground" d="M250 122 l-7 -4 v8 z" />

      {/* Cube grid — cascades in on scroll */}
      {rows.map((y, r) =>
        cols.map((x, c) => {
          const i = r * cols.length + c;
          return (
            <Fragment key={`cube-${x}-${y}`}>
              <g className="krova-node" style={node(i * 55)}>
                <rect
                  className="fill-primary/10 stroke-primary"
                  height="34"
                  strokeWidth="1.5"
                  width="34"
                  x={x}
                  y={y}
                />
                <rect
                  className="fill-primary"
                  height="3"
                  width="14"
                  x={x + 6}
                  y={y + 8}
                />
                <rect
                  className="fill-primary/40"
                  height="3"
                  width="20"
                  x={x + 6}
                  y={y + 16}
                />
                <rect
                  className="fill-primary/40"
                  height="3"
                  width="16"
                  x={x + 6}
                  y={y + 24}
                />
              </g>
            </Fragment>
          );
        })
      )}

      <text className="fill-muted-foreground" fontSize="10.5" x="262" y="234">
        one request → one Cube · loop it · no cap
      </text>
    </svg>
  );
}
