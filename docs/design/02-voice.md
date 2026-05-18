# 02 — Voice, Tone & Lexicon

The look gets people in the door. The voice keeps them. Every string of text
the user reads — buttons, errors, empty states, page titles — is part of the
brand. Treat copy as a craft, not an afterthought.

## Tonality Statement

> Rizzotto speaks like a marshal addressing their order before muster:
> measured, archaic, weighty for ceremonial moments — clear and modern for
> functional ones. No exclamation marks. No emojis. No casual hype.

## The Two-Layer Rule

| Layer        | Use here                                                      | Language style                                 |
|--------------|---------------------------------------------------------------|------------------------------------------------|
| Ceremonial   | Page titles, section headers, button labels, CTAs, victory states | Archaic English, Latin, occasional Khazalid    |
| Functional   | Form labels, validation, settings, errors, tooltips, helper text | Plain modern English / German, neutral, precise |

If a string blocks a user from completing their goal, it must be functional
language. Ceremony decorates; it never gates.

---

## Lexicon — Conventional → Karaz

The "Karaz" column is the **preferred** term in ceremonial contexts. In
functional contexts (form labels, search filters), fall back to the
conventional term so users can still complete their task without translation.

| Conventional       | Karaz (ceremonial)            | Notes                                                        |
|--------------------|-------------------------------|--------------------------------------------------------------|
| Player             | **Marshal** · Marschall       | Always capitalized when used as title.                       |
| Tournament         | **Conclave** · **Muster**     | "Muster" preferred for upcoming events, "Conclave" for live. |
| Team               | **Banner** · Order            | A registered group of marshals = a banner.                   |
| Match              | **Engagement** · Encounter    | "Engagement" preferred (singular event between two marshals).|
| Round              | **Toll** · Bell               | Swiss rounds: "Toll the First", "Toll the Second", …         |
| Bracket            | **Lineage** · Tree of Honour  | A bracket is a literal lineage of victors.                   |
| Leaderboard        | **Roll of Honour**            | The ranking page is *the* Roll.                              |
| ELO / Rating       | **Standing**                  | "Standing of 1834" reads better than "ELO 1834".             |
| Win                | **Triumph**                   | "Triumphed over X" in result banners.                        |
| Loss               | **Fall**                      | "Fell to X" — restrained, never humiliating.                 |
| Draw               | **Stalemate**                 | Plain "Stalemate", no ceremony needed.                       |
| Draft              | **The Choosing**              | Captain's Mode draft = The Choosing.                         |
| Pick               | **Claim**                     | "Claim Empire" in the draft UI.                              |
| Ban                | **Forbid**                    | "Forbid Skaven" — restraint over aggression.                 |
| Champion           | **Reigning Marshal**          | Current tournament winner.                                   |
| Profile            | **Banner-Bearer's Sigil**     | Use sparingly; "Profile" is fine for settings.               |
| Settings           | **The Workshop** · **Forge**  | Settings page header may use "The Workshop".                 |
| Login              | **Take Up Arms**              | Login button text.                                           |
| Logout             | **Lay Down Arms**             | Logout button text.                                          |
| Sign up            | **Enlist**                    | First-time user CTA.                                         |
| Search             | Search                        | Functional. Do not theme.                                    |
| Filter             | Filter                        | Functional. Do not theme.                                    |
| Loading…           | "Stoking the forge…"          | Loading state text.                                          |
| Error              | "The forge has cooled."       | Generic error banner.                                        |
| 404                | "No path leads here."         | 404 page headline.                                           |

---

## Motto Pool (Latin / Khazalid)

For decorative use: hero banners, loading spinners, footer ribbons, easter eggs.
Never use for functional text. Always provide a `title=""` translation on hover
for accessibility (see [11-accessibility.md](./11-accessibility.md)).

### Latin

| Motto                          | Translation                                | Suggested use                          |
|--------------------------------|--------------------------------------------|----------------------------------------|
| **Karaz Ankor**                | "Everlasting Realm" (Khazalid)             | Footer ribbon, default page sub-title  |
| **In Lapide Sigillata**        | "Sealed in stone"                          | Roll of Honour header                  |
| **Forgia Aeternitatis**        | "Forge of Eternity"                        | Settings / Workshop header             |
| **Triumphus In Saxo**          | "Triumph in stone"                         | Tournament-victory state               |
| **Sigillum Marshalium**        | "Sigil of the Marshals"                    | Brand watermark                        |
| **Memento Pugnae**             | "Remember the fight"                       | Past-tournaments archive header        |
| **Ex Ferro, Lex**              | "From iron, law"                           | Rules / TOS page header                |
| **Numquam Soli**               | "Never alone"                              | Community / Discord page               |

### Khazalid

| Motto              | Meaning                                  | Suggested use                          |
|--------------------|------------------------------------------|----------------------------------------|
| **Khazuk!**        | Dwarf battle cry — "Hold!" / "Strike!"   | Victory banner micro-animation         |
| **Karaz!**         | "Rock!" / "Stand fast!"                  | Loading spinner caption                |
| **Wattock!**       | "Beardlings!" — defiant cry              | Easter egg only                        |
| **Karak en Karaz** | "Fortress of rock"                       | About / mission section sub-headline   |

---

## Microcopy Recipes

Copy-paste-ready strings for common UI states. Adjust pronouns/factions only.

### Empty states

- **No active tournaments** —
  *"The musters stand empty. When marshals call, they will be listed here."*
- **No matches yet** —
  *"No engagements recorded. The lineage awaits its first toll."*
- **No drafts in progress** —
  *"The Choosing has not begun. Marshals are still gathering."*
- **Profile with zero games** —
  *"A blank standing. The forge awaits its first strike."*

### Loading states

- Short, never with three dots: *"Stoking the forge"*, *"Drawing the lineage"*,
  *"Reading the roll"*, *"Tolling the bell"*.
- Long-running: append the duration in plain text below in mono font — *e.g.
  `~4s`* — so the user knows it is intentional, not stuck.

### Error states

- **Generic 500**: *"The forge has cooled. The smiths are at work."*
- **Network**: *"The banner lost its bearer. Reconnecting."*
- **Permission denied**: *"This vault is sealed to your sigil."*
- **404**: *"No path leads here. Return to the gate."*
- **Validation (form)**: stay functional. *"Discord username required."* — no
  theming. The user is mid-task.

### Confirmation prompts

Never *exclaim*. Never *accuse*. State the consequence calmly.

- **Delete tournament**: *"This will dissolve the muster. Forever. Continue?"*
- **Leave draft**: *"You will forfeit your claim. Continue?"*

### Buttons (CTA)

| Action                   | Button text                          | Variant       |
|--------------------------|--------------------------------------|---------------|
| Primary CTA on landing   | *Take Up Arms*                       | `forge`       |
| Browse public data       | *View the Roll of Honour*            | `iron`        |
| Submit list              | *Forge the List*                     | `forge`       |
| Create tournament        | *Call the Muster*                    | `forge`       |
| Join tournament          | *Answer the Call*                    | `forge`       |
| Concede match            | *Yield*                              | `etched`      |
| Cancel / Back            | *Step back*                          | `etched`      |
| Save settings            | *Strike*                             | `forge`       |

---

## Do / Don't (10 quick rules)

1. ✅ Capitalize ceremonial nouns (*the Roll*, *the Forge*, *the Lineage*).
   ❌ Do not capitalize functional verbs (*search*, *filter*, *upload*).
2. ✅ Use the Oxford comma. *Triumph, Fall, and Stalemate.*
3. ✅ Use em-dashes for asides. — Like this.
4. ❌ Never use exclamation marks in product UI.
5. ❌ Never use emoji. (Lucide icons only — see [06-iconography.md](./06-iconography.md).)
6. ✅ Numbers in mono font for stats (ELO, scores, dates).
7. ✅ Roman numerals for the Roll of Honour ranks 1–10 (I, II, III, IV, …).
8. ❌ Never address the user as "buddy", "champ", "warrior". They are a *Marshal*.
9. ✅ Use German *only* for native German UI strings (e.g. existing German labels in
   the current product). Latin/Khazalid is decorative, never the primary functional layer.
10. ❌ Never apologize in error copy. State the situation, offer a next step.

---

## Voice review checklist (per PR touching UI text)

- [ ] No exclamation marks.
- [ ] No emojis.
- [ ] Ceremonial term used in ceremonial context, functional term in form labels.
- [ ] Latin / Khazalid motto has `title=""` translation when decorative.
- [ ] No casual hype (*"Crush"*, *"Smash"*, *"Dominate"*) — replaced with
  *"Triumph"*, *"Best"*, *"Overcome"*.
- [ ] Numbers use mono font.
- [ ] Capitalization follows the rule above.

## Related

- [01-brand.md](./01-brand.md) — *why* the voice sounds this way
- [08-components.md](./08-components.md) — button labels live there
- [11-accessibility.md](./11-accessibility.md) — `title=""` translations
