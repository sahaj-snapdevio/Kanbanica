"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  HardDrivesIcon,
  KeyIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@/hooks/use-mutation";

interface SshKey {
  createdAt: string;
  fingerprint: string;
  id: string;
  name: string;
  serverCount: number;
}

const createSshKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  privateKey: z.string().min(1, "Private key is required"),
});

const editSshKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  privateKey: z.string().optional(),
});

type CreateSshKeyValues = z.infer<typeof createSshKeySchema>;
type EditSshKeyValues = z.infer<typeof editSshKeySchema>;

function SshKeySheet({
  sshKey,
  trigger,
}: {
  sshKey?: SshKey;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { trigger: mutate, isMutating } = useMutation();

  const isEditing = !!sshKey;

  const form = useForm<CreateSshKeyValues | EditSshKeyValues>({
    resolver: zodResolver(isEditing ? editSshKeySchema : createSshKeySchema),
    defaultValues: {
      name: sshKey?.name ?? "",
      privateKey: "",
    },
    mode: "onChange",
  });

  const {
    formState: { isValid, isDirty },
  } = form;

  async function onSubmit(values: CreateSshKeyValues | EditSshKeyValues) {
    if (isEditing) {
      const body: Record<string, unknown> = { name: values.name };
      if (values.privateKey) {
        body.privateKey = values.privateKey;
      }

      const data = await mutate({
        url: `/api/orbit/ssh-keys/${sshKey.id}`,
        method: "PATCH",
        body,
        successMessage: `SSH key "${values.name}" updated.`,
      });
      if (data === null) {
        form.setError("root", { message: "Failed to update SSH key" });
      } else {
        setOpen(false);
      }
    } else {
      const data = await mutate({
        url: "/api/orbit/ssh-keys",
        method: "POST",
        body: {
          name: values.name,
          privateKey: values.privateKey,
        },
        successMessage: `SSH key "${values.name}" created.`,
      });
      if (data === null) {
        form.setError("root", { message: "Failed to create SSH key" });
      } else {
        form.reset();
        setOpen(false);
      }
    }
  }

  const isSubmitDisabled = isEditing
    ? !isValid || !isDirty || isMutating
    : !isValid || isMutating;

  return (
    <Sheet
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          form.reset({
            name: sshKey?.name ?? "",
            privateKey: "",
          });
        }
      }}
      open={open}
    >
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEditing ? "Edit SSH Key" : "Add SSH Key"}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? "Update this SSH key's name or replace the private key."
              : "Add a new SSH private key for use with servers."}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="space-y-4 px-4 pb-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="production-server-key" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="privateKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Private Key
                    {isEditing && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (leave blank to keep current)
                      </span>
                    )}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      className="font-mono text-xs"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      rows={6}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              className="w-full"
              disabled={isSubmitDisabled}
              type="submit"
            >
              {isMutating && <Spinner className="size-4" />}
              {isEditing ? "Save Changes" : "Add SSH Key"}
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function DeleteSshKeyDialog({
  sshKey,
  trigger,
}: {
  sshKey: SshKey;
  trigger: React.ReactNode;
}) {
  const [confirmName, setConfirmName] = useState("");
  const { trigger: mutate, isMutating } = useMutation();

  const inUse = sshKey.serverCount > 0;

  async function handleDelete() {
    await mutate({
      url: `/api/orbit/ssh-keys/${sshKey.id}`,
      method: "DELETE",
      successMessage: `SSH key "${sshKey.name}" deleted.`,
      errorMessage: "Failed to delete SSH key",
    });
    setConfirmName("");
  }

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setConfirmName("");
        }
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete SSH Key</AlertDialogTitle>
          <AlertDialogDescription>
            {inUse ? (
              <>
                This key is in use by {sshKey.serverCount} server(s). Remove all
                references before deleting.
              </>
            ) : (
              <>
                This will permanently delete the SSH key &ldquo;{sshKey.name}
                &rdquo;. Type the name to confirm.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!inUse && (
          <Input
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={sshKey.name}
            value={confirmName}
          />
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {!inUse && (
            <AlertDialogAction
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
              disabled={confirmName !== sshKey.name || isMutating}
              onClick={handleDelete}
            >
              {isMutating && <Spinner className="size-4" />}
              Delete
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SshKeysManagement({ sshKeys }: { sshKeys: SshKey[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sshKeys.slice(start, start + pageSize);
  }, [sshKeys, page, pageSize]);
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SSH Keys</h1>
          <p className="text-sm text-muted-foreground">
            Manage SSH private keys used by servers.
          </p>
        </div>
        <SshKeySheet
          trigger={
            <Button size="sm">
              <PlusIcon className="size-4" />
              Add SSH Key
            </Button>
          }
        />
      </div>

      {sshKeys.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <KeyIcon className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No SSH keys</EmptyTitle>
            <EmptyDescription>
              Add an SSH key to use with servers.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Fingerprint</TableHead>
                <TableHead>Used By</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageWindow.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {key.fingerprint}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {key.serverCount > 0 && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <HardDrivesIcon className="size-3.5" />
                          {key.serverCount} server
                          {key.serverCount !== 1 && "s"}
                        </span>
                      )}
                      {key.serverCount === 0 && (
                        <Badge variant="secondary">Unused</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(key.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <SshKeySheet
                        sshKey={key}
                        trigger={
                          <Button
                            aria-label="Edit SSH key"
                            size="icon-xs"
                            variant="ghost"
                          >
                            <PencilSimpleIcon className="size-3.5" />
                          </Button>
                        }
                      />
                      <DeleteSshKeyDialog
                        sshKey={key}
                        trigger={
                          <Button
                            aria-label="Delete SSH key"
                            size="icon-xs"
                            variant="ghost"
                          >
                            <TrashIcon className="size-3.5" />
                          </Button>
                        }
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t p-2">
            <TablePagination
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              page={page}
              pageSize={pageSize}
              total={sshKeys.length}
            />
          </div>
        </div>
      )}
    </div>
  );
}
