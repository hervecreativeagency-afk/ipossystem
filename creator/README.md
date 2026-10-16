# iPOS Creator console

A separate, private website for the iPOS creator: crashes, visits on a world map, who is online or offline, all shops and accounts (with email verification status), sign-ups, and the feedback inbox.

- Deployed as its own Vercel project (`ipos-creator`, root directory `creator/`) at **ipos-creator.vercel.app**.
- Uses the same Supabase project as iPOS. All data comes through `creator_*` database functions that only work for the allow-listed, email-verified creator account (`private.platform_creators`, see `../supabase/creator-console.sql`). Shops can't read any of it.
- First visit: "Create your password", then open the verification email, then sign in.

```
cd creator && npm install && npm run dev     # local
npm test                                       # helpers
```
