import type { ItemKind } from './api';

/**
 * How each item looks. Prices and rules live in public.items on the server;
 * this only names and colours the placeholder art for the slugs it returns.
 */
export const ITEMS: Record<
  string,
  { name: string; kind: ItemKind; colour: string; plural?: string }
> = {
  bike: { name: 'Bicycle', kind: 'vehicle', colour: '#5f7f8f' },
  hatchback: { name: 'Hatchback', kind: 'vehicle', colour: '#c4836c' },
  estate: { name: 'Estate car', kind: 'vehicle', colour: '#6d8c78' },
  campervan: { name: 'Campervan', kind: 'vehicle', colour: '#d6c49d' },
  roadster: { name: 'Vintage roadster', kind: 'vehicle', colour: '#8e4b4b' },

  mug: { name: 'Mug', kind: 'desk', colour: '#e9e4da' },
  duck: { name: 'Rubber duck', kind: 'desk', colour: '#e8c547' },
  succulent: { name: 'Succulent', kind: 'desk', colour: '#7fa37a' },
  photo: { name: 'Photo frame', kind: 'desk', colour: '#a68a6d' },
  lamp: { name: 'Desk lamp', kind: 'desk', colour: '#5d6b73' },
  lava_lamp: { name: 'Lava lamp', kind: 'desk', colour: '#b46a9a' },
  radio: { name: 'Radio', kind: 'desk', colour: '#8a6a4f' },
  bonsai: { name: 'Bonsai', kind: 'desk', colour: '#5e8a5a' },

  radish_seeds: { name: 'Radish seeds', kind: 'seed', colour: '#d9798a' },
  carrot_seeds: { name: 'Carrot seeds', kind: 'seed', colour: '#e39a4f' },
  sunflower_seeds: { name: 'Sunflower seeds', kind: 'seed', colour: '#e9c44f' },
  strawberry_seeds: { name: 'Strawberry seeds', kind: 'seed', colour: '#d65f62' },
  tomato_seeds: { name: 'Tomato seeds', kind: 'seed', colour: '#d1543f' },
  pumpkin_seeds: { name: 'Pumpkin seeds', kind: 'seed', colour: '#df8a3a' },

  radish: { name: 'Radish', plural: 'Radishes', kind: 'produce', colour: '#d9798a' },
  carrot: { name: 'Carrot', plural: 'Carrots', kind: 'produce', colour: '#e39a4f' },
  sunflower: { name: 'Sunflower', plural: 'Sunflowers', kind: 'produce', colour: '#e9c44f' },
  strawberry: { name: 'Strawberry', plural: 'Strawberries', kind: 'produce', colour: '#d65f62' },
  tomato: { name: 'Tomato', plural: 'Tomatoes', kind: 'produce', colour: '#d1543f' },
  pumpkin: { name: 'Pumpkin', plural: 'Pumpkins', kind: 'produce', colour: '#df8a3a' },

  cigarette: { name: 'Cigarette', plural: 'Cigarettes', kind: 'cigarette', colour: '#efe9de' },
};

const UNKNOWN = { name: 'Something', kind: 'desk' as ItemKind, colour: '#b9b2a6' };

export const itemInfo = (slug: string) => ITEMS[slug] ?? { ...UNKNOWN, name: slug };

/** "3 tomatoes", "1 tomato", "5 tomato seeds", "1 tomato seed" */
export function countOf(slug: string, qty: number) {
  const info = itemInfo(slug);
  const one = info.kind === 'seed' ? info.name.replace(/s$/, '') : info.name;
  const name = qty === 1 ? one : (info.plural ?? info.name);
  return `${qty} ${name.toLowerCase()}`;
}

/** Desk items you own, in the order they're arranged on a desk. */
export function deskItemsOf(inventory: Record<string, number>) {
  return Object.keys(ITEMS).filter((slug) => ITEMS[slug].kind === 'desk' && inventory[slug]);
}

/** The seed packet a crop grows from, and vice versa. */
export const seedOf = (crop: string) => `${crop}_seeds`;
export const cropOf = (seed: string) => seed.replace(/_seeds$/, '');
