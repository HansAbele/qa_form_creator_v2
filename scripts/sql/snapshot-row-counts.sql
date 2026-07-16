CREATE OR REPLACE FUNCTION pg_temp.qore_snapshot_row_counts()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  table_record record;
  table_count bigint;
  result jsonb := '{}'::jsonb;
BEGIN
  FOR table_record IN
    SELECT namespace_object.nspname AS schema_name, table_object.relname AS table_name
    FROM pg_class table_object
    JOIN pg_namespace namespace_object ON namespace_object.oid = table_object.relnamespace
    WHERE namespace_object.nspname = 'public'
      AND table_object.relkind IN ('r', 'p')
      AND NOT table_object.relispartition
    ORDER BY table_object.relname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I',
      table_record.schema_name,
      table_record.table_name
    ) INTO table_count;
    result := result || jsonb_build_object(table_record.table_name, table_count);
  END LOOP;

  RETURN result;
END $$;

SELECT pg_temp.qore_snapshot_row_counts();
