"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestDataExport } from "@/app/actions/profile";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export function ProfileDataExportCard() {
  const [isPending, startTransition] = useTransition();
  const [lastExportedAt, setLastExportedAt] = useState<string | null>(null);

  function handleExport() {
    startTransition(async () => {
      const res = await requestDataExport();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const { filename, export: payload } = res.data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLastExportedAt(new Date().toISOString());
      toast.success("Data export downloaded");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export your data</CardTitle>
        <CardDescription>
          Download a JSON archive of everything tied to your account — profile,
          spaces you belong to, cubes, billing history, and your audit-log
          entries. Safe to keep for your records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button disabled={isPending} onClick={handleExport}>
          {isPending ? (
            <Spinner className="size-4" />
          ) : (
            <DownloadSimpleIcon className="size-4" />
          )}
          {isPending ? "Generating…" : "Download data export"}
        </Button>
        {lastExportedAt && (
          <p className="text-xs text-muted-foreground">
            Last download:{" "}
            <span className="font-mono tabular-nums">
              {new Date(lastExportedAt).toLocaleString()}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
