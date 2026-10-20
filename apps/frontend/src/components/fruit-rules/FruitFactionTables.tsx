import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { ChevronRight, Search, X } from 'lucide-react';
// Vite emits the JSON as a content-hashed asset: it loads only on this page, and a replaced
// file gets a new URL, so the CDN never serves stale limits.
import limitsUrl from '@/content/fruit-rules/fruit_rules_limits.json?url';
import { inputClasses } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  filterFactions,
  parseFruitRules,
  searchTokens,
  type FactionView,
  type FruitAbility,
  type FruitFaction,
  type FruitRow,
} from '@/lib/fruit-rules';

async function fetchFruitFactions(): Promise<FruitFaction[]> {
  const res = await fetch(limitsUrl);
  if (!res.ok) throw new Error(`Fruit Rules data: HTTP ${res.status}`);
  return parseFruitRules(await res.json());
}

/** Scrolls to an anchor once the web fonts are in, so a late font swap can't shift it away. */
export function scrollToAnchor(id: string) {
  void document.fonts.ready.then(() =>
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView()),
  );
}

const NO_IDS: ReadonlySet<string> = new Set();

function toggled(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function FruitFactionTables() {
  const {
    data: factions,
    isPending,
    isError,
  } = useQuery({
    queryKey: ['fruit-rules', limitsUrl],
    queryFn: fetchFruitFactions,
    staleTime: Infinity,
  });

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const tokens = useMemo(() => searchTokens(deferredQuery), [deferredQuery]);
  const searching = tokens.length > 0;
  const views = useMemo(
    () => (factions ? filterFactions(factions, tokens) : []),
    [factions, tokens],
  );

  // Without a search, factions open on click. With a search, every matching faction is open
  // and a click closes it, until the query changes.
  const [open, setOpen] = useState<ReadonlySet<string>>(NO_IDS);
  const [closedInSearch, setClosedInSearch] = useState({ query: '', ids: NO_IDS });
  const closedNow = closedInSearch.query === deferredQuery ? closedInSearch.ids : NO_IDS;
  const isOpen = (id: string) => (searching ? !closedNow.has(id) : open.has(id));
  const toggle = (id: string) => {
    if (searching) setClosedInSearch({ query: deferredQuery, ids: toggled(closedNow, id) });
    else setOpen((prev) => toggled(prev, id));
  };
  const allOpen = views.length > 0 && views.every((v) => open.has(v.faction.id));

  // #faction-<id> links open that faction and scroll to it once the data is there.
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    const target = hash.replace(/^#/, '');
    const faction = factions?.find((f) => `faction-${f.id}` === target);
    if (!faction) return;
    setOpen((prev) => (prev.has(faction.id) ? prev : new Set(prev).add(faction.id)));
    scrollToAnchor(target);
  }, [factions, hash]);

  if (isPending) {
    return <p className="py-6 text-rizzotto-stone-400">Loading the faction tables…</p>;
  }
  if (isError) {
    return (
      <p className="py-6 text-rizzotto-forge-400">
        The faction tables could not be loaded. Reload the page to try again.
      </p>
    );
  }

  const matchCount = views.reduce((n, v) => n + v.matches, 0);

  return (
    <div>
      <div className="sticky top-[73px] z-10 -mx-1 bg-rizzotto-iron-950/95 px-1 pb-3 pt-3 backdrop-blur-md sm:top-[81px]">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-rizzotto-stone-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search units and characters in all factions"
            aria-label="Search units and characters in all factions"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              inputClasses,
              'pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none',
            )}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded text-rizzotto-stone-400 hover:text-rizzotto-stone-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-rizzotto-stone-400">
          <p aria-live="polite">
            {searching ? (
              matchCount > 0 ? (
                `${matchCount} ${matchCount === 1 ? 'match' : 'matches'} in ${views.length} ${views.length === 1 ? 'faction' : 'factions'}`
              ) : (
                `No unit or character matches “${deferredQuery.trim()}”.`
              )
            ) : (
              <>
                {views.length} factions
                <span className="max-sm:hidden">. Open one to see its units and characters.</span>
              </>
            )}
          </p>
          {!searching && (
            <button
              type="button"
              onClick={() => setOpen(allOpen ? NO_IDS : new Set(views.map((v) => v.faction.id)))}
              className="shrink-0 text-rizzotto-gold-400 hover:text-rizzotto-gold-300"
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {views.map((view) => (
          <FactionSection
            key={view.faction.id}
            view={view}
            open={isOpen(view.faction.id)}
            searching={searching}
            tokens={tokens}
            onToggle={() => toggle(view.faction.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function FactionSection({
  view,
  open,
  searching,
  tokens,
  onToggle,
}: {
  view: FactionView;
  open: boolean;
  searching: boolean;
  tokens: string[];
  onToggle: () => void;
}) {
  const { faction, units, characters, matches } = view;
  const anchor = `faction-${faction.id}`;
  const panelId = `${anchor}-panel`;
  return (
    <section
      id={anchor}
      className="scroll-mt-48 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60"
    >
      <h3 className="text-base">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-rizzotto-iron-800/70 sm:px-4"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-rizzotto-stone-400 transition-transform duration-200',
              open && 'rotate-90',
            )}
          />
          {faction.iconUrl && (
            <img
              src={faction.iconUrl}
              alt=""
              loading="lazy"
              className="size-7 shrink-0 object-contain"
            />
          )}
          <span className="font-display text-base text-rizzotto-stone-100 sm:text-lg">
            {faction.name}
          </span>
          <span className="ml-auto shrink-0 pl-2 text-right font-sans text-xs tracking-normal text-rizzotto-stone-400">
            {searching
              ? `${matches} ${matches === 1 ? 'match' : 'matches'}`
              : `${units.length} units · ${characters.length} characters`}
          </span>
        </button>
      </h3>
      {open && (
        <div
          id={panelId}
          className="space-y-6 border-t border-rizzotto-iron-700 px-2 pb-4 pt-3 sm:px-4"
        >
          <a
            href={`#${anchor}`}
            className="block text-right text-xs text-rizzotto-stone-400 hover:text-rizzotto-gold-400"
          >
            Link to {faction.name}
          </a>
          {units.length > 0 && <RowsTable kind="units" rows={units} tokens={tokens} />}
          {characters.length > 0 && (
            <RowsTable kind="characters" rows={characters} tokens={tokens} />
          )}
        </div>
      )}
    </section>
  );
}

const UNIT_COLUMNS = ['Unit', 'Limit', 'Shared limits', 'Categories', 'Fixed abilities', 'Basis'];
const CHARACTER_COLUMNS = [
  'Character',
  'Mount',
  'Limit',
  'Counts toward',
  'Categories',
  'Fixed abilities',
];

// Desktop: a normal table. Phones: every row is a card — name and limit on top, the other
// cells below with their own labels, empty ones left out.
function RowsTable({
  kind,
  rows,
  tokens,
}: {
  kind: 'units' | 'characters';
  rows: FruitRow[];
  tokens: string[];
}) {
  const characters = kind === 'characters';
  const columns = characters ? CHARACTER_COLUMNS : UNIT_COLUMNS;
  return (
    <div>
      <h4 className="mb-1 px-1 font-display text-sm uppercase tracking-wider text-rizzotto-gold-400">
        {characters ? 'Characters' : 'Units'}{' '}
        <span className="font-sans text-xs normal-case tracking-normal text-rizzotto-stone-500">
          ({rows.length})
        </span>
      </h4>
      <table className="block w-full text-sm md:table">
        <thead className="max-md:sr-only">
          <tr className="border-b border-rizzotto-iron-700 text-left text-xs uppercase tracking-wide text-rizzotto-stone-400">
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn('px-2 py-2 font-medium', c === 'Limit' && 'text-center')}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="block divide-y divide-rizzotto-iron-700/60 md:table-row-group">
          {rows.map((row) =>
            characters ? (
              <CharacterRow key={row.key} row={row} tokens={tokens} />
            ) : (
              <UnitRow key={row.key} row={row} tokens={tokens} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

const ROW_CLASS =
  'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-1 py-3 align-top md:table-row md:p-0 md:hover:bg-rizzotto-iron-800/40';
const CELL_CLASS = 'md:table-cell md:px-2 md:py-2 md:align-top';

export function UnitRow({ row, tokens }: { row: FruitRow; tokens: string[] }) {
  return (
    <tr className={ROW_CLASS}>
      <td className={cn(CELL_CLASS, 'font-medium text-rizzotto-stone-100')}>
        <Highlight text={row.name} tokens={tokens} />
      </td>
      <td className={cn(CELL_CLASS, 'text-right md:text-center')}>
        <LimitValue row={row} />
      </td>
      <LabeledCell label="Shared" empty={row.shared.length === 0}>
        <TextList items={row.shared} />
      </LabeledCell>
      <LabeledCell label="Categories" empty={row.categories.length === 0}>
        <CategoryTags row={row} />
      </LabeledCell>
      <LabeledCell label="Abilities" empty={row.abilities.length === 0}>
        <AbilityList abilities={row.abilities} />
      </LabeledCell>
      <LabeledCell label="Basis" empty={!row.basis} className="text-rizzotto-stone-400">
        {row.basis}
      </LabeledCell>
    </tr>
  );
}

export function CharacterRow({ row, tokens }: { row: FruitRow; tokens: string[] }) {
  const mount = row.mount ? (
    <Highlight text={row.mount} tokens={tokens} />
  ) : row.mountUnnamed ? (
    <span className="italic text-rizzotto-stone-500">unnamed mount</span>
  ) : null;
  return (
    <tr className={ROW_CLASS}>
      <td className={cn(CELL_CLASS, 'font-medium text-rizzotto-stone-100')}>
        <Highlight text={row.name} tokens={tokens} />
        {mount && (
          <span className="block text-xs font-normal text-rizzotto-stone-300 md:hidden">
            on {mount}
          </span>
        )}
      </td>
      <td className={cn(CELL_CLASS, 'text-rizzotto-stone-300 max-md:hidden')}>
        {mount ?? <span className="text-rizzotto-stone-500">–</span>}
      </td>
      <td
        className={cn(
          CELL_CLASS,
          'text-right md:text-center',
          row.limit === null && 'max-md:hidden',
        )}
      >
        <LimitValue row={row} />
      </td>
      <LabeledCell label="Counts toward" empty={row.shared.length === 0}>
        <TextList items={row.shared} />
      </LabeledCell>
      <LabeledCell label="Categories" empty={row.categories.length === 0}>
        <CategoryTags row={row} />
      </LabeledCell>
      <LabeledCell label="Abilities" empty={row.abilities.length === 0}>
        <AbilityList abilities={row.abilities} />
      </LabeledCell>
    </tr>
  );
}

function LabeledCell({
  label,
  empty,
  className,
  children,
}: {
  label: string;
  empty: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td
      className={cn(
        CELL_CLASS,
        'col-span-2 max-md:flex max-md:gap-3',
        empty && 'max-md:hidden',
        className,
      )}
    >
      <span className="w-24 shrink-0 pt-px text-xs text-rizzotto-stone-500 md:hidden">{label}</span>
      <div className="min-w-0">{children}</div>
    </td>
  );
}

function LimitValue({ row }: { row: FruitRow }) {
  if (row.limit === null) return <span className="text-rizzotto-stone-500">–</span>;
  if (row.limit === 0) {
    return (
      <span className="inline-block rounded-sm border border-rizzotto-forge-600/70 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-rizzotto-forge-400">
        Banned
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end md:items-center">
      <span className="font-mono text-base font-semibold leading-tight text-rizzotto-gold-400">
        <span className="mr-1 font-sans text-xs font-normal text-rizzotto-stone-500 md:hidden">
          max
        </span>
        {row.limit}
      </span>
      {row.gameCapStricter && (
        <span className="whitespace-nowrap text-[11px] leading-tight text-rizzotto-stone-400">
          game cap{row.fruitCap !== null ? ` (Fruit: ${row.fruitCap})` : ''}
        </span>
      )}
    </span>
  );
}

function TextList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-0.5 text-rizzotto-stone-300">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function CategoryTags({ row }: { row: FruitRow }) {
  return (
    <span className="flex flex-wrap gap-1">
      {row.categories.map((c) => (
        <span
          key={c.tag}
          title={c.title}
          className="rounded-sm border border-rizzotto-iron-600 bg-rizzotto-iron-800 px-1.5 py-px text-[11px] font-medium text-rizzotto-stone-200"
        >
          {c.tag}
        </span>
      ))}
    </span>
  );
}

function AbilityList({ abilities }: { abilities: FruitAbility[] }) {
  return (
    <ul className="space-y-0.5">
      {abilities.map((a) => (
        <li key={a.name} className="text-rizzotto-stone-200">
          {a.name}{' '}
          <span className="text-xs text-rizzotto-stone-500">
            · {a.targetable ? `targetable ${a.kind}` : a.kind}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Marks the search words in a name (exact, case-insensitive). */
export function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (tokens.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    for (let i = lower.indexOf(token); i !== -1; i = lower.indexOf(token, i + token.length)) {
      ranges.push([i, i + token.length]);
    }
  }
  if (ranges.length === 0) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (end <= pos) continue;
    const from = Math.max(start, pos);
    if (from > pos) parts.push(text.slice(pos, from));
    parts.push(
      <mark key={from} className="rounded-sm bg-rizzotto-gold-500/30 text-inherit">
        {text.slice(from, end)}
      </mark>,
    );
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}
