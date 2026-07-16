WITH expected_trigger(trigger_name, table_name, trigger_definition) AS (
  VALUES
    (
      'Agent_campaign_integrity',
      'Agent',
      'CREATE CONSTRAINT TRIGGER "Agent_campaign_integrity" AFTER INSERT OR UPDATE OF "campaignId", "teamId" ON public."Agent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'Answer_form_integrity',
      'Answer',
      'CREATE CONSTRAINT TRIGGER "Answer_form_integrity" AFTER INSERT OR UPDATE OF "responseId", "questionId" ON public."Answer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'DispositionCategory_campaign_integrity',
      'DispositionCategory',
      'CREATE CONSTRAINT TRIGGER "DispositionCategory_campaign_integrity" AFTER UPDATE OF "campaignId" ON public."DispositionCategory" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'Disposition_campaign_integrity',
      'Disposition',
      'CREATE CONSTRAINT TRIGGER "Disposition_campaign_integrity" AFTER INSERT OR UPDATE OF "campaignId", "categoryId" ON public."Disposition" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'FormCategory_form_integrity',
      'FormCategory',
      'CREATE CONSTRAINT TRIGGER "FormCategory_form_integrity" AFTER UPDATE OF "formId" ON public."FormCategory" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'Form_campaign_integrity',
      'Form',
      'CREATE CONSTRAINT TRIGGER "Form_campaign_integrity" AFTER INSERT OR UPDATE OF "campaignId", "parentFormId" ON public."Form" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'Question_form_integrity',
      'Question',
      'CREATE CONSTRAINT TRIGGER "Question_form_integrity" AFTER INSERT OR UPDATE OF "formId", "formCategoryId" ON public."Question" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'Response_campaign_integrity',
      'Response',
      'CREATE CONSTRAINT TRIGGER "Response_campaign_integrity" AFTER INSERT OR UPDATE OF "formId", "agentId", "dispositionId" ON public."Response" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    ),
    (
      'Team_campaign_integrity',
      'Team',
      'CREATE CONSTRAINT TRIGGER "Team_campaign_integrity" AFTER UPDATE OF "campaignId" ON public."Team" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qa_validate_reference_integrity()'
    )
), actual_trigger AS (
  SELECT
    trigger_object.tgname AS trigger_name,
    table_object.relname AS table_name,
    trigger_object.tgenabled,
    trigger_object.tgdeferrable,
    trigger_object.tginitdeferred,
    trigger_object.tgconstraint,
    pg_get_triggerdef(trigger_object.oid, false) AS trigger_definition
  FROM pg_trigger trigger_object
  JOIN pg_class table_object ON table_object.oid = trigger_object.tgrelid
  JOIN pg_namespace table_schema ON table_schema.oid = table_object.relnamespace
  WHERE trigger_object.tgfoid = 'public.qa_validate_reference_integrity()'::regprocedure
    AND NOT trigger_object.tgisinternal
    AND table_schema.nspname = 'public'
)
SELECT
  COALESCE((
    SELECT
      md5(function_object.prosrc) = 'c3051eeee98a6e6eeb179271339081be'
      AND function_object.proconfig = ARRAY['search_path=pg_catalog, public']
      AND NOT function_object.prosecdef
      AND function_object.provolatile = 'v'
      AND NOT function_object.proleakproof
      AND NOT function_object.proisstrict
      AND function_object.proparallel = 'u'
      AND function_object.pronargs = 0
      AND function_object.prorettype = 'trigger'::regtype
      AND function_object.prolang = (
        SELECT language_object.oid FROM pg_language language_object
        WHERE language_object.lanname = 'plpgsql'
      )
      AND function_object.proowner = (
        SELECT role_object.oid FROM pg_roles role_object
        WHERE role_object.rolname = :'owner_user'
      )
    FROM pg_proc function_object
    WHERE function_object.oid = 'public.qa_validate_reference_integrity()'::regprocedure
  ), false)
  AND (SELECT count(*) = 9 FROM actual_trigger)
  AND NOT EXISTS (
    SELECT 1
    FROM expected_trigger
    LEFT JOIN actual_trigger USING (trigger_name, table_name, trigger_definition)
    WHERE actual_trigger.trigger_name IS NULL
       OR actual_trigger.tgenabled <> 'A'
       OR NOT actual_trigger.tgdeferrable
       OR NOT actual_trigger.tginitdeferred
       OR actual_trigger.tgconstraint = 0
  )
  AND (
    SELECT count(*) = 2
    FROM pg_index index_state
    JOIN pg_class index_object ON index_object.oid = index_state.indexrelid
    JOIN pg_class table_object ON table_object.oid = index_state.indrelid
    JOIN pg_namespace table_schema ON table_schema.oid = table_object.relnamespace
    WHERE table_schema.nspname = 'public'
      AND table_object.relname = 'Form'
      AND index_object.relname IN (
        'Form_family_version_key',
        'Form_one_published_per_family_key'
      )
      AND index_object.relowner = (
        SELECT role_object.oid FROM pg_roles role_object
        WHERE role_object.rolname = :'owner_user'
      )
      AND index_state.indisunique
      AND index_state.indisvalid
      AND index_state.indisready
      AND index_state.indislive
      AND (
        (
          index_object.relname = 'Form_family_version_key'
          AND pg_get_indexdef(index_state.indexrelid) =
            'CREATE UNIQUE INDEX "Form_family_version_key" ON public."Form" USING btree (COALESCE("parentFormId", id), version)'
        )
        OR (
          index_object.relname = 'Form_one_published_per_family_key'
          AND pg_get_indexdef(index_state.indexrelid) =
            'CREATE UNIQUE INDEX "Form_one_published_per_family_key" ON public."Form" USING btree (COALESCE("parentFormId", id)) WHERE (status = ''PUBLISHED''::text)'
        )
      )
  )
  AND COALESCE((
    SELECT
      md5(function_object.prosrc) = 'ff3721b1477ed27036c042cc6a0477cb'
      AND function_object.proconfig = ARRAY['search_path=pg_catalog, public']
      AND NOT function_object.prosecdef
      AND function_object.provolatile = 'v'
      AND NOT function_object.proleakproof
      AND NOT function_object.proisstrict
      AND function_object.proparallel = 'u'
      AND function_object.pronargs = 4
      AND function_object.prorettype = 'record'::regtype
      AND function_object.prolang = (
        SELECT language_object.oid FROM pg_language language_object
        WHERE language_object.lanname = 'plpgsql'
      )
      AND function_object.proowner = (
        SELECT role_object.oid FROM pg_roles role_object
        WHERE role_object.rolname = :'owner_user'
      )
    FROM pg_proc function_object
    WHERE function_object.oid =
      'public.qa_reserve_login_attempt(text,text,uuid,timestamp without time zone)'::regprocedure
  ), false)
  AND COALESCE((
    SELECT
      md5(function_object.prosrc) = 'b75c38b1a4ff9764bc8bbd80922b723c'
      AND function_object.proconfig = ARRAY['search_path=pg_catalog, public']
      AND NOT function_object.prosecdef
      AND function_object.provolatile = 'v'
      AND NOT function_object.proleakproof
      AND NOT function_object.proisstrict
      AND function_object.proparallel = 'u'
      AND function_object.pronargs = 3
      AND function_object.prorettype = 'record'::regtype
      AND function_object.prolang = (
        SELECT language_object.oid FROM pg_language language_object
        WHERE language_object.lanname = 'plpgsql'
      )
      AND function_object.proowner = (
        SELECT role_object.oid FROM pg_roles role_object
        WHERE role_object.rolname = :'owner_user'
      )
    FROM pg_proc function_object
    WHERE function_object.oid =
      'public.qa_complete_login_attempt(uuid,text,timestamp without time zone)'::regprocedure
  ), false);
