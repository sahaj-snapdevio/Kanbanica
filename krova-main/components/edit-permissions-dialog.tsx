"use client";

import { PencilIcon } from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateMemberPermissions } from "@/app/actions/members";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
import {
  PERMISSION_LABELS,
  VISIBLE_PERMISSION_VALUES,
} from "@/db/schema/types";

interface Member {
  cubeAssignments: string[];
  email: string;
  membershipId: string;
  name: string;
  permissions: string[];
  userId: string;
}

interface EditPermissionsDialogProps {
  cubes: { id: string; name: string }[];
  member: Member;
  onSuccess: () => void;
  spaceId: string;
}

export function EditPermissionsDialog({
  member,
  spaceId,
  cubes,
  onSuccess,
}: EditPermissionsDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(
    member.permissions
  );
  const [selectedCubes, setSelectedCubes] = useState<string[]>(
    member.cubeAssignments
  );

  const hasChanges =
    JSON.stringify([...selectedPermissions].sort()) !==
      JSON.stringify([...member.permissions].sort()) ||
    JSON.stringify([...selectedCubes].sort()) !==
      JSON.stringify([...member.cubeAssignments].sort());

  function togglePermission(perm: string) {
    setSelectedPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  function toggleCube(cubeId: string) {
    setSelectedCubes((prev) =>
      prev.includes(cubeId)
        ? prev.filter((v) => v !== cubeId)
        : [...prev, cubeId]
    );
  }

  function handleSave() {
    setServerError(null);
    startTransition(async () => {
      const result = await updateMemberPermissions(
        spaceId,
        member.membershipId,
        {
          permissions: selectedPermissions,
          cubeAssignments: selectedCubes,
        }
      );

      if ("error" in result) {
        setServerError(result.error);
        return;
      }

      toast.success("Permissions updated");
      setOpen(false);
      onSuccess();
    });
  }

  function handleOpenChange(v: boolean) {
    if (v) {
      // Reset to current values when opening
      setSelectedPermissions(member.permissions);
      setSelectedCubes(member.cubeAssignments);
      setServerError(null);
    }
    setOpen(v);
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetTrigger asChild>
        <Button aria-label="Edit permissions" size="icon-sm" variant="ghost">
          <PencilIcon className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit permissions</SheetTitle>
          <SheetDescription>
            Update permissions and Cube assignments for {member.name}.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="grid grid-cols-2 gap-2">
              {VISIBLE_PERMISSION_VALUES.map((perm) => (
                <div className="flex items-center gap-2" key={perm}>
                  <Checkbox
                    checked={selectedPermissions.includes(perm)}
                    disabled={isPending}
                    id={`edit-perm-${perm}`}
                    onCheckedChange={() => togglePermission(perm)}
                  />
                  <Label
                    className="cursor-pointer text-sm font-normal"
                    htmlFor={`edit-perm-${perm}`}
                  >
                    {PERMISSION_LABELS[perm] ?? perm}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {cubes.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>Cube Assignments</Label>
                <div className="max-h-40 space-y-2 overflow-auto">
                  {cubes.map((cube) => (
                    <div className="flex items-center gap-2" key={cube.id}>
                      <Checkbox
                        checked={selectedCubes.includes(cube.id)}
                        disabled={isPending}
                        id={`edit-cube-${cube.id}`}
                        onCheckedChange={() => toggleCube(cube.id)}
                      />
                      <Label
                        className="cursor-pointer text-sm font-normal"
                        htmlFor={`edit-cube-${cube.id}`}
                      >
                        {cube.name}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <SheetFooter className="mt-0 pt-0 sm:flex-row-reverse sm:justify-start">
          <Button disabled={!hasChanges || isPending} onClick={handleSave}>
            {isPending && <Spinner className="size-4" />}
            Save Changes
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
