"use client";

import { useEffect } from "react";

import {
  isDeploymentSkewError,
  recoverFromDeploymentSkew,
} from "@/lib/deployment-skew";

// Root-level error boundary. This replaces the entire app (including the root
// layout), so it renders its own <html>/<body> and uses inline styles — the
// app's stylesheet may not have loaded if the failure happened early.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A Server Action / chunk reference from a previous deploy lands here — reload
  // onto the current build (loop-guarded) instead of showing the fatal screen.
  useEffect(() => {
    if (isDeploymentSkewError(error)) {
      recoverFromDeploymentSkew();
    }
  }, [error]);

  console.error("Fatal application error:", error);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: "1rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#a1a1a1", margin: 0 }}>
          A fatal error occurred. Try again, or reload the page.
        </p>
        <button
          onClick={reset}
          style={{
            border: "none",
            background: "#fafafa",
            color: "#0a0a0a",
            fontSize: "0.875rem",
            fontWeight: 500,
            padding: "0.5rem 1rem",
            cursor: "pointer",
          }}
          type="button"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
