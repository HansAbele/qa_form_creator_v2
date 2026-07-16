\set ON_ERROR_STOP on

-- Fail closed when campaign or form boundaries have been violated. These
-- checks intentionally duplicate the migration preflight so they can be run
-- after every deploy and against every disaster-recovery restore.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Agent" a JOIN "Team" t ON t.id = a."teamId"
    WHERE a."campaignId" <> t."campaignId"
  ) THEN RAISE EXCEPTION 'Integrity failed: Agent/Team campaign mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Disposition" d JOIN "DispositionCategory" c ON c.id = d."categoryId"
    WHERE d."campaignId" <> c."campaignId"
  ) THEN RAISE EXCEPTION 'Integrity failed: Disposition/category campaign mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Form" child JOIN "Form" parent ON parent.id = child."parentFormId"
    WHERE child."campaignId" <> parent."campaignId" OR parent."parentFormId" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Integrity failed: invalid form revision family'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Response" r
    JOIN "Form" f ON f.id = r."formId"
    JOIN "Agent" a ON a.id = r."agentId"
    LEFT JOIN "Disposition" d ON d.id = r."dispositionId"
    WHERE f."campaignId" <> a."campaignId"
       OR (d.id IS NOT NULL AND f."campaignId" <> d."campaignId")
  ) THEN RAISE EXCEPTION 'Integrity failed: Response crosses campaign boundaries'; END IF;

  IF EXISTS (
    SELECT 1 FROM "Question" q JOIN "FormCategory" fc ON fc.id = q."formCategoryId"
    WHERE q."formId" <> fc."formId"
  ) THEN RAISE EXCEPTION 'Integrity failed: Question/category form mismatch'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Answer" a
    JOIN "Response" r ON r.id = a."responseId"
    JOIN "Question" q ON q.id = a."questionId"
    WHERE r."formId" <> q."formId"
  ) THEN RAISE EXCEPTION 'Integrity failed: Answer references another form'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Form"
    GROUP BY COALESCE("parentFormId", id), version
    HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Integrity failed: duplicate version in form family'; END IF;

  IF EXISTS (
    SELECT 1
    FROM "Form"
    WHERE status = 'PUBLISHED'
    GROUP BY COALESCE("parentFormId", id)
    HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Integrity failed: multiple published forms in one family'; END IF;
END $$;

SELECT json_build_object(
  'users', (SELECT count(*) FROM "User"),
  'campaigns', (SELECT count(*) FROM "Campaign"),
  'forms', (SELECT count(*) FROM "Form"),
  'submittedResponses', (SELECT count(*) FROM "Response" WHERE status = 'SUBMITTED'),
  'answers', (SELECT count(*) FROM "Answer"),
  'auditEvents', (SELECT count(*) FROM "AuditLog")
) AS verified_row_counts;
