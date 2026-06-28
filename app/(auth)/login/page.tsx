import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/authz";
import { PRODUCT_NAME } from "@/config/platform";
import { LoginForm } from "../_components/auth-form";
import { WatermarkBackground } from "../_components/watermark-background";

export const metadata = { title: `Sign in — ${PRODUCT_NAME}` };

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect("/post-auth");

    return (
    <div className="force-light relative flex h-full bg-[#F2F2F2]">
      <WatermarkBackground />

      {/* Left — existing login form, unchanged */}
      <div className="relative z-10 flex w-full items-center justify-center overflow-auto p-4 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <span className="flex items-center justify-center gap-2 font-bold text-base text-[#174D38]">
              <Image
                alt={`${PRODUCT_NAME} Logo`}
                className="h-7 w-auto object-contain"
                height={38}
                src="/Kanbanica2.png"
                width={140}
              />
            </span>
            <p className="mt-1 text-[#6b7280] text-sm">Project management for modern teams</p>
          </div>
          <LoginForm />
        </div>
      </div>

      {/* Right — illustration only, no other content */}
      <div className="relative z-10 hidden items-center justify-center p-8 lg:flex lg:w-1/2">
        <Image
          src="/log-illu.png"
          alt=""
          width={600}
          height={600}
          className="h-auto w-full max-w-lg object-contain"
          priority
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
