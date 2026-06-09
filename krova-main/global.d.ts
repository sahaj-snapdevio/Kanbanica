declare module "*.css";

declare module "analytics" {
  export interface AnalyticsInstance {
    identify: (
      userId: string,
      traits?: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    on: (event: string, listener: (payload: unknown) => void) => () => void;
    once: (event: string, listener: (payload: unknown) => void) => () => void;
    page: (
      payload?: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    reset: () => Promise<unknown>;
    storage: {
      getItem: (key: string) => unknown;
      setItem: (key: string, value: unknown) => void;
      removeItem: (key: string) => void;
    };
    track: (
      event: string,
      payload?: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    user: (key?: string) => unknown;
  }

  export interface AnalyticsConfig {
    app: string;
    debug?: boolean;
    plugins?: unknown[];
    version?: string;
  }

  export default function Analytics(config: AnalyticsConfig): AnalyticsInstance;
}

declare module "@analytics/google-tag-manager" {
  interface GoogleTagManagerConfig {
    auth?: string;
    containerId: string;
    customScriptSrc?: string;
    dataLayerName?: string;
    execution?: string;
    preview?: string;
  }
  export default function googleTagManager(
    config: GoogleTagManagerConfig
  ): unknown;
}

declare module "use-analytics" {
  import type { AnalyticsInstance } from "analytics";
  import type { ReactNode } from "react";
  export const AnalyticsProvider: (props: {
    instance: AnalyticsInstance;
    children?: ReactNode;
  }) => JSX.Element;
  export function useAnalytics(): AnalyticsInstance;
  export function useTrack(): AnalyticsInstance["track"];
  export function usePage(): AnalyticsInstance["page"];
  export function useIdentify(): AnalyticsInstance["identify"];
}
