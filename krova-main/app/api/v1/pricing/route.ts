import { getCreditRates, getCreditRateTiers } from "@/lib/cost";

export async function GET() {
  const rates = getCreditRates();
  const tiers = getCreditRateTiers();

  return Response.json({
    currency: "USD",
    rates: {
      vcpuPerHour: rates.vcpuRate,
      ramGbPerHour: rates.ramRate,
      diskGbPerHour: rates.diskRate,
    },
    tiers: tiers.map((t) => ({
      minVcpus: t.minVcpus,
      maxVcpus: t.maxVcpus,
      multiplier: t.multiplier,
      label: t.label,
    })),
    note: "Tier multiplier is applied to all rates. Running Cubes pay vCPU + RAM + disk per hour; sleeping Cubes pay only diskGbPerHour × diskLimitGb × tierMultiplier per hour (vCPU + RAM are not charged while sleeping). Every allocated GB of RAM and disk is billed — Krova sells 1:1 with host resources and does not oversell RAM or disk.",
  });
}
