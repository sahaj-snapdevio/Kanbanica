"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CaretDownIcon,
  ProhibitIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMutation } from "@/hooks/use-mutation";
import { useTabParam } from "@/hooks/use-tab-param";

const TAB_VALUES = ["profile", "spaces", "danger"] as const;

interface UserProps {
  banExpires: Date | null;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  email: string;
  id: string;
  image: string | null;
  name: string;
  role: string | null;
}

interface MembershipRow {
  id: string;
  isOwner: boolean;
  joinedAt: Date;
  spaceId: string;
  spaceName: string;
}

const banFormSchema = z.object({
  reason: z.string().min(1, "Reason is required"),
  expiresIn: z.enum(["never", "1d", "7d", "30d", "90d"]),
});
type BanFormValues = z.infer<typeof banFormSchema>;

const EXPIRES_OPTIONS = [
  { value: "never", label: "Never" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
] as const;

const EXPIRES_SECONDS: Record<string, number | undefined> = {
  never: undefined,
  "1d": 86_400,
  "7d": 604_800,
  "30d": 2_592_000,
  "90d": 7_776_000,
};

export function UserDetail({
  user,
  memberships,
}: {
  user: UserProps;
  memberships: MembershipRow[];
}) {
  const router = useRouter();
  const tabParam = useTabParam(TAB_VALUES, "profile");
  const isAdmin = user.role === "admin";
  const [banSheetOpen, setBanSheetOpen] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [unbanning, setUnbanning] = useState(false);
  const [unbanOpen, setUnbanOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [membershipsPage, setMembershipsPage] = useState(1);
  const [membershipsPageSize, setMembershipsPageSize] = useState(10);
  const membershipsPageWindow = useMemo(() => {
    const start = (membershipsPage - 1) * membershipsPageSize;
    return memberships.slice(start, start + membershipsPageSize);
  }, [memberships, membershipsPage, membershipsPageSize]);
  const [prevMembershipsPageSize, setPrevMembershipsPageSize] =
    useState(membershipsPageSize);
  if (prevMembershipsPageSize !== membershipsPageSize) {
    setPrevMembershipsPageSize(membershipsPageSize);
    setMembershipsPage(1);
  }

  // Skip the hook's default refresh on this page — see space-detail.tsx
  // for the rationale (avoids 404 flash before the push).
  const { trigger: triggerDelete, isMutating: deleting } = useMutation({
    revalidate: false,
    onSuccess: () => {
      router.push("/orbit/users");
      router.refresh();
    },
  });
  const { trigger: triggerToggleAdmin, isMutating: togglingAdmin } =
    useMutation();

  const banForm = useForm<BanFormValues>({
    resolver: zodResolver(banFormSchema),
    defaultValues: { reason: "", expiresIn: "never" },
    mode: "onChange",
  });

  async function handleDelete() {
    await triggerDelete({
      url: `/api/orbit/users/${user.id}`,
      method: "DELETE",
      successMessage: "User deleted",
      errorMessage: "Failed to delete user",
    });
  }

  async function handleToggleAdmin() {
    await triggerToggleAdmin({
      url: `/api/orbit/users/${user.id}`,
      method: "PATCH",
      body: { role: isAdmin ? "user" : "admin" },
      successMessage: isAdmin
        ? "Admin privileges revoked"
        : "Admin privileges granted",
      errorMessage: "Failed to update admin status",
    });
  }

  async function handleLoginAs() {
    setImpersonating(true);
    try {
      const res = await fetch("/api/orbit/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Impersonation failed");
      }
      window.location.href = "/";
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Cannot impersonate this user"
      );
      setImpersonating(false);
    }
  }

  async function handleBan(values: BanFormValues) {
    try {
      const res = await fetch(`/api/orbit/users/${user.id}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          banReason: values.reason,
          banExpiresIn: EXPIRES_SECONDS[values.expiresIn],
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Ban failed");
      }
      toast.success("User banned");
      setBanSheetOpen(false);
      banForm.reset();
      router.refresh();
    } catch (err) {
      banForm.setError("root", {
        message: err instanceof Error ? err.message : "Failed to ban user",
      });
    }
  }

  async function handleUnban() {
    setUnbanning(true);
    try {
      const res = await fetch(`/api/orbit/users/${user.id}/unban`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Unban failed");
      }
      toast.success("User unbanned");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unban user");
    } finally {
      setUnbanning(false);
    }
  }

  return (
    <Tabs className="space-y-6" {...tabParam}>
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="spaces">Spaces</TabsTrigger>
        <TabsTrigger value="danger">Danger Zone</TabsTrigger>
      </TabsList>

      {/* Profile — user details + account actions */}
      <TabsContent className="space-y-6" value="profile">
        <Card>
          <CardHeader>
            <CardTitle>User Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium">{user.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{user.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Signed Up</dt>
                <dd className="font-medium">
                  {format(user.createdAt, "MMM d, yyyy HH:mm")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Role</dt>
                <dd>
                  {isAdmin ? (
                    <Badge className="gap-1" variant="secondary">
                      <ShieldCheckIcon className="size-3" weight="fill" />
                      Admin
                    </Badge>
                  ) : (
                    <span className="font-medium">User</span>
                  )}
                </dd>
              </div>
              {user.banned && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Ban Status</dt>
                  <dd className="space-y-1">
                    <Badge className="gap-1" variant="destructive">
                      <ProhibitIcon className="size-3" weight="fill" />
                      Banned
                    </Badge>
                    {user.banReason && (
                      <p className="text-sm text-muted-foreground">
                        Reason: {user.banReason}
                      </p>
                    )}
                    {user.banExpires && (
                      <p className="text-xs text-muted-foreground">
                        Expires: {format(user.banExpires, "MMM d, yyyy HH:mm")}
                      </p>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={togglingAdmin}
                onClick={handleToggleAdmin}
                size="sm"
                type="button"
                variant="outline"
              >
                {togglingAdmin && <Spinner className="size-4" />}
                {isAdmin ? "Revoke Admin" : "Grant Admin"}
              </Button>
              <Button
                disabled={impersonating || isAdmin}
                onClick={handleLoginAs}
                size="sm"
                type="button"
                variant="outline"
              >
                {impersonating && <Spinner className="size-4" />}
                Login as this user
              </Button>
              {user.banned ? (
                <>
                  <Button
                    disabled={unbanning}
                    onClick={() => setUnbanOpen(true)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {unbanning && <Spinner className="size-4" />}
                    Unban User
                  </Button>
                  <ConfirmActionDialog
                    busy={unbanning}
                    confirmLabel="Unban"
                    description={
                      <p>
                        This will restore access for{" "}
                        <strong>{user.email}</strong>. They will be able to sign
                        in immediately.
                      </p>
                    }
                    destructive={false}
                    onConfirm={() => {
                      setUnbanOpen(false);
                      void handleUnban();
                    }}
                    onOpenChange={setUnbanOpen}
                    open={unbanOpen}
                    title="Unban user?"
                  />
                </>
              ) : (
                <Button
                  className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/20"
                  disabled={isAdmin}
                  onClick={() => setBanSheetOpen(true)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Ban User
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Ban Sheet */}
        <Sheet onOpenChange={setBanSheetOpen} open={banSheetOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Ban {user.name}</SheetTitle>
              <SheetDescription>
                This will immediately block {user.email} from signing in.
              </SheetDescription>
            </SheetHeader>
            <Form {...banForm}>
              <form
                className="mt-6 space-y-4 px-4 pb-4"
                onSubmit={banForm.handleSubmit(handleBan)}
              >
                <FormField
                  control={banForm.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Violation of terms of service"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={banForm.control}
                  name="expiresIn"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expires</FormLabel>
                      <FormControl>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              className="w-full justify-between font-normal"
                              type="button"
                              variant="outline"
                            >
                              {EXPIRES_OPTIONS.find(
                                (o) => o.value === field.value
                              )?.label ?? "Never"}
                              <CaretDownIcon className="size-4 opacity-50" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                            <DropdownMenuRadioGroup
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              {EXPIRES_OPTIONS.map((opt) => (
                                <DropdownMenuRadioItem
                                  key={opt.value}
                                  value={opt.value}
                                >
                                  {opt.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {banForm.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {banForm.formState.errors.root.message}
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  className="w-full"
                  disabled={
                    !banForm.formState.isValid || banForm.formState.isSubmitting
                  }
                  type="submit"
                  variant="destructive"
                >
                  {banForm.formState.isSubmitting && (
                    <Spinner className="size-4" />
                  )}
                  Ban User
                </Button>
              </form>
            </Form>
          </SheetContent>
        </Sheet>
      </TabsContent>

      {/* Spaces — memberships */}
      <TabsContent className="space-y-6" value="spaces">
        <Card>
          <CardHeader>
            <CardTitle>Spaces ({memberships.length})</CardTitle>
            <CardDescription>Spaces this user belongs to.</CardDescription>
          </CardHeader>
          <CardContent>
            {memberships.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                This user is not a member of any spaces.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Space</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {membershipsPageWindow.map((m) => (
                    <TableRow
                      className="cursor-pointer"
                      key={m.id}
                      onClick={() => router.push(`/orbit/spaces/${m.spaceId}`)}
                    >
                      <TableCell className="font-medium">
                        {m.spaceName}
                      </TableCell>
                      <TableCell>{m.isOwner ? "Owner" : "Member"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(m.joinedAt, "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {memberships.length > 0 && (
              <div className="mt-3">
                <TablePagination
                  onPageChange={setMembershipsPage}
                  onPageSizeChange={setMembershipsPageSize}
                  page={membershipsPage}
                  pageSize={membershipsPageSize}
                  total={memberships.length}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Danger Zone */}
      <TabsContent className="space-y-6" value="danger">
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Permanently delete this user and all associated data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              disabled={deleting}
              onClick={() => setDeleteOpen(true)}
              size="sm"
              variant="destructive"
            >
              {deleting && <Spinner className="size-4" />}
              Delete User
            </Button>
            <ConfirmActionDialog
              busy={deleting}
              confirmLabel="Delete"
              description={
                <p>
                  This will permanently delete <strong>{user.email}</strong> and
                  cascade-delete their sessions, spaces, and space memberships.
                  Cubes in owned spaces will also be removed. This cannot be
                  undone.
                </p>
              }
              onConfirm={() => {
                setDeleteOpen(false);
                void handleDelete();
              }}
              onOpenChange={setDeleteOpen}
              open={deleteOpen}
              title="Delete user?"
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
