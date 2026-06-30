"use client";

import * as React from "react";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { inviteMember } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type InviteRole = "ADMIN" | "MEMBER" | "GUEST";

/**
 * Lightweight in-context "Invite member" modal. Reuses the existing
 * `inviteMember` server action — backend permissions/validation are unchanged.
 * `onInvited` lets the caller refresh its member list after a successful invite.
 */
export function InviteMemberModal({
  open,
  onOpenChange,
  workspaceId,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onInvited?: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<InviteRole>("MEMBER");
  const [sending, setSending] = React.useState(false);

  const trimmedEmail = email.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  // Reset fields whenever the modal is opened.
  React.useEffect(() => {
    if (open) {
      setEmail("");
      setRole("MEMBER");
      setSending(false);
    }
  }, [open]);

  async function handleSend() {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Please enter an email address.");
      return;
    }
    if (!emailValid) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSending(true);
    const res = await inviteMember({ workspaceId, email: trimmed, role });
    setSending(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Invite sent to ${trimmed}`);
    onOpenChange(false);
    onInvited?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email invite, valid for 7 days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-member-email">Email address</Label>
            <Input
              id="invite-member-email"
              type="email"
              placeholder="teammate@example.com"
              value={email}
              autoFocus
              aria-invalid={trimmedEmail.length > 0 && !emailValid}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !sending) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            {trimmedEmail.length > 0 && !emailValid && (
              <p className="text-xs text-destructive">Please enter a valid email address.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="MEMBER">Member</SelectItem>
                <SelectItem value="GUEST">Guest</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSend()} disabled={sending || !emailValid} className="gap-2">
            {sending ? <Spinner className="size-4" /> : <PaperPlaneTiltIcon className="size-4" />}
            Send Invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
