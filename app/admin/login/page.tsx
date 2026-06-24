import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { PRODUCT_NAME } from "@/config/platform";
import { AdminLoginForm } from "./_components/admin-login-form";

export const metadata = { title: `Admin Sign In — ${PRODUCT_NAME}` };

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect("/admin");

  return (
    <div className="relative flex h-full overflow-auto items-center justify-center bg-slate-950 p-4">
      {/* Ambient accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-120 w-120 -translate-x-1/2 -translate-y-1/3 rounded-full bg-emerald-500/15 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.04] bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-size-[32px_32px]"
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30">
            <svg
              className="h-6 w-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            Admin Console
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Restricted to platform operators
          </p>
        </div>
        <AdminLoginForm />
        <p className="mt-6 text-center text-xs text-slate-600">
          {PRODUCT_NAME} · Internal Operations
        </p>
      </div>
    </div>
  );
}
