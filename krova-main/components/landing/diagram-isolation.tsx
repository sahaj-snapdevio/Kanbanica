import type { CSSProperties } from "react";

/**
 * Isolation diagram — the Krova "a kernel per Cube" stack on the left vs the
 * shared-kernel container model on the right. Directly answers the recurring
 * "do you share a kernel like containers?" question: Krova never does. Bars
 * stagger in on scroll (CSS `.krova-node` + `--node-delay`, triggered by an
 * enclosing `<Reveal>`). Honest, standard VM-vs-container kernel comparison.
 */
export function DiagramIsolation() {
  const node = (delayMs: number): CSSProperties =>
    ({ "--node-delay": `${delayMs}ms` }) as CSSProperties;

  const leftBars = [
    { y: 84, label: "Your app + data", tone: "card" as const },
    { y: 138, label: "Guest userspace · your root", tone: "card" as const },
    { y: 192, label: "Own kernel · Linux 6.1", tone: "accent" as const },
    { y: 246, label: "KVM + jailer sandbox", tone: "card" as const },
    { y: 300, label: "Bare-metal host", tone: "muted" as const },
  ];

  return (
    <svg
      aria-label="Left: a single Cube with its own kernel stacked over a jailer sandbox and the host. Right: three containers sharing one host kernel, where one kernel bug exposes every tenant."
      className="h-auto w-full"
      fill="none"
      role="img"
      viewBox="0 0 580 392"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        className="fill-primary"
        fontSize="11"
        fontWeight="600"
        x="30"
        y="48"
      >
        KROVA — A KERNEL PER CUBE
      </text>
      <text
        className="fill-muted-foreground"
        fontSize="11"
        fontWeight="600"
        x="322"
        y="48"
      >
        CONTAINERS — ONE SHARED KERNEL
      </text>

      {/* Divider */}
      <line
        className="stroke-border"
        strokeDasharray="2 5"
        x1="300"
        x2="300"
        y1="64"
        y2="356"
      />

      {/* LEFT — Krova stack */}
      {leftBars.map((bar, i) => {
        const accent = bar.tone === "accent";
        const fill =
          bar.tone === "accent"
            ? "fill-primary/10"
            : bar.tone === "muted"
              ? "fill-muted"
              : "fill-card";
        const stroke = accent ? "stroke-primary" : "stroke-border";
        return (
          <g className="krova-node" key={bar.label} style={node(i * 90)}>
            <rect
              className={`${fill} ${stroke}`}
              height="44"
              strokeWidth={accent ? "2" : "1.5"}
              width="232"
              x="30"
              y={bar.y}
            />
            <text
              className={accent ? "fill-primary" : "fill-foreground"}
              fontSize="11.5"
              fontWeight={accent ? "600" : "400"}
              x="44"
              y={bar.y + 27}
            >
              {bar.label}
            </text>
            {accent && (
              <text
                className="fill-primary"
                fontSize="10"
                textAnchor="end"
                x="252"
                y={bar.y + 27}
              >
                1 per Cube
              </text>
            )}
          </g>
        );
      })}

      {/* RIGHT — container model: 3 apps share one kernel */}
      {[330, 404, 478].map((x, i) => (
        <g className="krova-node" key={`app-${x}`} style={node(120 + i * 80)}>
          <rect
            className="fill-card stroke-border"
            height="44"
            strokeWidth="1.5"
            width="64"
            x={x}
            y="92"
          />
          <text
            className="fill-foreground"
            fontSize="10.5"
            textAnchor="middle"
            x={x + 32}
            y="119"
          >
            app {i + 1}
          </text>
          {/* link down into the shared kernel */}
          <line
            className="stroke-border"
            strokeDasharray="2 4"
            x1={x + 32}
            x2={x + 32}
            y1="136"
            y2="170"
          />
        </g>
      ))}

      <g className="krova-node" style={node(360)}>
        <rect
          className="fill-destructive/10 stroke-destructive"
          height="44"
          strokeWidth="1.5"
          width="218"
          x="330"
          y="170"
        />
        <text
          className="fill-destructive"
          fontSize="11.5"
          fontWeight="600"
          textAnchor="middle"
          x="439"
          y="197"
        >
          one shared host kernel
        </text>
      </g>

      <g className="krova-node" style={node(440)}>
        <rect
          className="fill-muted stroke-border"
          height="40"
          strokeWidth="1.5"
          width="218"
          x="330"
          y="226"
        />
        <text
          className="fill-muted-foreground"
          fontSize="11"
          textAnchor="middle"
          x="439"
          y="251"
        >
          bare-metal host
        </text>
      </g>

      <text className="fill-destructive" fontSize="10.5" x="330" y="300">
        1 kernel bug → every tenant exposed
      </text>
      <text className="fill-primary" fontSize="10.5" x="30" y="362">
        Escape lands in an unprivileged sandbox — never host root.
      </text>
    </svg>
  );
}
