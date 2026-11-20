export const SOURCE_PLAYER_MAX_CODE_POINTS = 300;
export const PLAYER_DISPLAY_MAX_CODE_POINTS =
  SOURCE_PLAYER_MAX_CODE_POINTS * 18;

// Kept in parity with private.normalize_player_display_name/key in the catalogue migration.
const SPACES =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizePlayerDisplayName(value: string): string {
  const name = value
    .normalize("NFKC")
    .replace(SPACES, " ")
    .replace(/^ +| +$/g, "");
  if (
    !name ||
    [...name].length > PLAYER_DISPLAY_MAX_CODE_POINTS ||
    CONTROLS.test(name)
  )
    throw new Error("Use a valid player name.");
  return name;
}

/** ASCII case folding avoids locale-dependent identity merges. */
export function normalizePlayerKey(value: string): string {
  return normalizePlayerDisplayName(value).replace(/[A-Z]/g, (letter) =>
    letter.toLowerCase(),
  );
}
