// Shared Zod schemas for API request/response bodies.
// Populated in M1.3+. M1.1 stub keeps the module importable.

import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
