---
"@trakoo/better-auth": major
---

First release of `@trakoo/better-auth`, a Better Auth plugin that sends typed trakoo events for auth lifecycle changes: sign-ups, sign-ins, sign-outs, sessions, password and email changes, organizations, members, invitations and teams, API keys, admin actions, two-factor, passkeys, anonymous users, SSO providers and Stripe subscriptions. Merge its `authEvents` registry into your own and add `trakooAuth({ analytics })` last in Better Auth's `plugins`.

- Registers events only for the Better Auth plugins you install, and team events only when teams are enabled.
- Reports database changes after their transaction commits, and nothing for failed requests.
- Identifies users on sign-up, sign-in and profile or email changes. Email and name go only through identify, plus the email on `user_signed_up`'s user context for email tools such as Bento.
- Never sends passwords, tokens, API key values, OTPs or 2FA secrets.
- Sends events after the response, through Better Auth's `advanced.backgroundTasks.handler` or Vercel's `waitUntil`, and never throws into Better Auth.
- Sets EmitKit channel and notify hints on every event.

Requires `better-auth` 1.7 or later.
