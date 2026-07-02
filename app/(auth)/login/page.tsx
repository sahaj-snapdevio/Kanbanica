import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/authz";
import { LOGO_PATH, PRODUCT_NAME } from "@/config/platform";
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
              src={LOGO_PATH}
              width={200}
              priority
            />
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-[28px] font-bold text-foreground tracking-tight leading-tight">Sign in</h1>
            <p className="mt-1 text-sm leading-relaxed text-foreground/70">
              Enter your work email and we&apos;ll send a secure sign-in link — no password to remember.
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
            <p className="text-xs font-semibold text-[#3d6b52] tracking-eyebrow uppercase">
              Project management, simplified
            </p>
            <h2 className="text-[32px] font-bold text-[#1a4d32] leading-[1.15] tracking-tight">
              Everything your team needs to ship
            </h2>
          </div>

          <div className="relative z-10 w-full max-w-sm">
            <Image
              src="/log-illus.webp"
              alt=""
              width={500}
              height={500}
              className="h-auto w-full object-contain drop-shadow-sm"
              priority
              aria-hidden="true"
            />
          </div>

          <p className="relative z-10 text-sm leading-relaxed text-[#3d6b52] text-center max-w-xs">
            Plan sprints, track tasks, and keep every project moving — all in one workspace.
          </p>
        </div>
      </div>
    </div>
  );
}
