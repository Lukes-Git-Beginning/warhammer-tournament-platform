-- Balanced Liechtenstein now derives its round count from the check-in count via
-- the opt-in auto_sizing flag (default ON for Balanced). Backfill existing
-- Balanced tournaments so the new auto_sizing gate on applyBalancedStartConfig
-- preserves their current, always-auto-sized behaviour.
UPDATE "Tournament" SET "auto_sizing" = true WHERE "format" = 'BALANCED_LIECHTENSTEIN';
