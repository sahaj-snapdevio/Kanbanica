"use client";

import {
  ArrowClockwiseIcon,
  CopyIcon,
  PencilSimpleIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import type { TcpMapping } from "@/components/tcp-mappings";
import { TcpWhitelistEditor } from "@/components/tcp-whitelist-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { copyToClipboard } from "@/lib/clipboard";
import { RESOURCE_STATUS_CLASSES } from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface TcpMappingCardProps {
  canManage: boolean;
  // SSH port edit state
  isEditingSshPort: boolean;
  // Whitelist state
  isEditingWhitelist: boolean;
  isMutating: boolean;
  isRefreshing: boolean;
  mapping: TcpMapping;
  newSshPort: string;
  onCancelEditSshPort: () => void;
  onCancelEditWhitelist: () => void;
  onNewSshPortChange: (value: string) => void;
  // Log viewer
  onOpenLogs: (mapping: TcpMapping) => void;
  onRefresh: () => void;
  onRemove: (mappingId: string) => void;
  onSaveSshPort: (mappingId: string) => void;
  onSaveWhitelist: (mappingId: string) => void;
  onStartEditSshPort: (mappingId: string, currentPort: number) => void;
  onStartEditWhitelist: (mapping: TcpMapping) => void;
  // SSH exposure toggle
  onToggleSshExposure: (mappingId: string, enabled: boolean) => void;
  onWhitelistInputChange: (value: string) => void;
  serverDomain: string;
  sshPortError: string | null;
  whitelistInput: string;
}

export function TcpMappingCard({
  mapping,
  serverDomain,
  canManage,
  isMutating,
  isRefreshing,
  onRefresh,
  onRemove,
  isEditingWhitelist,
  whitelistInput,
  onWhitelistInputChange,
  onSaveWhitelist,
  onStartEditWhitelist,
  onCancelEditWhitelist,
  isEditingSshPort,
  newSshPort,
  sshPortError,
  onNewSshPortChange,
  onStartEditSshPort,
  onSaveSshPort,
  onCancelEditSshPort,
  onOpenLogs,
  onToggleSshExposure,
}: TcpMappingCardProps) {
  const connectionString = `${serverDomain}:${mapping.hostPort}`;
  const sshToggleId = `ssh-toggle-${mapping.id}`;
  const sshExposureEnabled = mapping.status === "active";
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">
              :{mapping.cubePort}
            </span>
            {mapping.label && (
              <span className="text-sm text-muted-foreground">
                {mapping.label}
              </span>
            )}
            <Badge
              className={cn(
                "border-0 text-xs",
                RESOURCE_STATUS_CLASSES[mapping.status]
              )}
              variant="secondary"
            >
              {mapping.status}
            </Badge>
            {mapping.isSsh && (
              <Badge
                className="border-0 bg-blue-500/10 text-xs text-blue-600 dark:text-blue-400"
                variant="secondary"
              >
                SSH
              </Badge>
            )}
            {(mapping.status === "pending" ||
              mapping.status === "stopping") && (
              <Button
                disabled={isRefreshing}
                onClick={onRefresh}
                size="icon-xs"
                variant="ghost"
              >
                <ArrowClockwiseIcon
                  className={cn("size-3.5", isRefreshing && "animate-spin")}
                />
              </Button>
            )}
            {mapping.isSsh && mapping.status === "disabled" && (
              <span className="text-xs text-muted-foreground">
                Host port reserved — re-enable to reconnect
              </span>
            )}
          </div>
          {mapping.status === "active" && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                Connect: <code className="font-mono">{connectionString}</code>
              </span>
              <Button
                onClick={() => copyToClipboard(connectionString)}
                size="icon-xs"
                variant="ghost"
              >
                <CopyIcon className="size-3" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManage &&
            mapping.isSsh &&
            (mapping.status === "active" || mapping.status === "disabled") && (
              <div className="flex items-center gap-1.5">
                <Label
                  className="text-xs text-muted-foreground"
                  htmlFor={sshToggleId}
                >
                  Exposed
                </Label>
                <Switch
                  aria-label="Toggle SSH exposure"
                  checked={sshExposureEnabled}
                  disabled={isMutating}
                  id={sshToggleId}
                  onCheckedChange={(next) =>
                    onToggleSshExposure(mapping.id, next)
                  }
                />
              </div>
            )}
          {canManage && mapping.isSsh && mapping.status === "active" && (
            <Button
              disabled={isMutating}
              onClick={() => onStartEditSshPort(mapping.id, mapping.cubePort)}
              size="icon-sm"
              title="Change SSH internal port"
              variant="ghost"
            >
              <PencilSimpleIcon className="size-4 text-muted-foreground" />
            </Button>
          )}
          {mapping.status === "active" && (
            <Button
              onClick={() => onOpenLogs(mapping)}
              size="icon-sm"
              title="View live logs"
              variant="ghost"
            >
              <TerminalIcon className="size-4 text-muted-foreground" />
            </Button>
          )}
          {canManage && !mapping.isSsh && (
            <>
              <Button
                disabled={isMutating}
                onClick={() => setRemoveOpen(true)}
                size="icon-sm"
                variant="ghost"
              >
                <TrashIcon className="size-4 text-destructive" />
              </Button>
              <ConfirmActionDialog
                confirmLabel="Remove"
                description={
                  <p>
                    Remove port {mapping.cubePort} mapping
                    {mapping.label ? ` (${mapping.label})` : ""}? The host port
                    will be released.
                  </p>
                }
                onConfirm={() => {
                  setRemoveOpen(false);
                  onRemove(mapping.id);
                }}
                onOpenChange={setRemoveOpen}
                open={removeOpen}
                title="Remove TCP Port Mapping"
              />
            </>
          )}
        </div>
      </div>

      {/* Whitelist section */}
      <TcpWhitelistEditor
        canManage={canManage}
        isEditing={isEditingWhitelist}
        isMutating={isMutating}
        mapping={mapping}
        onCancel={onCancelEditWhitelist}
        onSave={onSaveWhitelist}
        onStartEdit={onStartEditWhitelist}
        onWhitelistInputChange={onWhitelistInputChange}
        whitelistInput={whitelistInput}
      />

      {isEditingSshPort && (
        <div className="space-y-2 border-t px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Internal SSH port:
            </span>
            <Input
              aria-invalid={!!sshPortError}
              aria-label="Internal SSH port"
              className="h-8 w-24 font-mono text-sm"
              max={65_535}
              min={1}
              onChange={(e) => onNewSshPortChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSaveSshPort(mapping.id);
                }
              }}
              type="number"
              value={newSshPort}
            />
            <Button
              disabled={isMutating}
              onClick={() => onSaveSshPort(mapping.id)}
              size="sm"
            >
              Save
            </Button>
            <Button onClick={onCancelEditSshPort} size="sm" variant="ghost">
              Cancel
            </Button>
          </div>
          {sshPortError && (
            <p className="text-sm text-destructive">{sshPortError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            The port your sshd is listening on <em>inside the Cube</em>. Default
            is <span className="font-mono">22</span>, but if you reconfigured
            sshd to listen on a different port (e.g.{" "}
            <span className="font-mono">2222</span> for hardening), set that
            here so the host port forwards to the right destination. This
            updates the iptables DNAT rule on the host — your in-Cube sshd
            config is not modified.
          </p>
        </div>
      )}
    </div>
  );
}
