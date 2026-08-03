// Terrain slug (from a replay's `terrain/battles/<slug>` path, or a `..._domination_<slug>` key)
// → platform Map name. Built empirically from prod replays (2026-08-03, 35/36 maps covered).
//
// EXTENSIBLE: when a new map appears, add its terrain slug here. An unknown terrain slug makes
// the map check inconclusive (verify skips the map signal — fail-open), never a false mismatch.
export const TERRAIN_TO_MAP: Record<string, string> = {
  battle_for_itza: 'Battle for Itza',
  brt_beach: 'Bordeleaux Landing',
  test_domination_altar_of_the_champion: 'Altar of the Champion',
  test_domination_arachnarok_lair: 'Aracknarock Lair',
  test_domination_bloodforest: 'The Blood Grove',
  test_domination_bray_valley: 'Bray Valley',
  test_domination_celestial_lake: 'Celestial Lake',
  test_domination_de_labor_camp: 'Bleakspire Labor Camp',
  test_domination_dragonisland: 'Eastern Isle Colony',
  test_domination_dunes_of_dom: "Khsar's Cursed Oasis",
  test_domination_hasuts_dom: "Hashut's Oilfields",
  test_domination_he_vortex_diag: 'Edge of the Darkwood',
  test_domination_imperial_ambush_broken: 'Imperial Ambush',
  test_domination_imperial_road: 'Imperial Road',
  test_domination_jade_tomb: 'Jade Tomb',
  test_domination_kislev_incursion: "Rifts at World's Edge",
  test_domination_road_to_talabheim: 'Road to Talabheim',
  test_domination_skjalandir_cave: "Skjalandir's Cave",
  test_domination_sotek_lost_temple: 'Lost Temple of Sotek',
  test_domination_test1export: 'Norscan Rise',
  test_domination_tz_funhouse: "The Changer's Madhouse",
  test_domination_waka_chateau: 'Chateau de Roquefort',
  test_emp_infield_proving_grounds: 'Proving Grounds',
  test_subterranean_glinty_toofs_crag: "Glinty Toof's Crag",
  test_ult_plains_infield_everqueens_garden: 'Glade of the Everqueen',
  waka_def_desert_dunes_of_khaine_070809: 'Dunes of Khaine',
  waka_emp_crater_crystal_lake_0304: 'Crystal Lake',
  waka_grn_badlands_dried_floodplain_0304: 'Dried Floodplain',
  waka_kho_realm_the_blazing_ramparts_101112: 'Blazing Ramparts',
  waka_nur_realm_boils_bogeys_rot_and_pus_010203: 'Putrefying Carcass',
  waka_sla_realm_salacious_supine_sierra_010203: 'Rapturous Expanse',
  waka_tze_realm_whirling_maelstrom_131415: 'Whirling Maelstrom',
  waka_vmp_moor_creeping_swamp_catch0506: 'Creeping Swamp',
  waka_vmp_moor_decrepit_moor_catch0102: 'Decrepit Moor',
  waka_vmp_moor_haunted_vale_catch0910: 'Haunted Vale',
};

/** Resolve a replay terrain slug to a platform Map name, or null when unknown (→ skip map check). */
export function mapNameFromTerrain(terrain: string | null): string | null {
  if (!terrain) return null;
  return TERRAIN_TO_MAP[terrain] ?? null;
}
