-- Block publication/version races and cross-campaign references at the database boundary.
-- The preflight checks intentionally abort the migration if legacy rows are inconsistent;
-- such rows must be reviewed instead of being silently rewritten.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Agent" a JOIN "Team" t ON t.id = a."teamId"
    WHERE a."campaignId" <> t."campaignId"
  ) THEN RAISE EXCEPTION 'Preflight failed: Agent/Team campaign mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Disposition" d JOIN "DispositionCategory" c ON c.id = d."categoryId"
    WHERE d."campaignId" <> c."campaignId"
  ) THEN RAISE EXCEPTION 'Preflight failed: Disposition/category campaign mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Form" child JOIN "Form" parent ON parent.id = child."parentFormId"
    WHERE child."campaignId" <> parent."campaignId" OR parent."parentFormId" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Preflight failed: invalid form revision family'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Response" r
    JOIN "Form" f ON f.id = r."formId"
    JOIN "Agent" a ON a.id = r."agentId"
    LEFT JOIN "Disposition" d ON d.id = r."dispositionId"
    WHERE f."campaignId" <> a."campaignId"
       OR (d.id IS NOT NULL AND f."campaignId" <> d."campaignId")
  ) THEN RAISE EXCEPTION 'Preflight failed: Response crosses campaign boundaries'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Question" q JOIN "FormCategory" fc ON fc.id = q."formCategoryId"
    WHERE q."formId" <> fc."formId"
  ) THEN RAISE EXCEPTION 'Preflight failed: Question/category form mismatch'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Answer" a
    JOIN "Response" r ON r.id = a."responseId"
    JOIN "Question" q ON q.id = a."questionId"
    WHERE r."formId" <> q."formId"
  ) THEN RAISE EXCEPTION 'Preflight failed: Answer references another form'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Form"
    GROUP BY COALESCE("parentFormId", id), version
    HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Preflight failed: duplicate version in form family'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Form"
    WHERE status = 'PUBLISHED'
    GROUP BY COALESCE("parentFormId", id)
    HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Preflight failed: multiple published forms in one family'; END IF;
END $$;

CREATE UNIQUE INDEX "Form_family_version_key"
  ON "Form" ((COALESCE("parentFormId", id)), version);

CREATE UNIQUE INDEX "Form_one_published_per_family_key"
  ON "Form" ((COALESCE("parentFormId", id)))
  WHERE status = 'PUBLISHED';

CREATE OR REPLACE FUNCTION qa_validate_reference_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'Agent' THEN
    IF NEW."teamId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Team" t
      WHERE t.id = NEW."teamId" AND t."campaignId" = NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Agent team must belong to the same campaign'; END IF;
    IF EXISTS (
      SELECT 1 FROM "Response" r JOIN "Form" f ON f.id = r."formId"
      WHERE r."agentId" = NEW.id AND f."campaignId" <> NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Agent campaign conflicts with existing responses'; END IF;

  ELSIF TG_TABLE_NAME = 'Team' THEN
    IF EXISTS (
      SELECT 1 FROM "Agent" a
      WHERE a."teamId" = NEW.id AND a."campaignId" <> NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Team campaign conflicts with assigned agents'; END IF;

  ELSIF TG_TABLE_NAME = 'Disposition' THEN
    IF NEW."categoryId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "DispositionCategory" c
      WHERE c.id = NEW."categoryId" AND c."campaignId" = NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Disposition category must belong to the same campaign'; END IF;
    IF EXISTS (
      SELECT 1 FROM "Response" r JOIN "Form" f ON f.id = r."formId"
      WHERE r."dispositionId" = NEW.id AND f."campaignId" <> NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Disposition campaign conflicts with existing responses'; END IF;

  ELSIF TG_TABLE_NAME = 'DispositionCategory' THEN
    IF EXISTS (
      SELECT 1 FROM "Disposition" d
      WHERE d."categoryId" = NEW.id AND d."campaignId" <> NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Category campaign conflicts with dispositions'; END IF;

  ELSIF TG_TABLE_NAME = 'Form' THEN
    IF NEW."parentFormId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Form" parent
      WHERE parent.id = NEW."parentFormId"
        AND parent."campaignId" = NEW."campaignId"
        AND parent."parentFormId" IS NULL
    ) THEN RAISE EXCEPTION 'Form revision must reference a root form in the same campaign'; END IF;
    IF NEW."parentFormId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "Form" child WHERE child."parentFormId" = NEW.id
    ) THEN RAISE EXCEPTION 'A form with revisions cannot itself become a revision'; END IF;
    IF EXISTS (
      SELECT 1 FROM "Form" child
      WHERE child."parentFormId" = NEW.id AND child."campaignId" <> NEW."campaignId"
    ) THEN RAISE EXCEPTION 'Form campaign conflicts with its revisions'; END IF;
    IF EXISTS (
      SELECT 1
      FROM "Response" r
      JOIN "Agent" a ON a.id = r."agentId"
      LEFT JOIN "Disposition" d ON d.id = r."dispositionId"
      WHERE r."formId" = NEW.id
        AND (a."campaignId" <> NEW."campaignId"
          OR (d.id IS NOT NULL AND d."campaignId" <> NEW."campaignId"))
    ) THEN RAISE EXCEPTION 'Form campaign conflicts with existing responses'; END IF;

  ELSIF TG_TABLE_NAME = 'FormCategory' THEN
    IF EXISTS (
      SELECT 1 FROM "Question" q
      WHERE q."formCategoryId" = NEW.id AND q."formId" <> NEW."formId"
    ) THEN RAISE EXCEPTION 'Form category conflicts with assigned questions'; END IF;

  ELSIF TG_TABLE_NAME = 'Question' THEN
    IF NEW."formCategoryId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "FormCategory" fc
      WHERE fc.id = NEW."formCategoryId" AND fc."formId" = NEW."formId"
    ) THEN RAISE EXCEPTION 'Question category must belong to the same form'; END IF;
    IF EXISTS (
      SELECT 1 FROM "Answer" a JOIN "Response" r ON r.id = a."responseId"
      WHERE a."questionId" = NEW.id AND r."formId" <> NEW."formId"
    ) THEN RAISE EXCEPTION 'Question form conflicts with existing answers'; END IF;

  ELSIF TG_TABLE_NAME = 'Response' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Form" f JOIN "Agent" a ON a.id = NEW."agentId"
      WHERE f.id = NEW."formId" AND f."campaignId" = a."campaignId"
    ) THEN RAISE EXCEPTION 'Response form and agent must belong to the same campaign'; END IF;
    IF NEW."dispositionId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Form" f JOIN "Disposition" d ON d.id = NEW."dispositionId"
      WHERE f.id = NEW."formId" AND f."campaignId" = d."campaignId"
    ) THEN RAISE EXCEPTION 'Response disposition must belong to the form campaign'; END IF;
    IF EXISTS (
      SELECT 1 FROM "Answer" a JOIN "Question" q ON q.id = a."questionId"
      WHERE a."responseId" = NEW.id AND q."formId" <> NEW."formId"
    ) THEN RAISE EXCEPTION 'Response form conflicts with existing answers'; END IF;

  ELSIF TG_TABLE_NAME = 'Answer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Response" r JOIN "Question" q ON q.id = NEW."questionId"
      WHERE r.id = NEW."responseId" AND r."formId" = q."formId"
    ) THEN RAISE EXCEPTION 'Answer question must belong to the response form'; END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER "Agent_campaign_integrity"
AFTER INSERT OR UPDATE OF "campaignId", "teamId" ON "Agent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "Team_campaign_integrity"
AFTER UPDATE OF "campaignId" ON "Team"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "Disposition_campaign_integrity"
AFTER INSERT OR UPDATE OF "campaignId", "categoryId" ON "Disposition"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "DispositionCategory_campaign_integrity"
AFTER UPDATE OF "campaignId" ON "DispositionCategory"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "Form_campaign_integrity"
AFTER INSERT OR UPDATE OF "campaignId", "parentFormId" ON "Form"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "FormCategory_form_integrity"
AFTER UPDATE OF "formId" ON "FormCategory"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "Question_form_integrity"
AFTER INSERT OR UPDATE OF "formId", "formCategoryId" ON "Question"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "Response_campaign_integrity"
AFTER INSERT OR UPDATE OF "formId", "agentId", "dispositionId" ON "Response"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();
CREATE CONSTRAINT TRIGGER "Answer_form_integrity"
AFTER INSERT OR UPDATE OF "responseId", "questionId" ON "Answer"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity();

-- These constraints are security boundaries and must also fire in replication
-- sessions. The runtime role is independently denied session_replication_role.
ALTER TABLE "Agent" ENABLE ALWAYS TRIGGER "Agent_campaign_integrity";
ALTER TABLE "Answer" ENABLE ALWAYS TRIGGER "Answer_form_integrity";
ALTER TABLE "DispositionCategory" ENABLE ALWAYS TRIGGER "DispositionCategory_campaign_integrity";
ALTER TABLE "Disposition" ENABLE ALWAYS TRIGGER "Disposition_campaign_integrity";
ALTER TABLE "FormCategory" ENABLE ALWAYS TRIGGER "FormCategory_form_integrity";
ALTER TABLE "Form" ENABLE ALWAYS TRIGGER "Form_campaign_integrity";
ALTER TABLE "Question" ENABLE ALWAYS TRIGGER "Question_form_integrity";
ALTER TABLE "Response" ENABLE ALWAYS TRIGGER "Response_campaign_integrity";
ALTER TABLE "Team" ENABLE ALWAYS TRIGGER "Team_campaign_integrity";

COMMIT;
