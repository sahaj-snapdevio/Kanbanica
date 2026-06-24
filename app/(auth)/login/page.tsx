import { redirect } from "next/navigation";
import { PRODUCT_NAME } from "@/config/platform";
import { getCurrentSession } from "@/lib/authz";
import { LoginForm } from "../_components/auth-form";
import { WatermarkBackground } from "../_components/watermark-background";

export const metadata = { title: `Sign in — ${PRODUCT_NAME}` };

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect("/post-auth");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[#F2F2F2] p-4">
      <WatermarkBackground />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="font-bold text-2xl text-[#174D38] tracking-tight">
            {PRODUCT_NAME}
          </span>
          <p className="mt-1 text-[#6b7280] text-sm">
            Project management for modern teams
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
