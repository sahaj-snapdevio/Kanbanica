import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/authz";
import { PRODUCT_NAME } from "@/config/platform";
import { LoginFormFlat } from "../_components/auth-form";
import { WatermarkBackground } from "../_components/watermark-background";

export const metadata = { title: `Sign in — ${PRODUCT_NAME}` };

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect("/post-auth");

  return (
    <div className="force-light relative flex min-h-screen items-center justify-center bg-[#eef2ee] p-4 sm:p-6">
      <WatermarkBackground />

      {/* Modal card */}
      <div className="relative z-10 flex w-full max-w-4xl overflow-hidden rounded-2xl shadow-2xl bg-white">

        {/* Left — form */}
        <div className="flex w-full flex-col justify-center px-8 py-10 sm:px-10 lg:w-[46%]">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <Image
              alt={`${PRODUCT_NAME} Logo`}
              className="h-10 w-auto object-contain"
              height={52}
              src="/Kanbanica2.png"
              width={200}
              priority
            />
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Sign in.</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your email and we'll send you a magic link — no password needed.
            </p>
          </div>

          <LoginFormFlat />
        </div>

        {/* Right — illustration */}
        <div className="hidden lg:flex lg:w-[54%] flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#e6f4ec] via-[#ddf0e6] to-[#cce8d8] px-10 py-10 relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-16 -right-16 size-56 rounded-full bg-white/20" />
          <div className="absolute -bottom-12 -left-12 size-40 rounded-full bg-white/15" />

          <div className="relative z-10 flex flex-col items-center text-center gap-3">
            <p className="text-sm font-medium text-[#3d6b52] tracking-wide uppercase">
              Nice to see you again
            </p>
            <h2 className="text-3xl font-bold text-[#1a4d32] leading-tight">
              Welcome back
            </h2>
          </div>

          <div className="relative z-10 w-full max-w-sm">
            <Image
              src="/log-illus.png"
              alt=""
              width={500}
              height={500}
              className="h-auto w-full object-contain drop-shadow-sm"
              priority
              aria-hidden="true"
            />
          </div>

          <p className="relative z-10 text-xs text-[#4d7a62] text-center max-w-xs">
            Manage projects, track progress, and ship faster — all in one place.
          </p>
        </div>
      </div>
    </div>
  );
}
