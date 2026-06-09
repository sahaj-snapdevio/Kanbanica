import type { CSSProperties } from "react";

/**
 * Hero isolation graphic — concentric security boundaries that draw themselves
 * in on scroll, with the customer's Cube (own kernel + live terminal) floating
 * at the center. Static SVG (server-safe); the draw/float/blink animations are
 * pure CSS from app/globals.css and require an enclosing `<Reveal>` to add
 * `.is-revealed`. Honors brand: sharp corners, single teal accent, mono labels.
 */
export function HeroIsolation() {
  const draw = (length: number, delayMs: number): CSSProperties =>
    ({
      "--draw": String(length),
      "--draw-delay": `${delayMs}ms`,
    }) as CSSProperties;

  return (
    <svg
      aria-label="A Cube nested inside four security boundaries: the bare-metal host, the KVM hardware boundary, the per-cube jailer sandbox, and the Cube itself with its own kernel."
      className="h-auto w-full"
      fill="none"
      role="img"
      viewBox="0 0 460 444"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Bare-metal host — static dashed anchor frame */}
      <rect
        className="stroke-border"
        height="360"
        strokeDasharray="2 5"
        strokeWidth="1.5"
        width="432"
        x="14"
        y="50"
      />
      <text className="fill-muted-foreground" fontSize="10.5" x="24" y="40">
        BARE-METAL HOST
      </text>

      {/* Everything inside floats together within the host frame */}
      <g className="krova-float">
        {/* KVM hardware boundary */}
        <rect
          className="krova-draw stroke-border"
          height="280"
          strokeWidth="1.5"
          style={draw(1280, 0)}
          width="356"
          x="52"
          y="90"
        />
        <text className="fill-muted-foreground" fontSize="10.5" x="62" y="110">
          KVM HARDWARE BOUNDARY
        </text>

        {/* Jailer sandbox */}
        <rect
          className="krova-draw stroke-border"
          height="200"
          strokeWidth="1.5"
          style={draw(980, 160)}
          width="280"
          x="90"
          y="130"
        />
        <text className="fill-muted-foreground" fontSize="10.5" x="100" y="150">
          JAILER · uid · chroot · pid-ns
        </text>

        {/* The Cube itself */}
        <rect
          className="fill-primary/5"
          height="120"
          width="204"
          x="128"
          y="170"
        />
        <rect
          className="krova-draw stroke-primary"
          height="120"
          strokeWidth="2"
          style={draw(680, 320)}
          width="204"
          x="128"
          y="170"
        />
        <text
          className="fill-primary"
          fontSize="11"
          fontWeight="600"
          x="138"
          y="192"
        >
          YOUR CUBE
        </text>

        {/* Live status ping */}
        <circle className="fill-primary" cx="320" cy="186" r="3" />
        <circle
          className="krova-ping fill-primary origin-center [transform-box:fill-box]"
          cx="320"
          cy="186"
          r="3"
        />

        {/* Mini terminal inside the Cube */}
        <text className="fill-muted-foreground" fontSize="10" x="138" y="226">
          ubuntu 24.04 · own kernel
        </text>
        <text className="fill-foreground" fontSize="11" x="138" y="250">
          root@cube:~#
        </text>
        <rect
          className="krova-blink fill-primary"
          height="12"
          width="8"
          x="222"
          y="240"
        />
        <text className="fill-muted-foreground" fontSize="10" x="138" y="276">
          full root · per-hour billing
        </text>
      </g>

      {/* No-public-IP tag */}
      <rect
        className="fill-primary/10 stroke-primary"
        height="22"
        strokeWidth="1.5"
        width="150"
        x="155"
        y="412"
      />
      <text
        className="fill-primary"
        fontSize="10.5"
        fontWeight="600"
        textAnchor="middle"
        x="230"
        y="427"
      >
        NO PUBLIC IP
      </text>
    </svg>
  );
}
