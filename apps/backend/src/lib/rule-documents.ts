/**
 * Rules documents — stable permalinks on our domain (`/rules/<slug>`) that forward to an external
 * document, e.g. the Fruit Rules PDFs. The target lives in AdminConfig `rule_documents`, so a new
 * version of a document is an admin edit, never a deploy, and every link already shared keeps working.
 * A document tagged with battle types is linked from those types' Standard Ruleset.
 */
import { z } from 'zod';
import { BATTLE_TYPES } from '@rizzotto/types';
import { prisma } from '@rizzotto/db';

export const RULE_DOCUMENTS_CONFIG_KEY = 'rule_documents';

export const RuleDocumentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(120),
  // Only http(s): the permalink page redirects to this, so a javascript: URL must never get through.
  url: z.union([z.literal(''), z.string().url().refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL')]),
  battle_types: z.array(z.enum(BATTLE_TYPES)).default([]),
});
export type RuleDocument = z.infer<typeof RuleDocumentSchema>;

/** The permalinks that exist from the start; the admin fills in where they point. */
export const DEFAULT_RULE_DOCUMENTS: RuleDocument[] = [
  { slug: 'fruit-rules-conquest', label: 'Fruit Rules (Conquest)', url: '', battle_types: ['CONQUEST'] },
  { slug: 'fruit-rules-land-battle', label: 'Fruit Rules (Land Battle)', url: '', battle_types: ['LAND_BATTLE'] },
];

/** Merge the stored list over the defaults: defaults first (stable order), each replaced by its stored
 *  entry; any extra stored documents after. Invalid stored entries are dropped one by one. Pure. */
export function mergeRuleDocuments(stored: unknown): RuleDocument[] {
  const valid = (Array.isArray(stored) ? stored : [])
    .map((entry) => RuleDocumentSchema.safeParse(entry))
    .flatMap((r) => (r.success ? [r.data] : []));
  const bySlug = new Map(valid.map((d) => [d.slug, d]));
  const defaultSlugs = new Set(DEFAULT_RULE_DOCUMENTS.map((d) => d.slug));
  return [...DEFAULT_RULE_DOCUMENTS.map((d) => bySlug.get(d.slug) ?? d), ...valid.filter((d) => !defaultSlugs.has(d.slug))];
}

export async function resolveRuleDocuments(): Promise<RuleDocument[]> {
  const row = await prisma.adminConfig.findUnique({ where: { key: RULE_DOCUMENTS_CONFIG_KEY } });
  return mergeRuleDocuments(row?.value);
}
