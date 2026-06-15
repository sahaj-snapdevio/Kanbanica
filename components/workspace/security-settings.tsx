"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CopyIcon, LinkIcon, WarningIcon } from "@phosphor-icons/react";
import {
  deleteWorkspace,
  disableInviteLink,
  regenerateInviteLink,
} from "@/server/workspace";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

interface SecuritySettingsProps {
  workspaceId: string;
  workspaceName: string;
  inviteLinkToken: string | null;
  appUrl: string;
}

export function SecuritySettings({
  workspaceId,
  workspaceName,
  inviteLinkToken,
  appUrl,
}: SecuritySettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const inviteUrl = inviteLinkToken ? `${appUrl}/join/${inviteLinkToken}` : null;

  function run(action: () => Promise<{ ok?: true; error?: string } | { error: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  async function copyLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Invite link copied");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="normal-case tracking-normal text-base font-semibold">
            Invite link
          </CardTitle>
          <CardDescription>
            Anyone with this link can join the workspace as a Member. It never expires — disable
            or regenerate it at any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inviteUrl ? (
            <>
              <div className="flex gap-2">
                <Input readOnly value={inviteUrl} className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={copyLink} aria-label="Copy link">
                  <CopyIcon className="size-4" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Dialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" disabled={pending}>
                      Regenerate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Regenerate invite link?</DialogTitle>
                      <DialogDescription>
                        This will immediately invalidate the current link. Anyone with the old
                        link will no longer be able to join.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRegenerateOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => regenerateInviteLink(workspaceId),
                            () => {
                              setRegenerateOpen(false);
                              toast.success("New invite link generated");
                            },
                          )
                        }
                        className="gap-2"
                      >
                        {pending && <Spinner className="size-4" />}
                        Regenerate link
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => disableInviteLink(workspaceId),
                      () => toast.success("Invite link disabled"),
                    )
                  }
                >
                  Disable link
                </Button>
              </div>
            </>
          ) : (
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => regenerateInviteLink(workspaceId),
                  () => toast.success("Invite link enabled"),
                )
              }
              className="gap-2"
            >
              {pending ? <Spinner className="size-4" /> : <LinkIcon className="size-4" />}
              Enable invite link
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="normal-case tracking-normal text-base font-semibold text-destructive">
            Danger Zone
          </CardTitle>
          <CardDescription>
            Deleting the workspace permanently removes all Spaces, Lists, Tasks, comments and
            files. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Dialog
            open={deleteOpen}
            onOpenChange={(open) => {
              setDeleteOpen(open);
              if (!open) setDeleteConfirm("");
            }}
          >
            <DialogTrigger asChild>
              <Button variant="destructive" className="gap-2">
                <WarningIcon className="size-4" />
                Delete workspace
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {workspaceName}?</DialogTitle>
                <DialogDescription>
                  All data will be permanently deleted. There is no recovery period. Type the
                  workspace name to confirm.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="delete-confirm">
                  Type <span className="font-semibold">{workspaceName}</span> to confirm
                </Label>
                <Input
                  id="delete-confirm"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending || deleteConfirm !== workspaceName}
                  onClick={() =>
                    run(
                      () => deleteWorkspace({ workspaceId, confirmName: deleteConfirm }),
                      () => {
                        toast.success("Workspace deletion started");
                        router.push("/dashboard");
                      },
                    )
                  }
                  className="gap-2"
                >
                  {pending && <Spinner className="size-4" />}
                  Delete forever
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}
