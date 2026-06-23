"use client";

import * as React from "react";

interface TopbarState {
  breadcrumbs: Array<{ label: string; color?: string | null }>;
  title: string;
  actions?: React.ReactNode;
}

interface TopbarContextValue {
  state: TopbarState | null;
  setState: (s: TopbarState | null) => void;
}

const TopbarContext = React.createContext<TopbarContextValue>({
  state: null,
  setState: () => {},
});

export function TopbarProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<TopbarState | null>(null);
  return (
    <TopbarContext.Provider value={{ state, setState }}>
      {children}
    </TopbarContext.Provider>
  );
}

export function useTopbarState() {
  return React.useContext(TopbarContext).state;
}

export function useSetTopbar(config: TopbarState) {
  const { setState } = React.useContext(TopbarContext);
  // Stringify to use as stable dep — actions ReactNode excluded from comparison
  const key = JSON.stringify({ breadcrumbs: config.breadcrumbs, title: config.title });
  React.useEffect(() => {
    setState(config);
    return () => setState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
