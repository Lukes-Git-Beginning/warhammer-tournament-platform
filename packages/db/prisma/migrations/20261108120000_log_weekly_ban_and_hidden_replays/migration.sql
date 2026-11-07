-- Usage log for the weekly ban and hidden replays (live since 2026-11-07, logged to AuditLog from v3.2.0 on):
-- write what the users table already shows, so "ever" in the admin Players report starts at the launch.

-- Every ban set so far (at most one per player: the feature is younger than its 7-day lock), at its time.
INSERT INTO "AuditLog" ("id", "entity_type", "entity_id", "action", "actor_id", "old_value", "new_value", "created_at")
SELECT gen_random_uuid(), 'User', u."id"::text, 'WEEKLY_BAN_SET', u."id",
       jsonb_build_object('factionId', NULL), jsonb_build_object('factionId', u."weekly_ban_faction_id", 'backfilled', true),
       u."weekly_ban_set_at"
FROM "User" u
WHERE u."weekly_ban_set_at" IS NOT NULL;

-- Bans dropped since (set time kept, faction gone); when is unknown, so now.
INSERT INTO "AuditLog" ("id", "entity_type", "entity_id", "action", "actor_id", "old_value", "new_value", "created_at")
SELECT gen_random_uuid(), 'User', u."id"::text, 'WEEKLY_BAN_DROP', u."id",
       NULL, jsonb_build_object('factionId', NULL, 'backfilled', true), CURRENT_TIMESTAMP
FROM "User" u
WHERE u."weekly_ban_set_at" IS NOT NULL AND u."weekly_ban_faction_id" IS NULL;

-- Replays hidden right now; when it was turned on is unknown, so now.
INSERT INTO "AuditLog" ("id", "entity_type", "entity_id", "action", "actor_id", "old_value", "new_value", "created_at")
SELECT gen_random_uuid(), 'User', u."id"::text, 'REPLAYS_HIDDEN_ON', u."id",
       jsonb_build_object('hidden', false), jsonb_build_object('hidden', true, 'backfilled', true), CURRENT_TIMESTAMP
FROM "User" u
WHERE u."hide_replays" = true;
