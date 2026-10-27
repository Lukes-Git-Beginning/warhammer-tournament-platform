# Fruit Rules – how the RizzOtto's Arena mod enforces them

The Fruit Rules v10 (Cranberry Edition) are the community standard for competitive Conquest and
Land Battle. On RizzOtto's Arena they apply in Land Battle, Conquest, Siege Battle and
Free-For-All Battle. RizzOtto's Arena Mod checks them in the army setup: a unit, mount or upgrade
that would break a limit is greyed out, and Ready stays blocked while an army breaks a rule, so
nobody has to check them by hand.

This page shows how we read the rules where the PDF leaves room for interpretation, every point
where the mod differs from the PDF (section 9), and all limits per faction at a glance for
planning your armies.

The rules come from the Fruit Rules v10 PDFs:

- Fruit Rules v10, Conquest: https://drive.google.com/file/d/1Knv1mVafQckcgozQ5uwRP8D_r6wIePA2/view
- Fruit Rules v10, Land Battle: https://drive.google.com/file/d/1bALrMJ_QBit22Y27kLMeIEnQJPr0rLm1/view

## 1. Where the rules apply

- **Conquest, Land Battle, Siege Battle and Free-For-All Battle** of the arena (the lobby buttons
  without "Vanilla"), in custom battles against the AI and in multiplayer. CA's unmodded modes
  ("Vanilla Conquest" etc.) have no rules.
- The host's lobby settings are fixed in these modes: Ultra unit size, unit caps on, character
  loading off, default funds. Conquest also has 600 tickets, Siege Battle a short time limit and
  settlement level 1. The time limit of Land Battle and Free-For-All Battle stays free.
- In addition to the Fruit Rules, the RizzOtto Standard Rules ban the **Undead Legions**,
  **Skreech Verminking** and **The Masque of Slaanesh** (also as the Changeling's form).
- The arena's Domination and Domquest use the RizzOtto Standard Rules only, without the Fruit
  Rules.


## 2. What a player sees

- A unit card that would break a limit is greyed out and cannot be recruited. The same goes for
  mounts, spells, items and abilities.
- The tooltip of a unit card lists the Fruit limits the unit counts toward, with the current
  count, for example "Fruit Rules: Single entities: 3/4". Limits the game's own tooltip already
  shows are left out.
- A model counter sits next to the gold of the army. It turns red below 400.
- Ready stays blocked while the army breaks a rule. Its tooltip names the reason.
- Some actions equip upgrades by themselves, for example recruiting a caster equips all spells of
  his lore. If that breaks a rule, the mod removes the offending upgrade again.


## 3. Army size

- An army needs **at least 400 models at Ultra unit size**. The mod counts the models of every unit
  card in the army. Artillery counts its pieces, not its crew.


## 4. Unit limits

### 4.1 How many of one unit

Each unit has a limit: the number on its faction page, or the limit of its price bin if the page
doesn't list it.

| Unit type | Price | Limit |
|---|---|---|
| Multiple entity infantry | 0–900 | 5 |
| | 901–1,100 | 4 |
| | 1,101+ | 3 |
| Other multiple entity units (cavalry etc.) | 0–1,200 | 4 |
| | 1,201+ | 3 |
| Multiple entity chariots | 0–1,200 | 3 |
| | 1,201+ | 2 |
| Single entities | – | 2 |
| Superweapons | – | 1 |

With unit caps on, the game also applies its own caps. Where the game's cap for a unit is
stricter than the Fruit limit, the game's cap applies (33 units and a few characters, marked in the
faction tables).

### 4.2 What counts as the same unit

- **Variants:** an armoured or shielded unit is the same unit as its plain version when it costs
  more. A marked unit with the same weapon is the same unit as its unmarked version.
- **SAME UNIT banners and footnotes** on the faction pages: the units in one group share one limit.
- **Regiments of renown:** max 1 each, and each counts toward the limit of its base unit.
- **Exalted units** count toward the limit of their base unit.
- **Marked units of the Warriors of Chaos** take their limit from the page of their god.

### 4.3 Characters and mounts

- A **mounted character** counts toward the limit of the single entity unit he rides, for example a
  lord on a Carnosaur counts as one Carnosaur. A feral version of a creature is the same creature
  (a Manticore mount counts toward Feral Manticores).
- Faction footnotes: each kind of Corpse Cart counts toward its own unit (regular, Balefire,
  Lodestone); the Brothers Ghorst ride a unique cart that counts toward nothing; the Blood Throne
  counts as a Blood Shrine; Steam Tank mounts count as Steam Tanks.
- **Big monster mounts without a unit of their own** (Griffons, Hippogryphs, Juggernauts, Carmine
  Dragons and others, see the faction tables): at most 2 characters per kind of mount. Horses,
  Pegasi, Demigryphs and other cavalry-sized mounts are not limited.
- **Characters that count as a unit** (footnotes): Bloodthirsters, Great Unclean Ones, Keepers of
  Secrets and Lords of Change share one limit with their exalted versions and their named greater
  daemons (Skarbrand, Ku'gath, N'Kari, Kairos, Sarthorael). Treemen share one limit with Ancient
  Treemen and Durthu.
- Named characters and regiments of renown can't be fielded twice (the game enforces this too).

### 4.4 Chaos Dwarf trains

- A Skullcracker with a Dreadquake Mortar carriage counts toward the limits of both units and as
  one single entity.
- The Iron Daemon with a Dreadquake Mortar carriage is banned.


## 5. Unit category limits

Per army. A unit can count toward several categories.

| Category | Limit | Who counts |
|---|---|---|
| Single entities (SE) | 4 | All characters and all units with one model, including the Ironblaster, Scraplauncher, Magma Cannon and Deathshrieker. Exempt single entities (XSE on the faction page) don't count. |
| Rare single entities (RSE) | 3 | Units marked RSE on the faction page (max 2 each, like every single entity). Characters: those the game groups as rare single entities, all Slanns including Mazdamundi and Kroak, Steam Tank mounts, and characters riding an RSE mount (Mammoths, Stonehorns, Thundertusks, Taurus, Lammasu). |
| Ranged units | 12 | Every unit and character with ammunition (PDF p. 3), including units the game doesn't count as ranged: Miners (Blasting Charges), Ekrund Miners, Ironbreakers, Infernal Ironsworn, the Blazing Beards of Bazherak, Hobgoblin Sneaky Gits, Exalted Plaguebearers, Festering Stooges, Centigors (Throwing Axes), Groghooves of Wolf's Run, Cold One Chariots and 21 characters such as Ikit Claw, Ku'gath, the Ataman and Ulrika. Not the Khorne Soul Grinder (Khorne page). |
| Ranged units with 360° firing arcs | 6 | Units marked 360 on the faction page; characters the game groups as 360° units. |
| Chariots | 3 | Units with the chariot symbol on the faction page. Characters on a chariot mount: a chariot is a fast vehicle that deals impact damage, so Steam Tanks, Doomwheels, Doom-Flayers and the Blood Throne count; Corpse Carts, the War Compass, the Cauldron of a Thousand Poxes and other slow altars don't. |
| Multi-entity ranged cavalry & chariots | 6 | Units with the ranged cavalry symbol on the faction page. |
| Flying ranged units | 3 | Units that fly and have ammunition. |
| Flying units with breath attacks | 2 | Flying units with a breath attack: an activated ability (not a spell) that fires a breath, for example every dragon breath, the Terrorgheist's Death Shriek and the Exalted Bloodthirster's Bellow of Fury. |

These category limits of the PDF are the game's own unit caps with the same values; the game
enforces them with unit caps on: heroes 2, flying units 6, Extended Roster units 0, marked units 5
(Warriors of Chaos) and 4 (Beastmen). The game also caps ranged units at 12, but counts fewer units
than the PDF (see above) and also counts the Khorne Soul Grinder; both limits apply.


## 6. Ability limits

An army may not contain:

### 6.1 Duplicate spells or runes

- A **spell** is any selectable upgrade with an ability that costs winds of magic. Spells of a lore
  chosen in the army setup count.
- A **rune** is an upgrade from a runic lore or a rune item.
- Bound spells on items are not spells (see 6.2).
- The same spell or rune may appear only once in the whole army, across all characters.

### 6.2 Duplicate limited items and abilities

- An item or ability counts as **limited** when it has **a limited number of uses and a limited
  duration**, for example the Power Stone (one use, 31 seconds). It may appear only once per army.
- Items with uses but no duration are not covered: the Blast scroll (one use, instant damage) can
  be taken by several characters. The same goes for the few other one-use items without a
  duration, for example the Hail of Doom Arrow and the Wind Bow.
- The PDF only names items priced above 0. The mod doesn't look at the price.

### 6.3 More than 1 passive health drain

Passive abilities that damage nearby enemies every second for the whole battle:

Aura of Madness, Aura of Mutation, Billowing Death, Daemonic Acid Ichor, Decadent Miasma,
Domination, Giver of Torturous Glory, Harbinger of Pestilence, Incarnate Flock of Doom, Mist of the
Lady, Nurgle's Rot, Pestilent Decay, Soul Siphon, The Reliquary Corruption, Warpstone Armour.

### 6.4 More than 2 nets or rampages, of which more than 1 targetable

**Nets** (T = targetable): Deathmaster's Sigil (T), Gaze of Fate (T), Glory Seeker (T), Howling
Warpgale (T), Hunter's Snare (T), Net of Amyntok (T), Pack Trap (T), Petrifying Gaze (T),
Phantasmagoria (T), Seismic Snare, Transfix (T).

**Rampages:** abilities that put enemy units into rampage, directly or through a vortex. Rampage on
your own or allied units doesn't count, army abilities don't count. Curse of Djaf (T), Everyone Has
Their Price, Fermented Fungi (T), Glare of Insanity, In the Name of War, Kill for Khorne!,
Malediction of Madness (T), Pavane of Slaanesh (T), Rage Embodied, Rage Incarnate, Rampaging
Presence, Seductive Glory, Sword of Khaine (T), Whisper of Glory.

### 6.5 Fixed and selectable abilities

- Drains, nets and rampages count whether they are selected or fixed.
- A **character** can deselect abilities that are unit upgrades (for example Soul Siphon, Mist of
  the Lady, Curse of Djaf, Domination). They count only while selected.
- For **all other units** every ability is fixed and always counts, for example the Mutalith's Aura
  of Madness or the Net of Amyntok of the Templehof Luminark. A unit card is greyed out when its
  fixed abilities alone would break a limit.


## 7. The Changeling

- The Changeling counts as himself and as the form chosen for him: the form's unit limits,
  categories, abilities and the spells of its lore all count toward the army.
- A form that breaks a rule on its own can never be legal and can't be chosen. This concerns
  Coeddil (banned) and the Slaanesh casters and daemons that bring two targetable nets or rampages
  (Pavane of Slaanesh and Phantasmagoria), for example Azazel, N'Kari, Heralds and Alluresses of
  Slaanesh and Exalted Keepers of Secrets.
- Nagash is allowed as a form, although the Undead Legions are banned: he is only too strong
  together with his own faction. He counts as a single entity and a rare single entity.
- The Blue Scribes count as a form without their lore (it holds the spells of every lore).


## 8. Bans

From the Fruit Rules:
- Bloodshriek Chimera (regiment of renown; Beastmen, Norsca, Warriors of Chaos).
- Coeddil (Wood Elves).
- Iron Daemon with a Dreadquake Mortar carriage (Chaos Dwarfs).
- Extended Roster units (the game's cap is 0).

From the RizzOtto Standard Rules (not Fruit): Undead Legions, Skreech Verminking, The Masque of
Slaanesh.


## 9. Where the mod differs from the PDF

1. **Sayl the Faithless is allowed.** The PDF bans him because of a bug that has since been fixed.
2. **Glory Seeker and Transfix count as nets.** The PDF doesn't list them; they hold enemies in
   place like the listed nets.
3. **The game's caps apply where they are stricter** (33 units and a few characters, for example
   Bloodthirster 1, Star Dragon 1, Slayer Pirates 3), because unit caps are on.
4. **Limited items:** the mod doesn't check whether an item is priced above 0.
5. **Undead Legions, Skreech Verminking and The Masque of Slaanesh are banned** by the RizzOtto
   Standard Rules; the Fruit Rules allow them.

Points where the PDF is open and the mod had to decide (sections 4 and 5): which mount unit a
mounted character counts toward, the limit of 2 per kind of big mount without a unit, which
characters count as chariots, what counts as a breath attack, which single entities the game
leaves out of its own single entity group, and that Teutogen Guard, which is missing from the
Empire page, gets the limit of its price bin (3).


## 10. Not checked by the mod

- The **Rules of Play** of the Land Battle edition: the attacking rule, white line abuse and
  forest abuse. Admins judge these.
- Everything the PDF leaves to admins, for example bugs and exploits or live coaching.


## 11. Faction tables

The faction tables list every unit and character the army setup offers, with the limits the mod
applies. They are generated from the mod's own data, so they always match what the mod enforces.

- **Limit:** how many of this unit an army may have (faction page or price bin; the game's cap
  where stricter).
- **Shared limits:** limits the unit shares with others, such as SAME UNIT groups, variants,
  regiments of renown counting toward their base unit, or a mount kind.
- **Categories:** SE, RSE, Ranged, 360°, Chariot, Ranged cavalry, Flying ranged, Breath.
- **Fixed abilities:** drains, nets or rampages the unit always brings.
- **Basis:** where the limit comes from.
- **Characters** have one row per mount. Their limits come from their mount and the categories.
