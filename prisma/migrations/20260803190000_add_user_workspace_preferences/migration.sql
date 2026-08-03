-- Personal workflow defaults are intentionally stored on the user instead of
-- AppSetting so QA users can customize their workspace without changing
-- organization-wide scoring or campaign configuration.
ALTER TABLE "User" ADD COLUMN "workspacePreferences" JSONB;
