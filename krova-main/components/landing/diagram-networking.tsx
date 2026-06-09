import type { CSSProperties } from "react";

/**
 * Networking diagram — how traffic reaches a Cube. Web traffic is fronted by
 * Cloudflare's edge (TLS, hidden origin, L3/4/7 DDoS); the Cube itself carries
 * no public IP. Connectors animate a packet "flow" on scroll (CSS `.krova-flow`
 * via an enclosing `<Reveal>`). The honest raw-TCP nuance (SSH/TCP reach the
 * hardened host directly) is carried in the page caption, not overclaimed here.
 */
export function DiagramNetworking() {
  const flow = (delayMs: number): CSSProperties =>
    ({ "--flow-delay": `${delayMs}ms` }) as CSSProperties;

  return (
    <svg
      aria-label="Visitors reach the Cloudflare edge, which provides TLS and DDoS protection and hides the origin; traffic then passes to the Krova host and finally the Cube, which has no public IP."
      className="h-auto w-full"
      fill="none"
      role="img"
      viewBox="0 0 600 270"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Internet */}
      <rect
        className="fill-card stroke-border"
        height="84"
        strokeWidth="1.5"
        width="112"
        x="16"
        y="92"
      />
      <text
        className="fill-foreground"
        fontSize="11"
        fontWeight="600"
        textAnchor="middle"
        x="72"
        y="126"
      >
        INTERNET
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="9.5"
        textAnchor="middle"
        x="72"
        y="144"
      >
        visitors
      </text>
      <text
        className="fill-destructive"
        fontSize="9.5"
        textAnchor="middle"
        x="72"
        y="160"
      >
        + DDoS attacks
      </text>

      {/* Cloudflare edge */}
      <rect
        className="fill-primary/5 stroke-primary"
        height="116"
        strokeWidth="2"
        width="168"
        x="184"
        y="76"
      />
      {/* shield */}
      <path
        className="fill-primary/15 stroke-primary"
        d="M268 90 l16 5 v12 l-16 12 l-16 -12 v-12 z"
        strokeWidth="1.5"
      />
      <path
        className="stroke-primary"
        d="M261 105 l5 5 l9 -10"
        strokeWidth="1.5"
      />
      <text
        className="fill-primary"
        fontSize="11"
        fontWeight="600"
        textAnchor="middle"
        x="268"
        y="142"
      >
        CLOUDFLARE EDGE
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="9.5"
        textAnchor="middle"
        x="268"
        y="159"
      >
        TLS · hidden origin
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="9.5"
        textAnchor="middle"
        x="268"
        y="174"
      >
        DDoS L3/4/7 · 330+ cities
      </text>

      {/* Host */}
      <rect
        className="fill-card stroke-border"
        height="84"
        strokeWidth="1.5"
        width="96"
        x="408"
        y="92"
      />
      <text
        className="fill-foreground"
        fontSize="11"
        fontWeight="600"
        textAnchor="middle"
        x="456"
        y="126"
      >
        KROVA HOST
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="9.5"
        textAnchor="middle"
        x="456"
        y="144"
      >
        DDoS-mitigated
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="9.5"
        textAnchor="middle"
        x="456"
        y="158"
      >
        default-deny fw
      </text>

      {/* Cube */}
      <rect
        className="fill-primary/10 stroke-primary"
        height="84"
        strokeWidth="2"
        width="64"
        x="520"
        y="92"
      />
      <text
        className="fill-primary"
        fontSize="11"
        fontWeight="600"
        textAnchor="middle"
        x="552"
        y="128"
      >
        CUBE
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="9"
        textAnchor="middle"
        x="552"
        y="144"
      >
        private IP
      </text>

      {/* Connectors with animated packet flow */}
      {[
        { x1: 128, x2: 184, d: 0 },
        { x1: 352, x2: 408, d: 250 },
        { x1: 504, x2: 520, d: 500 },
      ].map((c) => (
        <g key={`conn-${c.x1}`}>
          <line
            className="stroke-border"
            strokeWidth="1.5"
            x1={c.x1}
            x2={c.x2}
            y1="134"
            y2="134"
          />
          <line
            className="krova-flow stroke-primary"
            strokeWidth="2"
            style={flow(c.d)}
            x1={c.x1}
            x2={c.x2}
            y1="134"
            y2="134"
          />
          <path
            className="fill-muted-foreground"
            d={`M${c.x2} 134 l-7 -4 v8 z`}
          />
        </g>
      ))}

      {/* NO PUBLIC IP tag, centered under the Cube */}
      <rect
        className="fill-primary/10 stroke-primary"
        height="22"
        strokeWidth="1.5"
        width="92"
        x="506"
        y="192"
      />
      <text
        className="fill-primary"
        fontSize="10"
        fontWeight="600"
        textAnchor="middle"
        x="552"
        y="207"
      >
        NO PUBLIC IP
      </text>

      {/* Caption on its own line, centered clear of the tag */}
      <text
        className="fill-muted-foreground"
        fontSize="10.5"
        textAnchor="middle"
        x="300"
        y="250"
      >
        Attacks are absorbed at the edge — they never reach your server.
      </text>
    </svg>
  );
}
