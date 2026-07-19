-- In-app notifications were intentionally removed from the product. AuditLog
-- remains the durable source of operational and security traceability.
-- Drop preferences first because they are user-owned companion data.
DROP TABLE IF EXISTS "NotificationPreference";

-- Historical notification rows have no remaining reader or producer and are
-- deliberately discarded as part of retiring the capability.
DROP TABLE IF EXISTS "Notification";
