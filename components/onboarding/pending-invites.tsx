"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EnvelopeOpenIcon } from "@phosphor-icons/react";
import { acceptInvite } from "@/server/workspace";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

interface PendingInvitesProps {
  invites: { token: string; workspaceName: string; inviterName: string }[];
}

export function PendingInvites({ invites }: PendingInvitesProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleAccept(token: string) {
    startTransition(async () => {
      const result = await acceptInvite(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.push(`/${result.workspaceId}`);
    });
  }

  return (
    <Card className="border-primary/30">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-center gap-2">
          <EnvelopeOpenIcon className="size-4 text-primary" weight="duotone" />
          <h2 className="text-sm font-semibold">You have pending invites</h2>
        </div>
        <ul className="space-y-2">
          {invites.map((invite) => (
            <li key={invite.token} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{invite.workspaceName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  Invited by {invite.inviterName}
                </p>
              </div>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => handleAccept(invite.token)}
                className="gap-1.5"
              >
                {pending && <Spinner className="size-3.5" />}
                Accept
              </Button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          …or create your own workspace below.
        </p>
      </CardContent>
    </Card>
  );
}
