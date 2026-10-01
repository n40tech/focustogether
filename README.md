# Focus

Multiplayer focus timer. Expo (iOS / Android / web) + Supabase.

## One-time Supabase setup
1. **SQL Editor → New query**: paste `supabase/migrations/0001_init.sql`, then run it.
2. **Authentication → Users → Add user → Create new user** (tick *Auto Confirm User*):
   - `alice@focus.test`
   - `bob@focus.test`
3. **SQL Editor**: paste `supabase/seed.sql`, then run it. It should list `alice` and `bob`.

Sign in with the username (`alice` / `bob`) and the password you set.

## Run
```bash
npm install
npx expo start          # scan the QR code with Expo Go on your phone
npx expo start --web    # or open in the browser
```
`.env` needs `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`).

## Rules
- **Focused**: in a session of up to 120 min. Completing it earns 1 point per minute. Cancelling earns nothing.
- **On break**: completed a session in the last 80 min and hasn't tapped *Leave*.
- **Absent**: everything else.

All rules live in Postgres functions (`supabase/migrations`). The app only calls `supabase.rpc(...)`.
