"use client";

import { ShieldCheckIcon, WarningIcon } from "@phosphor-icons/react";
import type { TcpMapping } from "@/components/tcp-mappings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

interface TcpWhitelistEditorProps {
  canManage: boolean;
  isEditing: boolean;
  isMutating: boolean;
  mapping: TcpMapping;
  onCancel: () => void;
  onSave: (mappingId: string) => void;
  onStartEdit: (mapping: TcpMapping) => void;
  onWhitelistInputChange: (value: string) => void;
  whitelistInput: string;
}

export function TcpWhitelistEditor({
  mapping,
  isEditing,
  whitelistInput,
  onWhitelistInputChange,
  onSave,
  onStartEdit,
  onCancel,
  isMutating,
  canManage,
}: TcpWhitelistEditorProps) {
  if (isEditing) {
    return (
      <div className="border-t pt-2">
        <div className="space-y-2">
          <Label className="text-xs">
            Whitelisted IPs (one per line or comma-separated)
          </Label>
          <Input
            disabled={isMutating}
            onChange={(e) => onWhitelistInputChange(e.target.value)}
            placeholder="203.0.113.0/24, 198.51.100.5"
            value={whitelistInput}
          />
          {!whitelistInput.trim() && (
            <p className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
              <WarningIcon className="size-3.5 shrink-0" />
              Clearing the whitelist makes this port publicly accessible.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              disabled={isMutating}
              onClick={() => onSave(mapping.id)}
              size="sm"
            >
              {isMutating && <Spinner className="size-4" />}
              Save
            </Button>
            <Button
              disabled={isMutating}
              onClick={onCancel}
              size="sm"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t pt-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs">
          {mapping.whitelistedIps.length > 0 ? (
            <>
              <ShieldCheckIcon className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
              <span className="text-muted-foreground">
                Whitelisted:{" "}
                <span className="font-mono">
                  {mapping.whitelistedIps.map((w) => w.cidr).join(", ")}
                </span>
              </span>
            </>
          ) : (
            <>
              <WarningIcon className="size-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <span className="text-yellow-600 dark:text-yellow-400">
                Publicly accessible — no IP whitelist
              </span>
            </>
          )}
        </div>
        {canManage && mapping.status === "active" && (
          <Button
            className="text-xs"
            onClick={() => onStartEdit(mapping)}
            size="sm"
            variant="ghost"
          >
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}
