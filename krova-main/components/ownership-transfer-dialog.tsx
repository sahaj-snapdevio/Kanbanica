"use client";

import { CaretDownIcon, WarningIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { transferOwnership } from "@/app/actions/members";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

interface Member {
  email: string;
  membershipId: string;
  name: string;
  userId: string;
}

interface OwnershipTransferDialogProps {
  members: Member[];
  spaceId: string;
}

export function OwnershipTransferDialog({
  members,
  spaceId,
}: OwnershipTransferDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");

  const selectedMember = members.find((m) => m.userId === selectedUserId);
  const selectedLabel = selectedMember
    ? `${selectedMember.name} (${selectedMember.email})`
    : "Select a member";
  const emailConfirmed =
    selectedMember &&
    confirmEmail.trim().toLowerCase() === selectedMember.email.toLowerCase();

  function handleTransfer() {
    if (!selectedMember) {
      return;
    }
    if (!emailConfirmed) {
      return;
    }
    startTransition(async () => {
      const result = await transferOwnership(spaceId, selectedUserId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Ownership has been transferred successfully");
      setOpen(false);
      setSelectedUserId("");
      setConfirmEmail("");
      router.refresh();
    });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelectedUserId("");
      setConfirmEmail("");
    }
    setOpen(next);
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          Transfer
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Transfer ownership</SheetTitle>
          <SheetDescription>
            Select a member to transfer ownership of this space to.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <Alert variant="destructive">
            <WarningIcon className="size-4" />
            <AlertDescription>
              Ownership transfer is one-way. The new owner gets every permission
              on this space (delete, billing, members). You will keep your
              membership but lose owner-only access.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label>New Owner</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={isPending}>
                <Button
                  className="w-full justify-between font-normal"
                  variant="outline"
                >
                  <span className="truncate">{selectedLabel}</span>
                  <CaretDownIcon className="size-4 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                {members.map((m) => (
                  <DropdownMenuItem
                    key={m.userId}
                    onClick={() => {
                      setSelectedUserId(m.userId);
                      setConfirmEmail("");
                    }}
                  >
                    <span className="truncate">
                      {m.name} ({m.email})
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {selectedMember && (
            <div className="space-y-2">
              <Label htmlFor="confirm-email">
                Type{" "}
                <span className="font-mono text-foreground">
                  {selectedMember.email}
                </span>{" "}
                to confirm
              </Label>
              <Input
                autoComplete="off"
                disabled={isPending}
                id="confirm-email"
                onChange={(e) => setConfirmEmail(e.target.value)}
                placeholder={selectedMember.email}
                spellCheck={false}
                value={confirmEmail}
              />
            </div>
          )}
        </div>

        <SheetFooter className="mt-0 pt-0 sm:flex-row-reverse sm:justify-start">
          <Button
            disabled={isPending || !selectedUserId || !emailConfirmed}
            onClick={handleTransfer}
            variant="destructive"
          >
            {isPending && <Spinner className="size-4" />}
            Transfer Ownership
          </Button>
          <Button
            disabled={isPending}
            onClick={() => setOpen(false)}
            variant="outline"
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
