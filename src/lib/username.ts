/**
 * Usernames can have accents (josé, zoë, straße). These match
 * private.normal_username and private.username_key in
 * supabase/migrations/0008_accents_and_unfriending.sql.
 */

/** How a typed username is stored: trimmed, lower case, accents composed. */
export const normalUsername = (username: string) => username.trim().toLowerCase().normalize('NFC');

/** Letters with no accent to take off, spelt with a–z instead. */
const SPELT: Record<string, string> = {
  ø: 'o',
  ð: 'd',
  ł: 'l',
  đ: 'd',
  ħ: 'h',
  ı: 'i',
  ŧ: 't',
  ŋ: 'n',
  ŀ: 'l',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  þ: 'th',
};

/**
 * A username's plain spelling: no accents, and ß, æ, ø and friends spelt with
 * a–z. No two players share one, so it's what the account's email is made of.
 */
export const usernameKey = (username: string) =>
  username
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[øðłđħıŧŋŀßæœþ]/g, (c) => SPELT[c]);

/** Accounts are username-based in the UI; Supabase auth needs an email. */
export const usernameToEmail = (username: string) => `${usernameKey(username)}@focus.test`;

/** Whether the server will take it as a username (as private.is_username). */
export const isUsername = (username: string) =>
  username.length >= 3 &&
  username.length <= 20 &&
  username === normalUsername(username) &&
  !/[̀-ͯ]/.test(username) &&
  /^[a-z0-9_]+$/.test(usernameKey(username));
