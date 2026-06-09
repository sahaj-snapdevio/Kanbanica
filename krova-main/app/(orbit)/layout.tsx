import { redirect } from "next/navigation";
import { OrbitShell } from "@/components/orbit/orbit-shell";
import { getSession } from "@/lib/server/session";
import { getPusherClientConfig } from "@/lib/service-config";

export default async function OrbitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const role = (session.user as { role?: string | null }).role;
  if (role !== "admin") {
    redirect("/");
  }

  // Pusher config must be loaded server-side and threaded into the shell so
  // the client can `initPusherConfig` before any usePusherChannel hooks run.
  // Without this, every `private-server-*` / `private-cube-*` subscription
  // returns null and the UI silently falls back to SWR polling.
  const pusherConfig = await getPusherClientConfig();

  return <OrbitShell pusherConfig={pusherConfig}>{children}</OrbitShell>;
}
