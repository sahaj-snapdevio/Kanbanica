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
    <div className="force-light relative flex h-full overflow-auto items-center justify-center bg-[#F2F2F2] p-4">
      <WatermarkBackground />
      <div className="relative z-10 w-full max-w-sm">
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
  );
}
