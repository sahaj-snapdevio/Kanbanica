/**
 * Shared pricing math for the marketing pages (Home + /pricing).
 *
 * Pure + config-driven (no DB) so it can be imported by any server component.
 * Savings are computed from the live Krova rates so the "up to N% less"
 * headline can never drift from the real numbers. Verified competitor prices
 * researched 2026-05-31 (every competitor assigns each instance a public IPv4).
 */
import {
  CREDIT_RATE_TIERS,
  DISK_RATE,
  RAM_RATE,
  VCPU_RATE,
} from "@/config/platform";
import { calculateHourlyCost, getTierMultiplier } from "@/lib/cost-shared";

export const PRICING_RATES = {
  vcpuRate: VCPU_RATE,
  ramRate: RAM_RATE,
  diskRate: DISK_RATE,
};

export const PRICING_TIERS = CREDIT_RATE_TIERS.map((t, i) => ({
  id: `t-${i}`,
  minVcpus: t.minVcpus,
  maxVcpus: t.maxVcpus,
  multiplier: t.multiplier,
  label: t.label,
  sortOrder: i,
}));

export function priceMonthly(
  vcpus: number,
  ramGb: number,
  diskGb: number
): number {
  return (
    calculateHourlyCost(
      { vcpus, ramMb: ramGb * 1024, diskLimitGb: diskGb },
      PRICING_RATES,
      getTierMultiplier(vcpus, PRICING_TIERS)
    ) * 730
  );
}

export const SIZING_CATALOG: {
  vcpus: number;
  ramGb: number;
  diskGb: number;
  label: string;
}[] = [
  { vcpus: 1, ramGb: 1, diskGb: 10, label: "Sandbox" },
  { vcpus: 1, ramGb: 2, diskGb: 20, label: "Micro" },
  { vcpus: 2, ramGb: 2, diskGb: 20, label: "Small" },
  { vcpus: 2, ramGb: 4, diskGb: 40, label: "Popular" },
  { vcpus: 3, ramGb: 6, diskGb: 60, label: "Mid" },
  { vcpus: 4, ramGb: 8, diskGb: 80, label: "Large" },
  { vcpus: 6, ramGb: 12, diskGb: 100, label: "XL" },
  { vcpus: 8, ramGb: 16, diskGb: 100, label: "XXL" },
  { vcpus: 12, ramGb: 24, diskGb: 100, label: "Enterprise" },
  { vcpus: 16, ramGb: 32, diskGb: 100, label: "Max" },
];

/**
 * `competitor` is the representative DO / Vultr / Linode monthly price for the
 * RAM tier; `lightsail` is AWS Lightsail's. Both verified current 2026-05-31.
 */
export const PRICING_PRESETS: {
  vcpus: number;
  ramGb: number;
  diskGb: number;
  lightsail: number;
  competitor: number;
}[] = [
  { vcpus: 2, ramGb: 4, diskGb: 80, lightsail: 24, competitor: 24 },
  { vcpus: 4, ramGb: 8, diskGb: 100, lightsail: 44, competitor: 48 },
  { vcpus: 8, ramGb: 16, diskGb: 100, lightsail: 84, competitor: 96 },
  { vcpus: 16, ramGb: 32, diskGb: 100, lightsail: 164, competitor: 192 },
];

export const PRESET_SAVINGS = PRICING_PRESETS.map((p) =>
  Math.round(
    ((p.competitor - priceMonthly(p.vcpus, p.ramGb, p.diskGb)) / p.competitor) *
      100
  )
);

export const MAX_SAVINGS = Math.max(...PRESET_SAVINGS);

export const EXAMPLE_HOURLY = calculateHourlyCost(
  { vcpus: 1, ramMb: 2048, diskLimitGb: 20 },
  PRICING_RATES,
  1.0
);
export const EXAMPLE_MONTHLY = EXAMPLE_HOURLY * 730;

/** Named-provider comparison — every value verified (8 GB tier prices, public-IP, sizing, billing). */
export const NAMED_PROVIDERS = [
  "Krova",
  "AWS Lightsail",
  "DigitalOcean",
  "Vultr",
  "Linode",
];

export const NAMED_COMPARE: { label: string; values: string[] }[] = [
  {
    label: "Per-instance public IP",
    values: [
      "None",
      "Public IPv4",
      "Public IPv4",
      "Public IPv4",
      "Public IPv4",
    ],
  },
  {
    label: "Sizing",
    values: [
      "Any vCPU/RAM/disk",
      "Fixed plans",
      "Fixed plans",
      "Fixed plans",
      "Fixed plans",
    ],
  },
  {
    label: "Hardened per-cube sandbox",
    values: ["Jailer + own kernel", "—", "—", "—", "—"],
  },
  {
    label: "Billing",
    values: [
      "By the minute",
      "Hourly, monthly cap",
      "Per-second",
      "Hourly, monthly cap",
      "Hourly, monthly cap",
    ],
  },
  {
    label: "8 GB RAM / month",
    values: ["$20", "$44", "$48", "$40", "$48"],
  },
];
