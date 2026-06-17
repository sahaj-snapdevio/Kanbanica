"use client";

import { authClient, useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export function ImpersonationBanner() {
  const { data: session } = useSession();
  const router = useRouter();

  const impersonatedBy = (session?.session as { impersonatedBy?: string } | null)?.impersonatedBy;
  if (!impersonatedBy) return null;

  async function handleStop() {
    await (authClient as any).admin?.stopImpersonating?.();
    router.push("/admin/users");
  }

  return (
    <div className="bg-red-600 text-white text-sm flex items-center justify-center gap-3 px-4 py-2 z-50 shrink-0">
      <span>
        You are viewing as <strong>{session?.user?.name ?? session?.user?.email}</strong> (impersonation mode)
      </span>
      <button
        onClick={handleStop}
        className="underline hover:no-underline font-medium"
      >
        Exit impersonation
      </button>
    </div>
  );
}
