# FS AI — Owner unlock after too many failed logins (close-out B3)

**Date:** 2026-11-23
**What this is:** if the owner dashboard login says "Too many failed login attempts", this page explains why and how to get back in. No password is needed for any step below, and no step here changes any article, setting, or publication.

## Why am I locked out?

After **5 failed login attempts** for one email address, that address cannot log in for **15 minutes**. This is deliberate: it stops someone guessing the owner password over and over.

Three things that are always true, even while locked out:

1. **The lock always ends on its own.** It lasts exactly 15 minutes from the 5th failed attempt. Failed attempts made *during* the 15 minutes do **not** extend it — nobody can keep you locked out by failing again every few minutes.
2. **A login that already worked keeps working.** If you are already signed in to the dashboard on another tab or device, that session stays valid through the whole lockout. The lock only blocks *new* logins.
3. **A correct login clears the count.** One successful login wipes the failed-attempt record for that address, so the count starts again from zero.

The lock is per email address, exactly as typed (capitals do not matter — `Owner@Example.com` and `owner@example.com` are the same lock). Locking one address never locks a different address.

## Option 1 — Just wait (no action needed)

Wait 15 minutes from the last failed attempt, then log in normally with the correct password. Nothing needs to be done, and nothing needs to be undone afterwards.

## Option 2 — Unlock immediately (operator step)

If you cannot wait 15 minutes, the lock can be cleared at once by deleting the lockout record for your email from the database. This removes only the failed-attempt record — it does not touch sessions, articles, or settings.

Run this against the live database (replace `you@example.com` with the exact email address that is locked out):

```sql
DELETE FROM login_attempts WHERE email = 'you@example.com';
```

With the command-line tool, that is:

```bash
wrangler d1 execute fs-ai-db --command "DELETE FROM login_attempts WHERE email = 'you@example.com';"
```

Check it worked (optional — expect no rows back):

```sql
SELECT email, failed_count, locked_until FROM login_attempts WHERE email = 'you@example.com';
```

Then log in normally at once — the lock is gone immediately. If you are not sure which address is locked, list all current locks first:

```sql
SELECT email, failed_count, first_failed_at, last_failed_at, locked_until FROM login_attempts;
```

Delete the row for the address you log in with. There is normally only one row, if any.

## What if the unlock does not work?

- **Check the email spelling.** The lock is on the exact address string that was attacked. Deleting the row for a different spelling changes nothing — list the rows (last query above) and delete the one shown.
- **Check you are using the right password.** After the row is deleted, a wrong password simply starts a new count of 5 — the login page will say "Invalid email or password", not "Too many failed login attempts". Five more wrong passwords lock the address again for 15 minutes.
- **If you are already signed in somewhere, use that session.** It was never locked out. You can keep working in the dashboard while the login lock expires.

## What is stored (privacy)

The lockout record holds only the email address, a failure count, and three timestamps (first failure, last failure, locked-until). It never holds a password, a password hash, an IP address, or browser information.

## If the lockout table does not exist yet

If the login code was deployed before migration `031_login_attempts.sql` was applied to the live database, there is no lockout at all — logins work exactly as before, and the rate limit (30 login attempts per minute per connection) is the only protection. Apply migration 031 to switch the lockout on. A missing table can never lock the owner out.
