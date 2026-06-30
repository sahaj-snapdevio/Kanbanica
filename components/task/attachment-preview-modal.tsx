"use client";

import * as React from "react";
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  FileIcon,
  FilePdfIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  ArrowCounterClockwiseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PreviewAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  url: string;
}

interface AttachmentPreviewContextValue {
  open: (attachment: PreviewAttachment) => void;
}

const AttachmentPreviewContext =
  React.createContext<AttachmentPreviewContextValue | null>(null);

/**
 * Opens attachments in an in-app preview modal. Returns `null` when no provider
 * is present so callers can fall back to opening the file in a new tab.
 */
export function useAttachmentPreview() {
  return React.useContext(AttachmentPreviewContext);
}

// ─── Provider ───────────────────────────────────────────────────────────────

export function AttachmentPreviewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [current, setCurrent] = React.useState<PreviewAttachment | null>(null);
  const open = React.useCallback(
    (attachment: PreviewAttachment) => setCurrent(attachment),
    [],
  );
  const value = React.useMemo(() => ({ open }), [open]);

  return (
    <AttachmentPreviewContext.Provider value={value}>
      {children}
      <AttachmentPreviewModal
        attachment={current}
        onOpenChange={(o) => {
          if (!o) setCurrent(null);
        }}
      />
    </AttachmentPreviewContext.Provider>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function formatBytes(bytes?: number) {
  if (bytes === undefined) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Modal ──────────────────────────────────────────────────────────────────

function AttachmentPreviewModal({
  attachment,
  onOpenChange,
}: {
  attachment: PreviewAttachment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [zoom, setZoom] = React.useState(1);

  // Reset zoom whenever a different attachment is opened.
  React.useEffect(() => {
    setZoom(1);
  }, [attachment?.id]);

  const mime = attachment?.mimeType ?? "";
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const zoomReset = () => setZoom(1);

  return (
    <Dialog open={attachment !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={cn(
          "flex flex-col gap-0 p-0 overflow-hidden",
          "h-[90vh] w-[95vw] max-w-275 sm:max-w-275",
          "rounded-xl",
        )}
      >
        {attachment && (
          <TooltipProvider delayDuration={300}>
            {/* Header / toolbar */}
            <div className="flex items-center gap-3 border-b bg-popover px-4 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {isPdf ? (
                  <FilePdfIcon className="size-4 shrink-0 text-red-500" />
                ) : (
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <DialogTitle className="truncate text-sm font-medium leading-none">
                  {attachment.fileName}
                </DialogTitle>
                {formatBytes(attachment.fileSize) && (
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {formatBytes(attachment.fileSize)}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {isImage && (
                  <>
                    <ToolbarButton
                      label="Zoom out"
                      onClick={zoomOut}
                      disabled={zoom <= ZOOM_MIN}
                    >
                      <MagnifyingGlassMinusIcon className="size-4" />
                    </ToolbarButton>
                    <ToolbarButton label="Reset zoom" onClick={zoomReset}>
                      <span className="text-2xs font-semibold tabular-nums">
                        {Math.round(zoom * 100)}%
                      </span>
                    </ToolbarButton>
                    <ToolbarButton
                      label="Zoom in"
                      onClick={zoomIn}
                      disabled={zoom >= ZOOM_MAX}
                    >
                      <MagnifyingGlassPlusIcon className="size-4" />
                    </ToolbarButton>
                    <ToolbarButton label="Reset zoom (100%)" onClick={zoomReset}>
                      <ArrowCounterClockwiseIcon className="size-4" />
                    </ToolbarButton>
                    <div className="mx-1 h-5 w-px bg-border" />
                  </>
                )}
                <ToolbarButton label="Download" asChild>
                  <a href={attachment.url} download={attachment.fileName}>
                    <DownloadSimpleIcon className="size-4" />
                  </a>
                </ToolbarButton>
                <ToolbarButton label="Open in new tab" asChild>
                  <a
                    href={attachment.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ArrowSquareOutIcon className="size-4" />
                  </a>
                </ToolbarButton>
                <div className="mx-1 h-5 w-px bg-border" />
                <ToolbarButton label="Close" onClick={() => onOpenChange(false)}>
                  <XIcon className="size-4" />
                </ToolbarButton>
              </div>
            </div>

            {/* Body */}
            <div className="relative flex-1 overflow-auto bg-muted/40">
              {isImage ? (
                <div className="flex min-h-full w-full items-center justify-center p-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={attachment.url}
                    alt={attachment.fileName}
                    style={{ transform: `scale(${zoom})` }}
                    className="max-h-full max-w-full origin-center object-contain transition-transform duration-150"
                  />
                </div>
              ) : isPdf ? (
                <iframe
                  src={attachment.url}
                  title={attachment.fileName}
                  className="h-full w-full border-0 bg-white"
                />
              ) : isVideo ? (
                <div className="flex h-full w-full items-center justify-center p-6">
                  <video
                    src={attachment.url}
                    controls
                    className="max-h-full max-w-full rounded-lg"
                  />
                </div>
              ) : isAudio ? (
                <div className="flex h-full w-full items-center justify-center p-6">
                  <audio src={attachment.url} controls className="w-full max-w-md" />
                </div>
              ) : (
                <UnpreviewableState attachment={attachment} />
              )}
            </div>
          </TooltipProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Toolbar button ─────────────────────────────────────────────────────────

function ToolbarButton({
  label,
  children,
  asChild,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          asChild={asChild}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ─── Unpreviewable fallback ───────────────────────────────────────────────────

function UnpreviewableState({ attachment }: { attachment: PreviewAttachment }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <FileIcon className="size-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{attachment.fileName}</p>
        <p className="text-xs text-muted-foreground">
          This file type can&apos;t be previewed here.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" asChild>
          <a href={attachment.url} download={attachment.fileName}>
            <DownloadSimpleIcon className="size-4" />
            Download
          </a>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <a href={attachment.url} target="_blank" rel="noopener noreferrer">
            <ArrowSquareOutIcon className="size-4" />
            Open in new tab
          </a>
        </Button>
      </div>
    </div>
  );
}