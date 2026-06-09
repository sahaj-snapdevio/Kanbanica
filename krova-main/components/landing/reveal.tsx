"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll-reveal wrapper for the marketing homepage.
 *
 * A single small client leaf so the landing page itself stays a Server
 * Component. On mount it observes its own DOM node and, the first time the
 * node enters the viewport, adds `is-revealed` — which the CSS in
 * app/globals.css uses to settle the `.krova-reveal` fade-up AND to trigger
 * any `.krova-draw` / `.krova-node` / `.krova-flow` children inside a diagram
 * (so the SVG line-drawing is tied to scroll, not page load).
 *
 * The class is toggled directly on the DOM node (no React state in the
 * observer callback) — React-Compiler-safe and avoids
 * `react-hooks/set-state-in-effect`. `prefers-reduced-motion` reveals
 * instantly with no animation.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  threshold = 0.15,
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger, in ms — sets the CSS `--reveal-delay`. */
  delay?: number;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    // Reduced motion: show immediately, never animate.
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      el.classList.add("is-revealed");
      return;
    }

    // No IntersectionObserver (very old browser / SSR edge): reveal eagerly.
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-revealed");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      className={`krova-reveal${className ? ` ${className}` : ""}`}
      ref={ref}
      style={
        delay
          ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}
