import { z } from 'zod';

// Standalone (no heavy deps) so both the sender (broadcast.ts) and the announcement
// destination schema (announcements.ts) can share ONE audience shape without pulling
// the Discord/bot imports into the unit-tested announcements module.

/** Admin/broadcast audience filters. All empty/false = every user. Filters AND together. */
export const BroadcastAudienceSchema = z.object({
  activeOnly: z.boolean().optional().default(false),
  activeDays: z.number().int().min(1).max(365).optional().default(30),
  bands: z.array(z.number().int().min(1).max(5)).optional().default([]),
  tiers: z.array(z.enum(['supporter', 'lord', 'champion'])).optional().default([]),
});
export type BroadcastAudience = z.infer<typeof BroadcastAudienceSchema>;
