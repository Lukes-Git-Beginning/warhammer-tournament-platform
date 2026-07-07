/**
 * Map a *displayed* 3x3 faction-matrix cell back to the real (row, col) in the
 * matrix model. The model fixes rows = matchPlayer1 (p1Factions) and cols =
 * player2 (p2Factions). When the viewer is player 2 the grid is transposed so
 * their own factions run down the left axis; in that case the displayed and
 * actual coordinates are swapped. Ban/pick clicks must always be sent in actual
 * coordinates so they land on the correct cell for both players.
 */
export function toActualCell(
  transpose: boolean,
  dispRow: number,
  dispCol: number,
): [number, number] {
  return transpose ? [dispCol, dispRow] : [dispRow, dispCol];
}
