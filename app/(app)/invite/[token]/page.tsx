"use client";

import {
  CheckCircleIcon,
  SpinnerGapIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { acceptInvite } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = React.useState("");
  const [workspaceId, setWorkspaceId] = React.useState("");
  const [token, setToken] = React.useState("");

  React.useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  async function handleAccept() {
    if (!token) {
      return;
    }
    setStatus("loading");
    const res = await acceptInvite(token);
    if ("error" in res) {
      setStatus("error");
      setErrorMsg(res.error);
    } else {
      setWorkspaceId(res.workspaceId);
      setStatus("success");
    }
  }

  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="bg-background rounded-xl border shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <CheckCircleIcon
            className="size-12 text-green-500 mx-auto"
            weight="fill"
          />
          <h1 className="text-lg font-semibold">You&rsquo;re in!</h1>
          <p className="text-sm text-muted-foreground">
            You&rsquo;ve successfully joined the workspace.
          </p>
          <Button
            className="w-full"
            onClick={() => router.push(`/${workspaceId}`)}
          >
            Go to workspace
          </Button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <div className="bg-background rounded-xl border shadow-sm p-8 max-w-sm w-full text-center space-y-4">
          <XCircleIcon
            className="size-12 text-destructive mx-auto"
            weight="fill"
          />
          <h1 className="text-lg font-semibold">Invitation invalid</h1>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
          <Button
            className="w-full"
            onClick={() => router.push("/")}
            variant="outline"
          >
            Go home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="bg-background rounded-xl border shadow-sm p-8 max-w-sm w-full text-center space-y-4">
        <h1 className="text-lg font-semibold">Workspace invitation</h1>
        <p className="text-sm text-muted-foreground">
          You&rsquo;ve been invited to join a workspace. Click below to accept.
        </p>
        <Button
          className="w-full"
          disabled={status === "loading" || !token}
          onClick={handleAccept}
        >
          {status === "loading" ? (
            <span className="flex items-center gap-2">
              <SpinnerGapIcon className="size-4 animate-spin" />
              Accepting…
            </span>
          ) : (
            "Accept invitation"
          )}
        </Button>
      </div>
    </div>
  );
}
