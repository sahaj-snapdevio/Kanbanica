"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  GlobeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
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
import { useMutation } from "@/hooks/use-mutation";

interface Region {
  createdAt: string;
  id: string;
  name: string;
  serverCount: number;
  slug: string;
}

const regionSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9-]+$/, "Must be lowercase alphanumeric with hyphens"),
});

type RegionValues = z.infer<typeof regionSchema>;

function RegionSheet({
  region,
  trigger,
}: {
  region?: Region;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { trigger: mutate, isMutating } = useMutation();

  const isEditing = !!region;

  const form = useForm<RegionValues>({
    resolver: zodResolver(regionSchema),
    defaultValues: {
      name: region?.name ?? "",
      slug: region?.slug ?? "",
    },
    mode: "onChange",
  });

  const {
    formState: { isValid, isDirty },
  } = form;

  async function onSubmit(values: RegionValues) {
    if (isEditing) {
      const data = await mutate({
        url: "/api/orbit/regions",
        method: "PATCH",
        body: { id: region.id, name: values.name, slug: values.slug },
        successMessage: `Region "${values.name}" updated.`,
      });
      if (data === null) {
        form.setError("root", { message: "Failed to update region" });
      } else {
        setOpen(false);
      }
    } else {
      const data = await mutate({
        url: "/api/orbit/regions",
        method: "POST",
        body: { name: values.name, slug: values.slug },
        successMessage: `Region "${values.name}" created.`,
      });
      if (data === null) {
        form.setError("root", { message: "Failed to create region" });
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
            name: region?.name ?? "",
            slug: region?.slug ?? "",
          });
        }
      }}
      open={open}
    >
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEditing ? "Edit Region" : "Create Region"}</SheetTitle>
          <SheetDescription>
            {isEditing
              ? "Update this region's details."
              : "Add a new region for server grouping."}
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
                    <Input placeholder="US East" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input placeholder="us-east-1" {...field} />
                  </FormControl>
                  <FormMessage />
                  <p className="text-xs text-muted-foreground">
                    Lowercase alphanumeric with hyphens (e.g. us-east-1)
                  </p>
                </FormItem>
              )}
            />

            <Button
              className="w-full"
              disabled={isSubmitDisabled}
              type="submit"
            >
              {isMutating && <Spinner className="size-4" />}
              {isEditing ? "Save Changes" : "Create Region"}
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

export function RegionsManagement({ regions }: { regions: Region[] }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return regions.slice(start, start + pageSize);
  }, [regions, page, pageSize]);
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }
  const { trigger: mutate, isMutating } = useMutation();

  async function handleDelete(region: Region) {
    await mutate({
      url: `/api/orbit/regions?id=${region.id}`,
      method: "DELETE",
      successMessage: `Region "${region.name}" deleted.`,
      errorMessage: "Failed to delete region",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Regions</h1>
          <p className="text-sm text-muted-foreground">
            Manage regions for server grouping.
          </p>
        </div>
        <RegionSheet
          trigger={
            <Button>
              <PlusIcon className="size-4" />
              Create Region
            </Button>
          }
        />
      </div>

      {regions.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <GlobeIcon className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No regions</EmptyTitle>
            <EmptyDescription>
              Create a region to start grouping your servers.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Region</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="text-right">Servers</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageWindow.map((region) => (
                <TableRow key={region.id}>
                  <TableCell className="font-medium">{region.name}</TableCell>
                  <TableCell>
                    <Badge className="font-mono" variant="secondary">
                      {region.slug}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {region.serverCount}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <RegionSheet
                        region={region}
                        trigger={
                          <Button
                            aria-label="Edit region"
                            size="icon-xs"
                            variant="ghost"
                          >
                            <PencilSimpleIcon className="size-3.5" />
                          </Button>
                        }
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            aria-label="Delete region"
                            disabled={isMutating || region.serverCount > 0}
                            size="icon-xs"
                            variant="ghost"
                          >
                            <TrashIcon className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Region</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete &ldquo;
                              {region.name}&rdquo;? This action cannot be
                              undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
                              onClick={() => handleDelete(region)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
              total={regions.length}
            />
          </div>
        </div>
      )}
    </div>
  );
}
