-- Canonicalize the deprecated IANA alias Europe/Kiev -> Europe/Kyiv.
-- Same physical zone, current canonical name. Data-only; no schema change.
-- Backend also normalizes on write (routes/users.ts) so it cannot recur.
UPDATE "User" SET timezone = 'Europe/Kyiv' WHERE timezone = 'Europe/Kiev';
UPDATE "Tournament" SET timezone = 'Europe/Kyiv' WHERE timezone = 'Europe/Kiev';
