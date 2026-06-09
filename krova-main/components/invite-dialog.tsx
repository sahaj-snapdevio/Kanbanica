"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CopyIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { sendInvite } from "@/app/actions/invites";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
import { copyToClipboard } from "@/lib/clipboard";

const inviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

type InviteFormValues = z.infer<typeof inviteSchema>;

interface InviteDialogProps {
  cubes: { id: string; name: string }[];
  spaceId: string;
}

export function InviteDialog({ spaceId, cubes }: InviteDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "" },
    mode: "onChange",
  });

  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [selectedCubes, setSelectedCubes] = useState<string[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

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

  function handleSubmit(values: InviteFormValues) {
    startTransition(async () => {
      const result = await sendInvite(spaceId, {
        email: values.email.trim(),
        permissions: selectedPermissions,
        cubeAssignments: selectedCubes,
      });

      if ("error" in result) {
        form.setError("root", { message: result.error });
        return;
      }

      setInviteUrl(result.data.inviteUrl);
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success("Invite sent");
      }
      router.refresh();
    });
  }

  function handleClose() {
    setOpen(false);
    form.reset();
    setSelectedPermissions([]);
    setSelectedCubes([]);
    setInviteUrl(null);
  }

  function copyUrl() {
    if (inviteUrl) {
      copyToClipboard(inviteUrl);
    }
  }

  return (
    <Sheet
      onOpenChange={(v) => {
        if (v) {
          setOpen(true);
        } else {
          handleClose();
        }
      }}
      open={open}
    >
      <SheetTrigger asChild>
        <Button>
          <PaperPlaneTiltIcon className="size-4" />
          Invite Member
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {inviteUrl ? (
          <>
            <SheetHeader>
              <SheetTitle>Invite sent</SheetTitle>
              <SheetDescription>
                Invite email sent. You can also share this link directly.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-4">
              <div className="flex items-center gap-2 rounded-md border p-3">
                <code className="flex-1 truncate font-mono text-sm">
                  {inviteUrl}
                </code>
                <Button
                  aria-label="Copy invite URL"
                  onClick={copyUrl}
                  size="icon-sm"
                  variant="ghost"
                >
                  <CopyIcon className="size-4" />
                </Button>
              </div>
            </div>
            <SheetFooter className="mt-0 pt-0">
              <Button onClick={handleClose}>Done</Button>
            </SheetFooter>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>Invite member</SheetTitle>
              <SheetDescription>
                Send an invite to join this space.
              </SheetDescription>
            </SheetHeader>

            <Form {...form}>
              <form
                className="space-y-4 px-4 pb-4"
                onSubmit={form.handleSubmit(handleSubmit)}
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
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          disabled={isPending}
                          placeholder="user@example.com"
                          type="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                <div className="space-y-2">
                  <Label>Permissions</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {VISIBLE_PERMISSION_VALUES.map((perm) => (
                      <div className="flex items-center gap-2" key={perm}>
                        <Checkbox
                          checked={selectedPermissions.includes(perm)}
                          disabled={isPending}
                          id={`perm-${perm}`}
                          onCheckedChange={() => togglePermission(perm)}
                        />
                        <Label
                          className="cursor-pointer text-sm font-normal"
                          htmlFor={`perm-${perm}`}
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
                          <div
                            className="flex items-center gap-2"
                            key={cube.id}
                          >
                            <Checkbox
                              checked={selectedCubes.includes(cube.id)}
                              disabled={isPending}
                              id={`cube-${cube.id}`}
                              onCheckedChange={() => toggleCube(cube.id)}
                            />
                            <Label
                              className="cursor-pointer text-sm font-normal"
                              htmlFor={`cube-${cube.id}`}
                            >
                              {cube.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <SheetFooter className="mt-0 px-0 pt-0 sm:flex-row-reverse sm:justify-start">
                  <Button
                    disabled={!form.formState.isValid || isPending}
                    type="submit"
                  >
                    {isPending && <Spinner className="size-4" />}
                    Send Invite
                  </Button>
                  <Button
                    disabled={isPending}
                    onClick={handleClose}
                    type="button"
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </SheetFooter>
              </form>
            </Form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
