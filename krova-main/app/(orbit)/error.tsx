"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  isDeploymentSkewError,
  recoverFromDeploymentSkew,
} from "@/lib/deployment-skew";

export default function OrbitError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // A Server Action / chunk reference from a previous deploy lands here — reload
  // onto the current build (loop-guarded) instead of showing the error screen.
  useEffect(() => {
    if (isDeploymentSkewError(error)) {
      recoverFromDeploymentSkew();
    }
  }, [error]);

  console.error("Error in orbit page:", error);
  return (
    <div className="flex min-h-100 flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground">
        An error occurred in the admin panel.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
