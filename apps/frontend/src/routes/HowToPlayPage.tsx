import { useEffect, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { BATTLE_TYPES } from '@rizzotto/types';
import { PageShell } from '@/components/layout/PageShell';
import {
  ARENA_MODE_DUTY,
  joinNames,
  PerBattleType,
  splitShared,
  useStandardRulesets,
} from '@/components/tournament/StandardRulesetCard';
import {
  OPEN_PLAY_CANCELLING,
  OPEN_PLAY_CHEATING,
  strikeDecay,
  strikeLadder,
  strikeOffences,
} from '@/components/open-play/OpenPlayConduct';
import { REPLACED_MODS, RIZZOTTOVERSE_INVITE, steamWorkshopUrl, useArenaMod } from '@/lib/arenaMod';

/**
 * How to Play: one page for new and existing players, from installing RizzOtto's Arena Mod to a reported
 * result. Rule cards, the required-mod notices and onboarding link here ("Set by the mod" → #mod).
 *
 * Section 2 describes the mod from its Workshop description (tww3-modding:
 * domquest/workshop/description_en.txt); keep the two in step when the mod changes. The lobby settings
 * there and the rules in section 4 come from the live Standard Rulesets of all battle types, split into
 * what every type shares and what each adds, so an admin edit shows up here too.
 */

const SECTIONS = [
  { id: 'install', title: 'Install the mod' },
  { id: 'mod', title: "What's in the mod" },
  { id: 'domquest', title: 'Domquest' },
  { id: 'rules', title: 'Rules you follow yourself' },
  { id: 'open-play', title: 'Open Play conduct' },
  { id: 'matches', title: 'Playing a match on rizzotto.gg' },
  { id: 'faq', title: 'FAQ' },
] as const;

const linkClass =
  'text-rizzotto-gold-400 underline decoration-rizzotto-gold-600/60 underline-offset-2 hover:text-rizzotto-gold-300';

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Section({ id, number, title, children }: { id: string; number?: number; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28 border-t border-rizzotto-iron-700 pt-8">
      <h2 className="mb-4 font-display text-2xl text-rizzotto-gold-400">
        {number != null && `${number}. `}
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed text-rizzotto-stone-300">{children}</div>
    </section>
  );
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="my-4">
      <img src={src} alt={alt} loading="lazy" className="w-full rounded-md border border-rizzotto-iron-700" />
      <figcaption className="mt-1.5 text-xs text-rizzotto-stone-500">{caption}</figcaption>
    </figure>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 font-display text-lg text-rizzotto-stone-100">{children}</h3>;
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 font-semibold text-rizzotto-stone-100">{q}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const ul = 'list-disc space-y-1.5 pl-5 marker:text-rizzotto-gold-600';
const ol = 'list-decimal space-y-2 pl-5 marker:text-rizzotto-gold-600';
const code = 'rounded bg-rizzotto-iron-800 px-1 py-0.5 font-mono text-[0.85em] text-rizzotto-stone-200 [overflow-wrap:anywhere]';

export function HowToPlayPage() {
  const mod = useArenaMod();
  const rulesets = useStandardRulesets(BATTLE_TYPES);
  const conduct = splitShared(rulesets.map((r) => ({ battleType: r.battleType, items: r.ruleset.conduct })));
  const tournament = splitShared(
    rulesets.map((r) => ({ battleType: r.battleType, items: r.ruleset.tournament_conduct ?? [] })),
  );
  const settings = splitShared(rulesets.map((r) => ({ battleType: r.battleType, items: r.ruleset.settings })));

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "How to Play — RizzOtto's Arena";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <PageShell variant="narrow">
      <article className="space-y-8">
        <header className="space-y-3">
          <h1 className="font-display text-2xl font-bold leading-tight text-rizzotto-gold-500 sm:text-4xl">How to Play</h1>
          <p className="leading-relaxed text-rizzotto-stone-300">
            Every game on RizzOtto&apos;s Arena is played with{' '}
            <ExternalLink href={mod.url}>RizzOtto&apos;s Arena Mod</ExternalLink>. It adds the arena modes to the
            custom battle lobby, enforces their settings, bans and the Fruit Rules, and brings our map pools, so it is
            the only mod you need. Here is everything from installing it to your first reported result.
          </p>
          <nav aria-label="Contents" className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
            <ol className="space-y-1 text-sm">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-rizzotto-stone-200 hover:text-rizzotto-gold-400">
                    {s.id === 'faq' ? s.title : `${i + 1}. ${s.title}`}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <Section id="install" number={1} title="Install the mod">
          <ol className={ol}>
            <li>
              Subscribe to <ExternalLink href={mod.url}>RizzOtto&apos;s Arena Mod</ExternalLink> on the Steam Workshop
              {mod.version ? <> (current version: <strong className="text-rizzotto-stone-100">{mod.version}</strong>)</> : null}.
            </li>
            <li>
              In the game&apos;s launcher, enable <strong className="text-rizzotto-stone-100">only this mod</strong>.
              Disable{' '}
              {REPLACED_MODS.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && ' and '}
                  <ExternalLink href={steamWorkshopUrl(m.id)}>{m.name}</ExternalLink>
                </span>
              ))}
              : the arena mod already contains their maps and rules, and any other active mod changes the
              multiplayer checksum.
            </li>
            <li>
              If you ever copied a test version by hand, delete <code className={code}>rizzotto_arena.pack</code> and{' '}
              <code className={code}>domquest.pack</code> from the game&apos;s <code className={code}>data</code> folder. A
              local copy hides the Workshop version.
            </li>
            <li>
              Start the game and open the multiplayer lobby. The mod&apos;s version is shown under the lobby title
              {mod.version ? <> and should read {mod.version}</> : null}. Both players need the same version.
            </li>
          </ol>
        </Section>

        <Section id="mod" number={2} title="What's in the mod">
          <p>
            The mod sets up the arena&apos;s game modes the way the Standard Rules want them, so nobody can host a
            wrong lobby or bring an illegal army by accident. It also brings our map pools, one balancing change and a
            few bug fixes.
          </p>

          <SubHeading>The arena modes</SubHeading>
          <p>
            The first buttons in the lobby&apos;s battle type bar are the arena modes, with the aubergine behind the
            icon: Domquest, Land Battle, Conquest, Domination, Siege Battle and Free-For-All Battle. Host every arena
            game in one of these. The game&apos;s own modes follow as &quot;Vanilla …&quot; and have none of the
            arena&apos;s rules. Ambush, Chokepoint, Subterranean, Survival and Minor Settlement battles are not shown.
          </p>
          <Screenshot
            src="/img/how-to-play/arena-mode-buttons.jpg"
            alt="The battle type bar in the lobby: the six arena modes with the aubergine, then the Vanilla modes"
            caption="The arena modes come first, the Vanilla modes after them."
          />

          <SubHeading>Lobby settings</SubHeading>
          <p>
            The mod locks the lobby to the settings of the Standard Rules
            {settings.shared.length > 0 ? <>: {joinNames(settings.shared)} in every mode, plus</> : ':'}
          </p>
          <PerBattleType extra={settings.extra} inline />

          <SubHeading>Bans</SubHeading>
          <p>
            Undead Legions, Skreech Verminking and The Masque of Slaanesh (also as the Changeling&apos;s form) are
            banned in the arena modes, so you can&apos;t pick them.
          </p>

          <SubHeading>Fruit Rules</SubHeading>
          <p>
            In Land Battle, Conquest, Siege Battle and Free-For-All Battle the mod enforces the Fruit Rules v10: units,
            mounts and upgrades that would break a limit are greyed out, the unit tooltip lists the limits, and Ready
            stays blocked while an army breaks a rule. The{' '}
            <Link to="/fruit-rules" className={linkClass}>
              Fruit Rules page
            </Link>{' '}
            shows how we read the rules and every limit per faction.
          </p>

          <SubHeading>Maps</SubHeading>
          <p>
            The map lists in the arena modes are the arena&apos;s map pools from rizzotto.gg, so the lobby offers the
            same maps as the site. Free-For-All shows all of the game&apos;s FFA maps. The Total Tavern Domination maps
            of our pool are included, so you don&apos;t need that map pack any more; Vanilla Domination lists them too,
            as &quot;[TT] …&quot;.
          </p>

          <SubHeading>In battle</SubHeading>
          <p>
            In Domquest and the arena&apos;s Domination, Conquest and Siege Battle, the team list shows each
            army&apos;s gold value on the battlefield instead of the damage value: every unit&apos;s cost times its
            remaining health.
          </p>

          <SubHeading>Balancing</SubHeading>
          <p>Ghostly Howl (Banshees) can be used once per battle, in every mode, the Vanilla ones included.</p>

          <SubHeading>Bug fixes</SubHeading>
          <p>In every mode, the Vanilla ones included:</p>
          <ul className={ul}>
            <li>Chalice of Blood and Darkness only triggers when an enemy spellcaster within 100 m casts.</li>
            <li>
              Dieter Helsnicht on Undead Manticore, the Zombie Dragon and the Spellweaver (Beasts) on Great Eagle can no
              longer capture points, like other flying units.
            </li>
            <li>Dechala keeps the melee attack penalty of The Praise of Slaanesh after switching from Dance of Destruction.</li>
            <li>Coeddil is in the Extended Roster again, like the other campaign-only characters.</li>
            <li>Army setup: much less lag when you move the mouse over unit cards and when you add units.</li>
          </ul>
          <p>The mod also skips the intro movies at startup.</p>
        </Section>

        <Section id="domquest" number={3} title="Domquest">
          <p>
            Domquest brings Domination and Conquest players together: think Conquest on the Domination engine. Most of
            the battle is decided by a Conquest-sized starting army; the small reinforcing army works like a sideboard
            to answer the army your opponent brought.
          </p>
          <SubHeading>Army setup</SubHeading>
          <ul className={ul}>
            <li>Starting army: 12,400 gold.</li>
            <li>
              Reinforcing army: up to 5,600 gold. You can add more, but you can&apos;t click Ready until it is back at
              5,600 or less.
            </li>
            <li>Ultra unit size, unit caps on, character loading off and 600 tickets, all fixed by the mod.</li>
          </ul>
          <SubHeading>The battlefield</SubHeading>
          <ul className={ul}>
            <li>One capture point, equally far from both armies. The map&apos;s other capture points are switched off.</li>
            <li>
              One reinforcement point per side, at the back of your side and as far from the capture point as your
              opponent&apos;s. The mod picks both points; the map&apos;s other reinforcement points can&apos;t be used.
            </li>
            <li>
              The maps are the Domquest versions of the arena&apos;s Domination maps (&quot;Domquest - …&quot; in the
              map list).
            </li>
          </ul>
          <Screenshot
            src="/img/how-to-play/domquest-map-setup.jpg"
            alt="Map setup with Domquest selected: the Domquest maps and the fixed lobby settings"
            caption="Domquest selected: the Domquest maps and the settings the mod fixes."
          />
          <SubHeading>Reinforcements</SubHeading>
          <ul className={ul}>
            <li>
              They are paid from a budget that starts at 0 and grows by 10 per second, up to the value of your
              reinforcing army. The supplies counter shows this budget. Army abilities, unit abilities and buildings are
              paid from it too.
            </li>
            <li>A full 5,600 reinforcing army takes a bit over 9 minutes to earn.</li>
            <li>
              Each unit of your reinforcing army can be called in once. Units can&apos;t be withdrawn, and a unit that
              was on the field can&apos;t be called in again, even after it fled.
            </li>
          </ul>
          <p>
            These rules apply to human players. Against the AI they don&apos;t: it withdraws units and calls them in
            again as in normal Domination.
          </p>
        </Section>

        <Section id="rules" number={4} title="Rules you follow yourself">
          <p>The mod can&apos;t check everything. These are on you, in every game:</p>
          <ul className={ul}>
            <li>{ARENA_MODE_DUTY}</li>
            {conduct.shared.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {conduct.extra.length > 0 && (
            <>
              <p>And per battle type:</p>
              <PerBattleType extra={conduct.extra} />
            </>
          )}
          {tournament.shared.length + tournament.extra.length > 0 && (
            <>
              <SubHeading>In tournaments, also</SubHeading>
              <ul className={ul}>
                {tournament.shared.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <PerBattleType extra={tournament.extra} inline />
            </>
          )}
          <p>A tournament can add rules of its own; you&apos;ll find them on its page.</p>
        </Section>

        <Section id="open-play" number={5} title="Open Play conduct">
          <p>Open Play has no tournament host watching over it, so it has its own consequences. {OPEN_PLAY_CHEATING}</p>
          <SubHeading>What gets you a strike</SubHeading>
          <ul className={ul}>
            {strikeOffences().map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <SubHeading>What a strike does</SubHeading>
          <ul className={ul}>
            {strikeLadder().map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p>{strikeDecay()}</p>
          <SubHeading>Cancelling</SubHeading>
          <p>{OPEN_PLAY_CANCELLING}</p>
        </Section>

        <Section id="matches" number={6} title="Playing a match on rizzotto.gg">
          <ol className={ol}>
            <li>
              Find a game: sign up for a{' '}
              <Link to="/tournaments" search={{ tab: 'upcoming', page: 1 }} className={linkClass}>
                tournament
              </Link>{' '}
              or join the{' '}
              <Link to="/open-play" className={linkClass}>
                Open Play
              </Link>{' '}
              queue. When you are paired, you get a Discord DM and the match appears on the site.
            </li>
            <li>Open the match page. It shows the map and both factions, or lets you pick and ban them, depending on the format.</li>
            <li>
              One of you hosts the lobby in the right arena mode and enters the lobby code and password on the match
              page; the other one joins.
            </li>
            <li>
              After the game, report the result (&quot;I Won&quot; or &quot;They Won&quot;) and attach the replay. TWW3
              saves replays to <code className={code}>%APPDATA%\The Creative Assembly\Warhammer3\replays</code>.
            </li>
            <li>Your opponent confirms or disputes the result. Without an answer it is confirmed after 30 minutes.</li>
          </ol>
        </Section>

        <Section id="faq" title="FAQ">
          <Faq q="The lobby says my version is incompatible.">
            <p>
              Both players need the same version of the mod. Compare the version under the lobby title. If yours is
              older, let Steam update the mod (restarting Steam helps). If you once copied the mod by hand, delete{' '}
              <code className={code}>rizzotto_arena.pack</code> and <code className={code}>domquest.pack</code> from the
              game&apos;s <code className={code}>data</code> folder: a local copy hides the Workshop version.
            </p>
          </Faq>
          <Faq q="There is a red warning in the lobby.">
            <p>
              Other mods are active, or the game was patched after this version of the mod. Disable every mod except
              RizzOtto&apos;s Arena Mod. After a game patch, wait for the mod&apos;s update.
            </p>
            <Screenshot
              src="/img/how-to-play/lobby-warning.jpg"
              alt="The red lobby warning that names the other active mod"
              caption="The warning names the other active mod (here the Total Tavern map pack)."
            />
          </Faq>
          <Faq q="Why is a unit greyed out?">
            <p>
              It would break a limit of the Fruit Rules (Land Battle, Conquest, Siege Battle, Free-For-All Battle). The{' '}
              <Link to="/fruit-rules" className={linkClass}>
                Fruit Rules page
              </Link>{' '}
              shows how we read the rules and every limit per faction.
            </p>
          </Faq>
          <Faq q="Do I still need the Total Tavern map pack or Loupi's mod?">
            <p>No. RizzOtto&apos;s Arena Mod contains the maps and the rules. Disable both, or the lobby warns you.</p>
          </Faq>
          <Faq q="Why can't I join the Open Play queue?">
            <p>
              You&apos;re on a cooldown after a strike; the queue tells you how long. What gives strikes and how long
              they last is under <a href="#open-play" className={linkClass}>Open Play conduct</a>.
            </p>
          </Faq>
          <Faq q="What changed in the latest version?">
            <p>
              The <ExternalLink href={mod.changelogUrl}>change notes on the Steam Workshop</ExternalLink> list every
              update.
            </p>
          </Faq>
          <Faq q="Where do I get help?">
            <p>
              Join <ExternalLink href={RIZZOTTOVERSE_INVITE}>the RizzOttoverse on Discord</ExternalLink>: notifications,
              tournament talk and mod updates.
            </p>
          </Faq>
        </Section>
      </article>
    </PageShell>
  );
}
