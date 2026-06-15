"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { joinViaInviteLink } from "@/server/workspace";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

interface JoinCardProps {
  token: string;
  workspaceName: string;
}

export function JoinCard({ token, workspaceName }: JoinCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleJoin() {
    startTransition(async () => {
      const result = await joinViaInviteLink(token);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Welcome to ${workspaceName}!`);
      router.push(`/${result.workspaceId}`);
    });
  }

  return (
    <Card>
      <CardContent className="py-8 text-center space-y-5">
        <div className="space-y-1">
          <h1 className="font-semibold text-lg">Join {workspaceName}?</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;ll join this workspace as a Member.
          </p>
        </div>
        <Button disabled={pending} onClick={handleJoin} className="gap-2">
          {pending && <Spinner className="size-4" />}
          Join workspace
        </Button>
      </CardContent>
    </Card>
  );
}
