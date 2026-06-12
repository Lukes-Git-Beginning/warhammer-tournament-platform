-- Add HOST to the Role enum and migrate all ORGANIZER users to HOST.
-- ORGANIZER remains in the enum for backward-compat but is no longer assigned.
ALTER TYPE "Role" ADD VALUE 'HOST';
UPDATE "User" SET role = 'HOST' WHERE role = 'ORGANIZER';
