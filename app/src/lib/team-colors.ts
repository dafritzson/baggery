/** A club's tile: its main color, and the color of the letters on it (white unless the fill is light). */
export interface TeamColors {
  bg: string;
  fg: string;
}

const WHITE = '#FFFFFF';

/** By MLB team id. Clubs' own colors, picked so the letters read on the fill in light and dark mode. */
const COLORS: Record<number, TeamColors> = {
  108: { bg: '#BA0021', fg: WHITE }, // LAA
  109: { bg: '#A71930', fg: '#E3D4AD' }, // AZ
  110: { bg: '#DF4601', fg: '#000000' }, // BAL
  111: { bg: '#BD3039', fg: WHITE }, // BOS
  112: { bg: '#0E3386', fg: WHITE }, // CHC
  113: { bg: '#C6011F', fg: WHITE }, // CIN
  114: { bg: '#00385D', fg: '#E31937' }, // CLE
  115: { bg: '#33006F', fg: '#C4CED4' }, // COL
  116: { bg: '#0C2340', fg: '#FA4616' }, // DET
  117: { bg: '#EB6E1F', fg: '#002D62' }, // HOU
  118: { bg: '#004687', fg: '#BD9B60' }, // KC
  119: { bg: '#005A9C', fg: WHITE }, // LAD
  120: { bg: '#AB0003', fg: WHITE }, // WSH
  121: { bg: '#002D72', fg: '#FF5910' }, // NYM
  133: { bg: '#003831', fg: '#EFB21E' }, // ATH
  134: { bg: '#FDB827', fg: '#27251F' }, // PIT
  135: { bg: '#2F241D', fg: '#FFC425' }, // SD
  136: { bg: '#0C2C56', fg: '#C4CED4' }, // SEA
  137: { bg: '#FD5A1E', fg: '#27251F' }, // SF
  138: { bg: '#C41E3A', fg: WHITE }, // STL
  139: { bg: '#092C5C', fg: '#8FBCE6' }, // TB
  140: { bg: '#003278', fg: WHITE }, // TEX
  141: { bg: '#134A8E', fg: WHITE }, // TOR
  142: { bg: '#002B5C', fg: '#D31145' }, // MIN
  143: { bg: '#E81828', fg: WHITE }, // PHI
  144: { bg: '#13274F', fg: '#CE1141' }, // ATL
  145: { bg: '#27251F', fg: '#C4CED4' }, // CWS
  146: { bg: '#00A3E0', fg: '#000000' }, // MIA
  147: { bg: '#0C2340', fg: WHITE }, // NYY
  158: { bg: '#12284B', fg: '#FFC52F' }, // MIL
};

const FALLBACK: TeamColors = { bg: '#475569', fg: WHITE };

export function teamColors(mlbTeamId: number): TeamColors {
  return COLORS[mlbTeamId] ?? FALLBACK;
}
