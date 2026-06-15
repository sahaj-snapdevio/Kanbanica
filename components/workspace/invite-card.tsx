"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { acceptInvite, declineInvite } from "@/server/workspace";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

interface InviteCardProps {
  token: string;
  workspaceName: string;
}

export function InviteCard({ token, workspaceName }: InviteCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptInvite(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Welcome to ${workspaceName}!`);
      router.push(`/${result.workspaceId}`);
    });
  }

  function handleDecline() {
    startTransition(async () => {
      await declineInvite(token);
      router.push("/dashboard");
    });
  }

  return (
    <Card>
      <CardContent className="py-8 text-center space-y-5">
        <div className="space-y-1">
          <h1 className="font-semibold text-lg">Join {workspaceName}?</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ve been invited to collaborate in this workspace.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button variant="outline" disabled={pending} onClick={handleDecline}>
            Decline
          </Button>
          <Button disabled={pending} onClick={handleAccept} className="gap-2">
            {pending && <Spinner className="size-4" />}
            Accept invite
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
