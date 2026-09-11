-- Team names must be unique among LIVE (non-archived) teams, case-insensitive — a dissolved
-- team frees its name for reuse. This is a partial, functional unique index, which Prisma's
-- schema can't express, so it lives only here (routes/teams.ts also checks it for a friendly
-- 409). See plans/2v2-competitor-implementation.md.

CREATE UNIQUE INDEX "Team_active_name_unique" ON "Team" (lower(name)) WHERE status <> 'ARCHIVED'::"TeamStatus";
