"use client";

import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  type BackupDownloadInfo,
  getBackupDownloadUrl,
} from "@/app/actions/cube-import";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { copyToClipboard } from "@/lib/clipboard";
import { formatBytes } from "@/lib/format";

interface BackupDownloadSheetProps {
  backupId: string;
  backupName: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  spaceId: string;
}

export function BackupDownloadSheet({
  open,
  onOpenChange,
  spaceId,
  backupId,
  backupName,
}: BackupDownloadSheetProps) {
  const [info, setInfo] = useState<BackupDownloadInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Generate the download URL on demand. Re-clicking refreshes.
  const generate = useCallback(() => {
    startTransition(async () => {
      setError(null);
      const result = await getBackupDownloadUrl(spaceId, backupId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setInfo(result.data);
    });
  }, [spaceId, backupId]);

  // Auto-generate the first time the sheet opens. Guarded so a
  // failure (info=null, error=set) doesn't loop, and so a successful
  // generate stays cached for the lifetime of the open sheet.
  useEffect(() => {
    if (open && !info && !error && !isPending) {
      generate();
    }
  }, [open, info, error, isPending, generate]);

  function reset() {
    setInfo(null);
    setError(null);
    setCopied(false);
  }

  async function copyUrl() {
    if (!info) {
      return;
    }
    const ok = await copyToClipboard(info.url, "Download URL copied");
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Sheet
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          reset();
        }
      }}
      open={open}
    >
      <SheetContent className="w-full sm:max-w-lg" side="right">
        <SheetHeader>
          <SheetTitle>Download backup</SheetTitle>
          <SheetDescription>
            The download URL is bound to your storage backend and expires in 15
            minutes. Anyone with this URL during that window can download the
            archive — share carefully.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {isPending && !info && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Generating link…
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {info && (
            <>
              <div className="space-y-1 text-sm">
                <div className="text-muted-foreground">Backup</div>
                <div className="font-medium">{backupName}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Filename</div>
                  <div className="font-mono text-xs">{info.filename}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Size</div>
                  <div>{formatBytes(info.sizeBytes)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Expires</div>
                  <div className="text-xs">
                    {format(
                      new Date(info.expiresAt),
                      "MMM d, yyyy HH:mm:ss 'UTC'"
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Download URL</div>
                <div className="flex gap-2">
                  <Button asChild className="flex-1" variant="default">
                    <a
                      download={info.filename}
                      href={info.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <DownloadIcon className="size-4" />
                      Open download
                      <ArrowSquareOutIcon className="size-3 opacity-60" />
                    </a>
                  </Button>
                  <Button
                    aria-label="Copy URL"
                    onClick={copyUrl}
                    type="button"
                    variant="outline"
                  >
                    {copied ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Script with curl</div>
                <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs">
                  curl -fL -o {info.filename} {"\\\n  "}
                  &quot;{info.url}&quot;
                </pre>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Extract locally</div>
                <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
                  tar -xf {info.filename}
                  {"\n"}sha256sum -c checksums.txt
                  {"\n"}zstd -d rootfs.ext4.zst
                  {"\n"}sudo mount -o loop,ro rootfs.ext4 /mnt
                </pre>
              </div>
            </>
          )}
        </div>

        <SheetFooter>
          <Button
            disabled={isPending}
            onClick={generate}
            type="button"
            variant="outline"
          >
            <ArrowClockwiseIcon className="size-4" />
            Regenerate
          </Button>
          <SheetClose asChild>
            <Button type="button" variant="ghost">
              Close
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
