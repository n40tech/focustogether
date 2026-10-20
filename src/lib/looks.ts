/**
 * How someone looks: indexes into the palettes below, and a hairstyle. Mirrors
 * private.is_looks in supabase/migrations/0012_looks.sql, so the lengths here
 * must stay 6, 8 and 6.
 */
export type Looks = {
  skin: number;
  colour: number;
  hair: Hairstyle;
  hair_colour: number;
};

export const HAIRSTYLES = ['short', 'long', 'bun', 'curly', 'shaved'] as const;
export type Hairstyle = (typeof HAIRSTYLES)[number];

// New choices go at the end: the defaults below pick from the first ones.
export const SKINS = [
  { name: 'Fair', hex: '#f0d0b4' },
  { name: 'Light', hex: '#dcae88' },
  { name: 'Tan', hex: '#b47e57' },
  { name: 'Brown', hex: '#7f5539' },
  { name: 'Olive', hex: '#c69a6d' },
  { name: 'Deep brown', hex: '#5c3a26' },
];
/** Favourite colours: your shirt, and your dot on the Friends board. */
export const COLOURS = [
  { name: 'Blue', hex: '#7a8fb0' },
  { name: 'Clay', hex: '#b0857a' },
  { name: 'Sage', hex: '#7aa58f' },
  { name: 'Lilac', hex: '#a88cb5' },
  { name: 'Ochre', hex: '#c2a46e' },
  { name: 'Teal', hex: '#6f9fa8' },
  { name: 'Rose', hex: '#b57a8f' },
  { name: 'Olive', hex: '#8c9b6a' },
];
export const HAIR_COLOURS = [
  { name: 'Dark brown', hex: '#3b2f2a' },
  { name: 'Brown', hex: '#6b4a33' },
  { name: 'Fair', hex: '#a37c4f' },
  { name: 'Black', hex: '#2d2d33' },
  { name: 'Chestnut', hex: '#8a5a3c' },
  { name: 'Grey', hex: '#b5afa6' },
];

const hash = (username: string, seed: number) => {
  let h = seed;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
};

/** How someone looks before they've chosen: picked from their username, as it always was. */
export function defaultLooks(username: string): Looks {
  const n = hash(username, 7);
  return { skin: n % 4, colour: hash(username, 0) % 8, hair: 'short', hair_colour: (n >> 3) % 5 };
}

/** Looks as colours to draw with. */
export function paint(looks: Looks) {
  return {
    skin: SKINS[looks.skin]?.hex ?? SKINS[0].hex,
    shirt: COLOURS[looks.colour]?.hex ?? COLOURS[0].hex,
    hair: HAIR_COLOURS[looks.hair_colour]?.hex ?? HAIR_COLOURS[0].hex,
    style: looks.hair,
  };
}
