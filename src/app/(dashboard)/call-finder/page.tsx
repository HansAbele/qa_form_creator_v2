import { redirect } from "next/navigation";
import { getCurrentUserUiAccess, hasAnyCampaignPermission } from "@/server/queries/ui-access";
import {
  getCallFinderPageData,
  parseCallFinderFilters,
  type CallFinderSearchParams,
} from "@/server/queries/call-finder";
import { CallFinderClient } from "./call-finder-client";

export default async function CallFinderPage({
  searchParams,
}: {
  searchParams: Promise<CallFinderSearchParams>;
}) {
  if (!(await hasAnyCampaignPermission("canEvaluate"))) redirect("/forms");

  const filters = parseCallFinderFilters(await searchParams);
  const [data, access] = await Promise.all([
    getCallFinderPageData(filters),
    getCurrentUserUiAccess(),
  ]);
  return <CallFinderClient data={data} canSyncCalls={access.isAdmin} />;
}
