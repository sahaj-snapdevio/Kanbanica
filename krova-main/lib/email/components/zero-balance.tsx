import { Button, Section, Text } from "react-email";
import { EmailLayout, emailStyles } from "@/lib/email/components/layout";

export interface ZeroBalanceEmailProps {
  /** Free plans get the "Choose a Plan" CTA; paid plans get "Add Credits". */
  isFreePlan: boolean;
  logoUrl?: string | null;
  pausedCubeCount: number;
  productName?: string;
  spaceName: string;
  spaceUrl: string;
  userName: string;
}

export function ZeroBalanceEmail({
  userName,
  spaceName,
  pausedCubeCount,
  spaceUrl,
  isFreePlan,
  productName = "Krova",
  logoUrl,
}: ZeroBalanceEmailProps) {
  const cubeWord = pausedCubeCount === 1 ? "Cube" : "Cubes";
  const ctaLabel = isFreePlan ? "Choose a Plan" : "Add Credits";
  const ctaHref = isFreePlan
    ? `${spaceUrl}?plan=open`
    : `${spaceUrl}?topup=open`;
  // No running cubes means this fired from the backup-storage or sleep-
  // storage zero-balance path — the wording shifts from "Cubes paused"
  // (compute-style) to "Balance exhausted" (storage-style) so a customer
  // with only sleeping cubes / backups isn't told 0 Cubes were paused.
  const hasPausedCubes = pausedCubeCount > 0;

  return (
    <EmailLayout
      logoUrl={logoUrl}
      preview={
        hasPausedCubes
          ? `${pausedCubeCount} ${cubeWord} paused — ${spaceName} balance is $0`
          : `${spaceName} credit balance reached $0`
      }
      productName={productName}
    >
      <Section
        style={{
          ...emailStyles.card,
          borderLeft: "3px solid #dc2626",
          margin: "0 0 24px 0",
        }}
      >
        <Text
          style={{
            ...emailStyles.badge,
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            margin: "0 0 4px 0",
          }}
        >
          {hasPausedCubes ? "Cubes Paused" : "Balance Exhausted"}
        </Text>
      </Section>

      <Text style={emailStyles.heading}>Hi {userName},</Text>

      <Text style={emailStyles.paragraph}>
        The credit balance for{" "}
        <strong style={{ color: "#252525" }}>{spaceName}</strong> has reached
        $0.{" "}
        {hasPausedCubes ? (
          <>
            {pausedCubeCount} {cubeWord}{" "}
            {pausedCubeCount === 1 ? "has" : "have"} been automatically put to
            sleep.
          </>
        ) : (
          <>
            No Cubes were running, but storage charges (sleep storage and/or
            backups) continue to accrue against the now-empty balance.
          </>
        )}
      </Text>

      <Section style={emailStyles.card}>
        <div style={emailStyles.cardRow}>
          <Text style={emailStyles.cardLabel}>Workspace</Text>
          <Text style={emailStyles.cardValue}>{spaceName}</Text>
        </div>
        {hasPausedCubes && (
          <div style={emailStyles.cardRow}>
            <Text style={emailStyles.cardLabel}>Sleeping Cubes</Text>
            <Text style={{ ...emailStyles.cardValue, color: "#dc2626" }}>
              {pausedCubeCount}
            </Text>
          </div>
        )}
        <div style={emailStyles.cardRowLast}>
          <Text style={emailStyles.cardLabel}>Balance</Text>
          <Text style={{ ...emailStyles.cardValue, color: "#dc2626" }}>
            $0.00
          </Text>
        </div>
      </Section>

      <Text style={emailStyles.paragraph}>
        {hasPausedCubes
          ? `Your ${cubeWord} will resume automatically once credits are added to your workspace.`
          : "Add credits to clear the unfunded charges and keep your storage intact."}
      </Text>

      <Section style={{ margin: "24px 0" }}>
        <Button href={ctaHref} style={emailStyles.button}>
          {ctaLabel}
        </Button>
      </Section>
    </EmailLayout>
  );
}
