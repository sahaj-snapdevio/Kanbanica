"use client";

import { useLinkStatus } from "next/link";

export function NavProgress() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`nav-progress-bar ${pending ? "nav-progress-bar--active" : ""}`}
    />
  );
}
