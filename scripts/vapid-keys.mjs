// Makes a VAPID key pair for web push, and writes it to a file git ignores.
//
//   npm run vapid-keys -- supabase/functions/.env      (the local Supabase)
//   npm run vapid-keys -- .env.vapid.local             (the real project)
//
// The public key goes in the app (EXPO_PUBLIC_VAPID_PUBLIC_KEY) and in the
// "push" Edge Function's secrets with the private key. Only the public key
// is printed: copy the private one from the file, and keep it out of git.
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Which file? For example: npm run vapid-keys -- supabase/functions/.env');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
// The public key as browsers want it: an uncompressed point (0x04, x, y), URL-safe base64.
const raw = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, 'base64url'),
  Buffer.from(pub.y, 'base64url'),
]).toString('base64url');

fs.appendFileSync(file, `VAPID_PUBLIC_KEY=${raw}\nVAPID_PRIVATE_KEY=${priv.d}\n`);
console.log(`Wrote a key pair to ${file}. The public key:\n${raw}`);
