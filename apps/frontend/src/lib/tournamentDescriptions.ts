// Single source of truth for the short explanations of a tournament's FORMAT and
// MODE. Used by the create form (field hints) and the tournament page (hover
// tooltips) so the same wording appears in both places.

export const MODE_DESCRIPTIONS: Record<string, string> = {
  BPT: 'Every match includes a blind faction pick phase.',
  SFT: 'Players pre-select a faction at registration; revealed at tournament start.',
  SLT: 'Players upload their army list at registration. Reveal after each completed match.',
  MATRIX: 'Each match: both players pick 3 factions blindly, then ban from the 3×3 matchup grid.',
  TWO_D_THREE: 'Players pick 3 factions at registration; one is drawn at random for each player before every game.',
  FREE_PICK:
    'Each player chooses at registration: a fixed faction (like SFT) or to pick match-by-match. Two fixed players just play their factions; two pick-later players do a 3×3 matrix; a fixed vs pick-later match has the pick-later player offer 3 factions for the fixed player to choose from.',
  ONE_V_THREE:
    "A coin flip sets roles each match: one player runs the host's set faction, the other brings three, and the set-faction player picks which of the three their opponent plays.",
};

export const FORMAT_DESCRIPTIONS: Record<string, string> = {
  SINGLE_ELIMINATION: "Single-elimination bracket — lose once and you're out. Optional third-place match.",
  DOUBLE_ELIMINATION: "Double-elimination bracket — a loss drops you to the lower bracket; two losses and you're out.",
  SWISS: 'Swiss rounds — everyone plays a fixed number of rounds, paired by record, with no early elimination. Optional top-cut playoffs.',
  AUTO_SWISS: 'Self-running Swiss — rounds, playoff size and match format are set automatically from the check-in count, and rounds advance on their own.',
  ROUND_ROBIN: 'Round robin — everyone plays everyone once.',
  LIECHTENSTEIN: 'Liechtenstein — a pre-drawn schedule with unique pairings every round (no repeat opponents).',
  BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein — skill-banded asynchronous Swiss: players are paired within their division, and each division plays its own playoff.',
};
