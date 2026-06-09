"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { Fragment, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createApiKey, revokeApiKey } from "@/app/actions/api-keys";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
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
import { copyToClipboard } from "@/lib/clipboard";

const generateKeySchema = z.object({
  name: z.string().trim().min(1, "Key name is required"),
});

type GenerateKeyValues = z.infer<typeof generateKeySchema>;

interface ApiKeyData {
  createdAt: Date;
  id: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  name: string;
}

interface ApiKeyManagerProps {
  initialKeys: ApiKeyData[];
  spaceId: string;
}

export function ApiKeyManager({ spaceId, initialKeys }: ApiKeyManagerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [keys, setKeys] = useState(initialKeys);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return keys.slice(start, start + pageSize);
  }, [keys, page, pageSize]);
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }

  const form = useForm<GenerateKeyValues>({
    resolver: zodResolver(generateKeySchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  async function handleRevoke(keyId: string) {
    setRevokingId(keyId);
    const result = await revokeApiKey(spaceId, keyId);
    if ("error" in result) {
      toast.error(result.error);
      setRevokingId(null);
      return;
    }
    toast.success("API key revoked");
    setKeys((prev) => prev.filter((k) => k.id !== keyId));
    setRevokingId(null);
  }

  async function handleGenerate(values: GenerateKeyValues) {
    const result = await createApiKey(spaceId, values.name);
    if ("error" in result) {
      form.setError("root", { message: result.error });
      return;
    }
    setGeneratedKey(result.apiKey);
    setKeys((prev) => [
      {
        id: result.id,
        name: values.name,
        keyPrefix: result.keyPrefix,
        lastUsedAt: null,
        createdAt: new Date(),
      },
      ...prev,
    ]);
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      form.reset({ name: "" });
      setGeneratedKey(null);
    }
  }

  function handleCopy() {
    if (generatedKey) {
      copyToClipboard(generatedKey, "API key copied");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            Authenticate requests using the <code>X-API-KEY</code> header.
          </p>
        </div>

        <Sheet onOpenChange={handleSheetOpenChange} open={sheetOpen}>
          <SheetTrigger asChild>
            <Button size="sm" variant="outline">
              <PlusIcon className="size-4" />
              Generate key
            </Button>
          </SheetTrigger>
          <SheetContent
            onInteractOutside={(e) => e.preventDefault()}
            side="right"
          >
            <SheetHeader>
              <SheetTitle>Generate API key</SheetTitle>
              <SheetDescription>
                API keys authenticate requests using the <code>X-API-KEY</code>{" "}
                header.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4 px-4 pb-4">
              {generatedKey ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Store this key securely. It will not be shown again.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Your API Key</Label>
                    <div className="flex gap-1.5">
                      <Input
                        className="font-mono text-xs"
                        readOnly
                        value={generatedKey}
                      />
                      <Button onClick={handleCopy} size="sm" variant="outline">
                        Copy
                      </Button>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => handleSheetOpenChange(false)}
                    variant="outline"
                  >
                    Done
                  </Button>
                </div>
              ) : (
                <Form {...form}>
                  <form
                    className="space-y-4"
                    onSubmit={form.handleSubmit(handleGenerate)}
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
                          <FormLabel>Key Name</FormLabel>
                          <FormControl>
                            <Input
                              autoFocus
                              placeholder="e.g. CI/CD pipeline"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      className="w-full"
                      disabled={
                        !form.formState.isValid || form.formState.isSubmitting
                      }
                      type="submit"
                    >
                      {form.formState.isSubmitting && (
                        <Spinner className="size-4" />
                      )}
                      Generate
                    </Button>
                  </form>
                </Form>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {keys.length > 0 ? (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageWindow.map((key) => (
              <Fragment key={key.id}>
                <TableRow>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <Badge className="font-mono text-xs" variant="secondary">
                      {key.keyPrefix}
                      &bull;&bull;&bull;&bull;
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDistanceToNow(new Date(key.createdAt), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {key.lastUsedAt
                      ? formatDistanceToNow(new Date(key.lastUsedAt), {
                          addSuffix: true,
                        })
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <Button
                      disabled={revokingId === key.id}
                      onClick={() => setRevokeTarget(key)}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <TrashIcon className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Empty className="mt-4 rounded-md border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyIcon className="size-5" />
            </EmptyMedia>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>
              Generate an API key to use the v1 REST API. Each key carries the
              same permissions you have in this space.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {keys.length > 0 && (
        <TablePagination
          className="mt-3"
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          page={page}
          pageSize={pageSize}
          total={keys.length}
        />
      )}

      <ConfirmActionDialog
        busy={revokingId === revokeTarget?.id}
        confirmLabel="Revoke"
        description={
          <p>
            This will permanently revoke <strong>{revokeTarget?.name}</strong>.
            All requests using this key will fail immediately.
          </p>
        }
        onConfirm={() => {
          if (revokeTarget) {
            const targetId = revokeTarget.id;
            setRevokeTarget(null);
            void handleRevoke(targetId);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
          }
        }}
        open={!!revokeTarget}
        title="Revoke API Key"
      />
    </div>
  );
}
