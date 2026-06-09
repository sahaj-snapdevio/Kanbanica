"use client";

import { TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  type AccountDeletionBlocker,
  checkAccountDeletionEligibility,
  requestAccountDeletion,
} from "@/app/actions/profile";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

interface ProfileDeleteAccountCardProps {
  userEmail: string;
}

export function ProfileDeleteAccountCard({
  userEmail,
}: ProfileDeleteAccountCardProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [isPending, startTransition] = useTransition();

  // SWR drives eligibility loading — calling setState inside a useEffect
  // here would trip `react-hooks/set-state-in-effect`.
  const { data: eligibility } = useSWR(
    "account-deletion-eligibility",
    async () => await checkAccountDeletionEligibility()
  );
  const blockers: AccountDeletionBlocker[] | null =
    eligibility && !("error" in eligibility)
      ? eligibility.blockers
      : eligibility === undefined
        ? null
        : [];

  function handleDelete() {
    startTransition(async () => {
      const res = await requestAccountDeletion(confirm);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Account deleted. Signing you out…");
      // Hard nav so all client state and the (now-invalid) session cookie
      // are dropped together.
      window.location.href = "/login";
      router.refresh();
    });
  }

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <WarningIcon className="size-5" />
          Delete account
        </CardTitle>
        <CardDescription>
          Permanently delete your Krova account, all your sessions, and any SSH
          keys you&apos;ve registered. You cannot undo this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {blockers === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Checking eligibility…
          </p>
        ) : blockers.length > 0 ? (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              You can&apos;t delete your account yet:
            </p>
            <ul className="space-y-1.5">
              {blockers.map((b, i) => (
                <li
                  className="flex items-start gap-2 text-foreground"
                  key={b.spaceId ?? `${i}-${b.reason}`}
                >
                  <span className="mt-1 text-destructive">•</span>
                  <span>{b.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            You don&apos;t own any spaces, so your account can be deleted.
          </p>
        )}

        <Button
          disabled={blockers === null || blockers.length > 0}
          onClick={() => {
            setConfirm("");
            setDialogOpen(true);
          }}
          size="sm"
          variant="destructive"
        >
          <TrashIcon className="size-4" />
          Delete my account
        </Button>
      </CardContent>

      <ConfirmDestructiveDialog
        busy={isPending}
        caseInsensitive
        confirmLabel="Delete my account"
        confirmText={userEmail}
        confirmValue={confirm}
        description={
          <>
            <p>
              This permanently removes your user record, every session, every
              account-link (Google etc.), and every team-space membership.
            </p>
            <p>
              Spaces you own are blocked above and must be transferred or
              deleted first. Audit log entries authored by you are kept on the
              system (the rows reference an email string, not a user row, so
              they survive the cascade for forensics).
            </p>
            <p>
              Type <strong className="text-foreground">{userEmail}</strong> to
              confirm.
            </p>
          </>
        }
        onConfirm={handleDelete}
        onConfirmValueChange={setConfirm}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setConfirm("");
          }
        }}
        open={dialogOpen}
        title="Delete your account?"
      />
    </Card>
  );
}
