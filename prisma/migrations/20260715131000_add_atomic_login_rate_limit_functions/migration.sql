BEGIN;

CREATE OR REPLACE FUNCTION qa_reserve_login_attempt(
  p_account_key text,
  p_ip_key text,
  p_reservation_id uuid,
  p_now timestamp without time zone
)
RETURNS TABLE (
  allowed boolean,
  reservation_id uuid,
  blocked_scope text,
  blocked_until timestamp without time zone,
  reason text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  account_row public."LoginRateLimit"%ROWTYPE;
  ip_row public."LoginRateLimit"%ROWTYPE;
  account_active integer;
  ip_active integer;
  lock_key text;
BEGIN
  IF p_account_key !~ '^[0-9a-f]{64}$'
     OR p_ip_key !~ '^[0-9a-f]{64}$'
     OR p_account_key = p_ip_key THEN
    RAISE EXCEPTION 'Invalid login rate-limit keys';
  END IF;

  FOR lock_key IN
    SELECT key_value
    FROM (VALUES (p_account_key), (p_ip_key)) AS keys(key_value)
    ORDER BY key_value
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('qore-login-rate-limit'),
      hashtext(lock_key)
    );
  END LOOP;

  INSERT INTO public."LoginRateLimit" (
    "keyHash", scope, "failureCount", "windowStartedAt", "lastFailureAt",
    "blockedUntil", "expiresAt", "updatedAt"
  )
  VALUES
    (p_account_key, 'account', 0, p_now, p_now, NULL, p_now + interval '24 hours', p_now),
    (p_ip_key, 'ip', 0, p_now, p_now, NULL, p_now + interval '24 hours', p_now)
  ON CONFLICT ("keyHash") DO UPDATE
    SET scope = EXCLUDED.scope, "updatedAt" = p_now;

  SELECT * INTO STRICT account_row
  FROM public."LoginRateLimit"
  WHERE "keyHash" = p_account_key
  FOR UPDATE;
  SELECT * INTO STRICT ip_row
  FROM public."LoginRateLimit"
  WHERE "keyHash" = p_ip_key
  FOR UPDATE;

  IF account_row."blockedUntil" IS NOT NULL AND account_row."blockedUntil" > p_now THEN
    RETURN QUERY SELECT false, NULL::uuid, 'account', account_row."blockedUntil", 'blocked';
    RETURN;
  END IF;
  IF account_row."windowStartedAt" <= p_now - interval '15 minutes' THEN
    UPDATE public."LoginRateLimit"
    SET "failureCount" = 0,
        "windowStartedAt" = p_now,
        "blockedUntil" = NULL,
        "expiresAt" = p_now + interval '24 hours',
        "updatedAt" = p_now
    WHERE "keyHash" = p_account_key
    RETURNING * INTO account_row;
  ELSIF account_row."blockedUntil" IS NOT NULL THEN
    UPDATE public."LoginRateLimit"
    SET "blockedUntil" = NULL, "updatedAt" = p_now
    WHERE "keyHash" = p_account_key
    RETURNING * INTO account_row;
  END IF;

  SELECT count(*)::integer INTO account_active
  FROM public."LoginRateLimitReservation"
  WHERE "accountKeyHash" = p_account_key AND "expiresAt" > p_now;
  IF account_row."failureCount" + account_active >= 10 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'account', p_now + interval '5 minutes', 'capacity';
    RETURN;
  END IF;

  IF ip_row."blockedUntil" IS NOT NULL AND ip_row."blockedUntil" > p_now THEN
    RETURN QUERY SELECT false, NULL::uuid, 'ip', ip_row."blockedUntil", 'blocked';
    RETURN;
  END IF;
  IF ip_row."windowStartedAt" <= p_now - interval '15 minutes' THEN
    UPDATE public."LoginRateLimit"
    SET "failureCount" = 0,
        "windowStartedAt" = p_now,
        "blockedUntil" = NULL,
        "expiresAt" = p_now + interval '24 hours',
        "updatedAt" = p_now
    WHERE "keyHash" = p_ip_key
    RETURNING * INTO ip_row;
  ELSIF ip_row."blockedUntil" IS NOT NULL THEN
    UPDATE public."LoginRateLimit"
    SET "blockedUntil" = NULL, "updatedAt" = p_now
    WHERE "keyHash" = p_ip_key
    RETURNING * INTO ip_row;
  END IF;

  SELECT count(*)::integer INTO ip_active
  FROM public."LoginRateLimitReservation"
  WHERE "ipKeyHash" = p_ip_key AND "expiresAt" > p_now;
  IF ip_row."failureCount" + ip_active >= 50 THEN
    RETURN QUERY SELECT false, NULL::uuid, 'ip', p_now + interval '5 minutes', 'capacity';
    RETURN;
  END IF;

  INSERT INTO public."LoginRateLimitReservation" (
    id, "accountKeyHash", "ipKeyHash", "createdAt", "expiresAt"
  ) VALUES (
    p_reservation_id, p_account_key, p_ip_key, p_now, p_now + interval '5 minutes'
  );

  RETURN QUERY SELECT true, p_reservation_id, NULL::text, NULL::timestamp, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION qa_complete_login_attempt(
  p_reservation_id uuid,
  p_outcome text,
  p_now timestamp without time zone
)
RETURNS TABLE (
  completed boolean,
  account_blocked_until timestamp without time zone,
  ip_blocked_until timestamp without time zone
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reservation_row public."LoginRateLimitReservation"%ROWTYPE;
  account_row public."LoginRateLimit"%ROWTYPE;
  ip_row public."LoginRateLimit"%ROWTYPE;
  next_count integer;
  next_window timestamp without time zone;
  next_block timestamp without time zone;
  lock_key text;
BEGIN
  IF p_outcome NOT IN ('success', 'failure') THEN
    RAISE EXCEPTION 'Invalid login completion outcome';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('qore-login-reservation'),
    hashtext(p_reservation_id::text)
  );

  SELECT * INTO reservation_row
  FROM public."LoginRateLimitReservation"
  WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp, NULL::timestamp;
    RETURN;
  END IF;

  FOR lock_key IN
    SELECT key_value
    FROM (
      VALUES (reservation_row."accountKeyHash"), (reservation_row."ipKeyHash")
    ) AS keys(key_value)
    ORDER BY key_value
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtext('qore-login-rate-limit'),
      hashtext(lock_key)
    );
  END LOOP;

  SELECT * INTO STRICT account_row
  FROM public."LoginRateLimit"
  WHERE "keyHash" = reservation_row."accountKeyHash"
  FOR UPDATE;
  SELECT * INTO STRICT ip_row
  FROM public."LoginRateLimit"
  WHERE "keyHash" = reservation_row."ipKeyHash"
  FOR UPDATE;
  SELECT * INTO reservation_row
  FROM public."LoginRateLimitReservation"
  WHERE id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::timestamp, NULL::timestamp;
    RETURN;
  END IF;

  DELETE FROM public."LoginRateLimitReservation" WHERE id = p_reservation_id;
  IF reservation_row."expiresAt" <= p_now THEN
    RETURN QUERY SELECT false, NULL::timestamp, NULL::timestamp;
    RETURN;
  END IF;
  IF p_outcome = 'success' THEN
    RETURN QUERY SELECT true, NULL::timestamp, NULL::timestamp;
    RETURN;
  END IF;

  IF account_row."windowStartedAt" <= p_now - interval '15 minutes'
     OR account_row."expiresAt" <= p_now THEN
    next_count := 1;
    next_window := p_now;
  ELSE
    next_count := account_row."failureCount" + 1;
    next_window := account_row."windowStartedAt";
  END IF;
  IF account_row."blockedUntil" IS NOT NULL AND account_row."blockedUntil" > p_now THEN
    next_block := account_row."blockedUntil";
  ELSIF next_count >= 10 THEN
    next_block := p_now + interval '15 minutes';
  ELSE
    next_block := NULL;
  END IF;
  UPDATE public."LoginRateLimit"
  SET "failureCount" = next_count,
      "windowStartedAt" = next_window,
      "lastFailureAt" = p_now,
      "blockedUntil" = next_block,
      "expiresAt" = GREATEST(p_now + interval '24 hours', COALESCE(next_block, p_now)),
      "updatedAt" = p_now
  WHERE "keyHash" = reservation_row."accountKeyHash"
  RETURNING * INTO account_row;

  IF ip_row."windowStartedAt" <= p_now - interval '15 minutes'
     OR ip_row."expiresAt" <= p_now THEN
    next_count := 1;
    next_window := p_now;
  ELSE
    next_count := ip_row."failureCount" + 1;
    next_window := ip_row."windowStartedAt";
  END IF;
  IF ip_row."blockedUntil" IS NOT NULL AND ip_row."blockedUntil" > p_now THEN
    next_block := ip_row."blockedUntil";
  ELSIF next_count >= 50 THEN
    next_block := p_now + interval '15 minutes';
  ELSE
    next_block := NULL;
  END IF;
  UPDATE public."LoginRateLimit"
  SET "failureCount" = next_count,
      "windowStartedAt" = next_window,
      "lastFailureAt" = p_now,
      "blockedUntil" = next_block,
      "expiresAt" = GREATEST(p_now + interval '24 hours', COALESCE(next_block, p_now)),
      "updatedAt" = p_now
  WHERE "keyHash" = reservation_row."ipKeyHash"
  RETURNING * INTO ip_row;

  RETURN QUERY SELECT true, account_row."blockedUntil", ip_row."blockedUntil";
END;
$$;

REVOKE ALL ON FUNCTION qa_reserve_login_attempt(text, text, uuid, timestamp without time zone)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION qa_complete_login_attempt(uuid, text, timestamp without time zone)
  FROM PUBLIC;

COMMIT;
