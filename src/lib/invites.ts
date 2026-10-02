/** Invite codes are 8 letters and digits (see private.new_invite_code); shown as ABCD-EFGH. */
export const normaliseInvite = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);

export function formatInvite(raw: string) {
  const code = normaliseInvite(raw);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}
