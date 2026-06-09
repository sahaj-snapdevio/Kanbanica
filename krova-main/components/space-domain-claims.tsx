"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircleIcon,
  CopyIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  createDomainClaim,
  releaseDomainClaim,
  verifyDomainClaim,
} from "@/app/actions/domain-claims";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { LocalDate } from "@/components/local-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { copyToClipboard } from "@/lib/clipboard";
import { claimTxtHost, claimTxtValue } from "@/lib/domains/claim-coverage";
import {
  type DomainClaimStatus,
  domainClaimStatusVariant,
} from "@/lib/status-display";

export interface DomainClaimRow {
  createdAt: string;
  domain: string;
  id: string;
  status: DomainClaimStatus;
  token: string;
  verifiedAt: string | null;
}

interface SpaceDomainClaimsProps {
  canManage: boolean;
  claims: DomainClaimRow[];
  spaceId: string;
}

const claimSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
});
type ClaimFormValues = z.infer<typeof claimSchema>;

export function SpaceDomainClaims({
  spaceId,
  claims,
  canManage,
}: SpaceDomainClaimsProps) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [releaseTarget, setReleaseTarget] = useState<DomainClaimRow | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  const form = useForm<ClaimFormValues>({
    resolver: zodResolver(claimSchema),
    defaultValues: { domain: "" },
    mode: "onChange",
  });

  function handleClaim(values: ClaimFormValues) {
    startTransition(async () => {
      const result = await createDomainClaim(spaceId, values.domain.trim());
      if ("error" in result) {
        form.setError("root", { message: result.error });
        return;
      }
      toast.success(
        `Claim added for ${result.domain} — add the TXT record, then Verify`
      );
      form.reset();
      setAddOpen(false);
      router.refresh();
    });
  }

  function handleVerify(claim: DomainClaimRow) {
    setBusyId(claim.id);
    startTransition(async () => {
      const result = await verifyDomainClaim(spaceId, claim.id);
      setBusyId(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${claim.domain} verified and locked to this space`);
      router.refresh();
    });
  }

  function handleReleaseConfirm() {
    if (!releaseTarget) {
      return;
    }
    const target = releaseTarget;
    setReleaseTarget(null);
    setBusyId(target.id);
    startTransition(async () => {
      const result = await releaseDomainClaim(spaceId, target.id);
      setBusyId(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Released ${target.domain}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Lock a domain to this space. Once verified, no other space can map it
          or any of its subdomains.
        </p>
        {canManage && (
          <Sheet
            onOpenChange={(open) => {
              setAddOpen(open);
              if (!open) {
                form.reset();
              }
            }}
            open={addOpen}
          >
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                <PlusIcon className="size-4" />
                Claim a domain
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Claim a domain</SheetTitle>
                <SheetDescription>
                  Enter the registrable domain you own (e.g.{" "}
                  <code className="font-mono">acme.com</code>). It covers that
                  domain and every subdomain. After you click Add, we&apos;ll
                  show a TXT record to add at your DNS — then Verify.
                </SheetDescription>
              </SheetHeader>
              <Form {...form}>
                <form
                  className="space-y-4 px-4 pb-4"
                  onSubmit={form.handleSubmit(handleClaim)}
                >
                  <FormField
                    control={form.control}
                    name="domain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Domain</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isPending}
                            placeholder="acme.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {form.formState.errors.root && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.root.message}
                    </p>
                  )}
                  <Button
                    className="w-full"
                    disabled={!form.formState.isValid || isPending}
                    type="submit"
                  >
                    {isPending && <Spinner className="size-4" />}
                    Add
                  </Button>
                </form>
              </Form>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {claims.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No domains claimed yet.
        </p>
      ) : (
        <div className="space-y-3">
          {claims.map((claim) => (
            <div className="rounded-md border p-3" key={claim.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {claim.status === "verified" ? (
                    <ShieldCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <ShieldCheckIcon className="size-4 text-muted-foreground" />
                  )}
                  <span className="font-mono text-sm font-medium">
                    {claim.domain}
                  </span>
                  <Badge variant={domainClaimStatusVariant(claim.status)}>
                    {claim.status === "verified" ? "Locked" : claim.status}
                  </Badge>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    {claim.status !== "verified" && (
                      <Button
                        disabled={isPending && busyId === claim.id}
                        onClick={() => handleVerify(claim)}
                        size="sm"
                        variant="outline"
                      >
                        {isPending && busyId === claim.id ? (
                          <Spinner className="size-4" />
                        ) : (
                          <CheckCircleIcon className="size-4" />
                        )}
                        Verify
                      </Button>
                    )}
                    <Button
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={isPending && busyId === claim.id}
                      onClick={() => setReleaseTarget(claim)}
                      size="sm"
                      variant="ghost"
                    >
                      <TrashIcon className="size-4" />
                      Release
                    </Button>
                  </div>
                )}
              </div>

              {claim.status === "verified" ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Verified{" "}
                  {claim.verifiedAt && (
                    <LocalDate iso={claim.verifiedAt} mode="relative" />
                  )}{" "}
                  — this domain and its subdomains are locked to this space.
                </p>
              ) : (
                <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">
                    Add this TXT record at your DNS provider, then click Verify:
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      Name
                    </span>
                    <code className="flex-1 truncate font-mono text-xs">
                      {claimTxtHost(claim.domain)}
                    </code>
                    <Button
                      aria-label="Copy TXT name"
                      onClick={() =>
                        copyToClipboard(claimTxtHost(claim.domain))
                      }
                      size="icon-xs"
                      variant="ghost"
                    >
                      <CopyIcon className="size-3" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      Value
                    </span>
                    <code className="flex-1 truncate font-mono text-xs">
                      {claimTxtValue(claim.token)}
                    </code>
                    <Button
                      aria-label="Copy TXT value"
                      onClick={() =>
                        copyToClipboard(claimTxtValue(claim.token))
                      }
                      size="icon-xs"
                      variant="ghost"
                    >
                      <CopyIcon className="size-3" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmActionDialog
        confirmLabel="Release"
        description={
          <p>
            Release the lock on{" "}
            <strong className="text-foreground">{releaseTarget?.domain}</strong>
            ? Other spaces will be able to claim it. Your existing domain
            mappings are not affected.
          </p>
        }
        onConfirm={handleReleaseConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setReleaseTarget(null);
          }
        }}
        open={!!releaseTarget}
        title="Release domain lock"
      />
    </div>
  );
}
