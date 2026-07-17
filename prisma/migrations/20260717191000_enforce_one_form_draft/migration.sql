-- A logical form can have one active definition and at most one pending draft.
-- Abort instead of guessing which legacy draft should survive.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Form"
    WHERE status = 'DRAFT'
    GROUP BY COALESCE("parentFormId", id)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: multiple drafts in one form family';
  END IF;
END $$;

CREATE UNIQUE INDEX "Form_one_draft_per_family_key"
  ON "Form" ((COALESCE("parentFormId", id)))
  WHERE status = 'DRAFT';
