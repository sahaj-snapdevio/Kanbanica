import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/authz";
import { LoginForm } from "../_components/auth-form";

export const metadata = { title: "Sign in — Kanbanica" };

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect("/post-auth");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f9fafb] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="font-bold text-2xl text-indigo-600 tracking-tight">Kanbanica</span>
          <p className="mt-1 text-[#6b7280] text-sm">Project management for modern teams</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
