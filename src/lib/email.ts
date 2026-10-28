/**
 * Mirrors private.is_email and private.normal_email (0017): an address that
 * could really be written to, in lower case, and none of the names kept for
 * tests and examples.
 */
const SHAPE =
  /^[a-z0-9!#%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const KEPT = /(^|\.)(test|example|invalid|localhost|local)$/;
const EXAMPLES = ['example.com', 'example.org', 'example.net'];

export const normalEmail = (raw: string) => raw.trim().toLowerCase();

export function isEmail(raw: string) {
  const email = normalEmail(raw);
  const domain = email.split('@')[1] ?? '';
  return (
    email.length >= 6 &&
    email.length <= 254 &&
    SHAPE.test(email) &&
    !KEPT.test(domain) &&
    !EXAMPLES.includes(domain)
  );
}
