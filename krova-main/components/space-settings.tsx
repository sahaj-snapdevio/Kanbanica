"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { deleteSpace, renameSpace } from "@/app/actions/spaces";
import { ApiKeyManager } from "@/components/api-key-manager";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { OwnershipTransferDialog } from "@/components/ownership-transfer-dialog";
import { SettingsNav } from "@/components/settings-nav";
import {
  type DomainClaimRow,
  SpaceDomainClaims,
} from "@/components/space-domain-claims";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

const renameSchema = z.object({
  spaceName: z.string().min(1, "Space name is required"),
});

type RenameFormValues = z.infer<typeof renameSchema>;

interface Member {
  cubeAssignments: string[];
  email: string;
  image: string | null;
  isOwner: boolean;
  membershipId: string;
  name: string;
  permissions: string[];
  userId: string;
}

interface SpaceSettingsProps {
  activeCubeCount: number;
  apiKeys: {
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    createdAt: Date;
  }[];
  backupCount: number;
  canManageDomains: boolean;
  canManageMembers: boolean;
  domainClaims: DomainClaimRow[];
  hasCredits: boolean;
  isOwner: boolean;
  members: Member[];
  space: { id: string; name: string };
  spaceCount: number;
}

export function SpaceSettings({
  space,
  members,
  isOwner,
  canManageMembers,
  spaceCount,
  activeCubeCount,
  backupCount,
  hasCredits,
  apiKeys,
  canManageDomains,
  domainClaims,
}: SpaceSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteBlockReasons: string[] = [];
  if (spaceCount <= 1) {
    deleteBlockReasons.push("You must have at least one space.");
  }
  if (activeCubeCount > 0) {
    deleteBlockReasons.push(
      `${activeCubeCount} active Cube${activeCubeCount > 1 ? "s" : ""} must be deleted first.`
    );
  }
  if (backupCount > 0) {
    deleteBlockReasons.push(
      `${backupCount} backup${backupCount > 1 ? "s" : ""} must be deleted first.`
    );
  }
  if (hasCredits) {
    deleteBlockReasons.push("Credit balance must be zero.");
  }
  const canDeleteSpace = deleteBlockReasons.length === 0;

  const form = useForm<RenameFormValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { spaceName: space.name },
    mode: "onChange",
  });

  function handleRename(values: RenameFormValues) {
    if (values.spaceName.trim() === space.name) {
      return;
    }

    startTransition(async () => {
      const result = await renameSpace(space.id, values.spaceName.trim());
      if ("error" in result) {
        form.setError("root", { message: result.error });
        return;
      }
      toast.success("Space renamed");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteSpace(space.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Space and all its Cubes are being deleted");
      router.push("/");
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Settings</PageHeaderTitle>
          <PageHeaderDescription>
            Manage your space settings.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <SettingsNav spaceId={space.id} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Space Information</CardTitle>
            <CardDescription>
              Basic information about this space.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(isOwner || canManageMembers) && (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleRename)}>
                  <FormField
                    control={form.control}
                    name="spaceName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Space Name</FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input disabled={isPending} {...field} />
                          </FormControl>
                          <Button
                            disabled={
                              !form.formState.isValid ||
                              !form.formState.isDirty ||
                              isPending
                            }
                            type="submit"
                          >
                            {isPending ? (
                              <Spinner className="size-4" />
                            ) : (
                              <PencilIcon className="size-4" />
                            )}
                            Save
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {form.formState.errors.root && (
                    <Alert className="mt-2" variant="destructive">
                      <WarningIcon className="size-4" />
                      <AlertDescription>
                        {form.formState.errors.root.message}
                      </AlertDescription>
                    </Alert>
                  )}
                </form>
              </Form>
            )}
          </CardContent>
        </Card>

        {isOwner && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <WarningIcon className="size-5" />
                Danger Zone
              </CardTitle>
              <CardDescription>
                Irreversible actions for this space.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {members.filter((m) => !m.isOwner).length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Transfer ownership</p>
                      <p className="text-xs text-muted-foreground">
                        Transfer this space to another member.
                      </p>
                    </div>
                    <OwnershipTransferDialog
                      members={members.filter((m) => !m.isOwner)}
                      spaceId={space.id}
                    />
                  </div>
                  <Separator />
                </>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Delete Space</p>
                    <p className="text-xs text-muted-foreground">
                      {canDeleteSpace
                        ? "Permanently delete this space and all its data."
                        : "Resolve the issues below before deleting."}
                    </p>
                  </div>
                  <Button
                    disabled={!canDeleteSpace}
                    onClick={() => setDeleteOpen(true)}
                    size="sm"
                    variant="destructive"
                  >
                    <TrashIcon className="size-4" />
                    Delete Space
                  </Button>
                  <ConfirmDestructiveDialog
                    busy={isPending}
                    confirmLabel="Delete Space"
                    confirmText={space.name}
                    confirmValue={deleteConfirm}
                    description={
                      <p>
                        This will permanently delete the space, all Cubes, and
                        remove all members. Type{" "}
                        <strong className="text-foreground">
                          {space.name}
                        </strong>{" "}
                        to confirm.
                      </p>
                    }
                    onConfirm={handleDelete}
                    onConfirmValueChange={setDeleteConfirm}
                    onOpenChange={(open) => {
                      if (!open) {
                        setDeleteConfirm("");
                      }
                      setDeleteOpen(open);
                    }}
                    open={deleteOpen}
                    title="Delete Space"
                  />
                </div>
                {!canDeleteSpace && deleteBlockReasons.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {deleteBlockReasons.map((reason) => (
                      <li className="flex items-start gap-1.5" key={reason}>
                        <span className="mt-0.5 text-destructive">•</span>
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Create API keys to access Krova programmatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyManager initialKeys={apiKeys} spaceId={space.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Verified Domains</CardTitle>
          <CardDescription>
            Lock domains you own to this space so no other space can use them or
            their subdomains.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpaceDomainClaims
            canManage={canManageDomains}
            claims={domainClaims}
            spaceId={space.id}
          />
        </CardContent>
      </Card>
    </div>
  );
}
