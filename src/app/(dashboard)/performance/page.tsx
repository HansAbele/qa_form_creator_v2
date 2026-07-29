import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPerformanceWorkspace } from "@/server/queries/performance-management";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";
import { PerformanceClient } from "./performance-client";

export default async function PerformancePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const access = await getCurrentUserUiAccess();
  const canOpenPerformance =
    access.canViewCoaching ||
    access.canManageCoaching ||
    access.canTrackQaActivity ||
    access.canViewQaActivity ||
    access.canViewPips ||
    access.canManagePips;

  if (!canOpenPerformance) redirect("/");

  const data = await getPerformanceWorkspace();
  return <PerformanceClient data={data} />;
}
