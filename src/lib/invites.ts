import { Platform, Share } from 'react-native';

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

const web = Platform.OS === 'web' && typeof window !== 'undefined';

/** The link that opens an invite: the Join form, or (signed in) straight in. */
export const inviteLink = (code: string) =>
  web ? `${window.location.origin}/login?invite=${code}` : null;

/**
 * Copies an invite's link where the browser allows, or shares it, with `text`
 * to go with it. Says what happened, for a note under the button.
 */
export async function sendInvite(code: string, text: string, copied: string) {
  const link = inviteLink(code);
  try {
    if (link && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(link);
      return copied;
    }
    await Share.share({ message: link ? `${text}\n${link}` : text });
    return null;
  } catch {
    return link ?? text;
  }
}

const PENDING_KEY = 'focus.invite';

/**
 * An invite link opened in this tab (/login?invite=CODE), until it's used:
 * the Join form starts with it, and once you're signed in (joining or
 * arriving) the app opens it for you. Read as the app loads, because the
 * router may rewrite the URL as it starts, and kept in the tab's storage
 * through a sign-up.
 */
let pending = (() => {
  if (!web) return '';
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('invite');
    if (fromUrl) sessionStorage.setItem(PENDING_KEY, normaliseInvite(fromUrl));
    return normaliseInvite(fromUrl ?? sessionStorage.getItem(PENDING_KEY) ?? '');
  } catch {
    return '';
  }
})();

export const pendingInvite = () => pending;

/** The invite's been used (or turned out not to work), so signing out later shows the sign-in form. */
export function forgetInvite() {
  pending = '';
  try {
    if (web) sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage refused: forgetting it here is enough.
  }
}

/** Holds on to a code typed into the Join form, to open once you're in. */
export function holdInvite(code: string) {
  pending = normaliseInvite(code);
  try {
    if (web) sessionStorage.setItem(PENDING_KEY, pending);
  } catch {
    // Kept in memory instead.
  }
}
