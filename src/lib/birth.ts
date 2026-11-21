// Dates of birth on the sign-up form, typed day first: 14/03/2009.
// The database keeps them (public.birthdays) and only ever says whether
// you're under 18 (get_me's under_18): see 0021_dates_of_birth.sql.

/** Puts the slashes in as you type: "1403" becomes "14/03". */
export function formatBirth(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}

/** "14/03/2009" as "2009-03-14", or null if it isn't a real date from 1900 to today. */
export function parseBirth(text: string, today = new Date()): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;
  const iso = date.toISOString().slice(0, 10);
  const now = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if (year < 1900 || date > now) return null;
  return iso;
}
