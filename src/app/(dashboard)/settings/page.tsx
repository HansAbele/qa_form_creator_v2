import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/server/actions/profile";
import { readSettings } from "@/server/actions/settings";
import { readCampaignScoringSettings } from "@/server/actions/campaign-scoring";
import { readOperationalAudit } from "@/server/actions/audit";
import { readQACategories } from "@/server/actions/qa-categories";
import { getAuditCampaigns, getCampaigns } from "@/server/actions/campaigns";
import { getUsers } from "@/server/actions/users";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { SettingsClient, type SettingsSectionId } from "./settings-client";

const SETTINGS_SECTION_IDS = new Set<SettingsSectionId>([
  "access",
  "scoring",
  "campaign-scoring",
  "categories",
  "evaluations",
  "forms-config",
  "dashboard-kpis",
  "reports-export",
  "audit",
]);

async function getProfileOrLogin() {
  try {
    return await getMyProfile();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "Unauthorized" || error.message === "User not found")
    ) {
      redirect("/login");
    }
    throw error;
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [profile, query] = await Promise.all([getProfileOrLogin(), searchParams]);
  if (query.section === "account") redirect("/account");
  const isAdmin = profile.role === "ADMIN";
  const canViewAudit = isAdmin || (await hasAnyCampaignPermission("canViewAudit"));
  const [settings, users, campaigns] = await Promise.all([
    readSettings(),
    isAdmin ? getUsers() : Promise.resolve([]),
    isAdmin ? getCampaigns() : canViewAudit ? getAuditCampaigns() : Promise.resolve([]),
  ]);
  const [campaignScoring, auditEvents, qaCategories] = isAdmin
    ? await Promise.all([
        readCampaignScoringSettings(campaigns.map((campaign) => campaign.id)),
        readOperationalAudit({ page: 1, pageSize: 25 }),
        readQACategories(),
      ])
    : [
        [],
        canViewAudit
          ? await readOperationalAudit({ page: 1, pageSize: 25 })
          : { events: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
        [],
      ];

  return (
    <SettingsClient
      settings={settings}
      isAdmin={isAdmin}
      canViewAudit={canViewAudit}
      accessUsers={users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        active: u.active,
        campaigns: u.campaigns,
      }))}
      accessCampaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      campaignScoring={campaignScoring}
      auditPage={auditEvents}
      qaCategories={qaCategories}
      initialSection={
        query.section && SETTINGS_SECTION_IDS.has(query.section as SettingsSectionId)
          ? (query.section as SettingsSectionId)
          : "access"
      }
    />
  );
}
