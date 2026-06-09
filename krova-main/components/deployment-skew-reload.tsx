"use client";

import { useEffect } from "react";

import {
  isDeploymentSkewError,
  recoverFromDeploymentSkew,
} from "@/lib/deployment-skew";

/**
 * Mounted once in the root layout. Catches version-skew errors that surface on the
 * window — stale JS/CSS chunks requested during prefetch or dynamic import, and
 * unhandled Server Action rejections that never reach a route error boundary — and
 * reloads the tab onto the current deployment. Errors that React routes to a route
 * error boundary are handled there instead. Renders nothing.
 */
export function DeploymentSkewReload() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      if (isDeploymentSkewError(event.error ?? event.message)) {
        recoverFromDeploymentSkew();
      }
    }
    function handleRejection(event: PromiseRejectionEvent) {
      if (isDeploymentSkewError(event.reason)) {
        recoverFromDeploymentSkew();
      }
    }
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
