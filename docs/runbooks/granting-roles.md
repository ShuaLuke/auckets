# Granting ARTIST / AUCKETS_ADMIN roles

How to give a user elevated access. There is **no self-serve flow** — every grant
is a manual DB step. New signups are `FAN` by default ([`drizzle/schema.ts`](../../drizzle/schema.ts) `users.role` defaults to `"FAN"`). Until granted, an artist or admin only sees the fan dashboard and looks "stuck."

Companion to [`local-dev.md`](local-dev.md) and the higher-level [`RUNBOOK.md`](../RUNBOOK.md). Background: [ADR-0012](../DECISIONS.md#adr-0012--rbac-roles-mvp) (the role model), [PERSONAS.md](../PERSONAS.md) (the onboarding gap this closes).

---

## The model

- **`users.role`** — a TEXT column on the local user mirror, one of `FAN | ARTIST | AUCKETS_ADMIN | VENUE_STAFF` (`VENUE_STAFF` lands by Week 7). Platform-wide. `AUCKETS_ADMIN` is what [`userIsAdmin`](../../src/lib/db/repositories/users.ts) checks.
- **`artist_members`** — a many-to-many join (`artist_id`, `user_id`) that says "this user can manage this artist's shows." This is what [`userCanManageArtist`](../../src/lib/db/repositories/artists.ts) and the nav's `listArtistsManageableByUser` read. **Managing an artist is membership, not a role** — a user with `role = 'FAN'` who is in `artist_members` can still manage that artist.
- `users.id` **is the Clerk `user_id`** (e.g. `user_2abc…`), not an email. The row is created the first time the user hits an authenticated path (`ensureUserMirror`).

---

## Prerequisite: the user must have signed in once

The `users` row doesn't exist until the person has signed in at least once (it's mirrored from Clerk on first authenticated request). **Have them sign up / sign in first**, then grant. If you grant before the row exists, there's nothing to update.

Find their `user_id` and confirm the mirror exists:

```sql
select id, email, role from users where email = 'person@example.com';
```

---

## Where to run these

Use the **Supabase SQL editor** (Dashboard → SQL editor) or `psql` with the service-role/DB-owner connection. RLS is deny-all on every public table, so the app's runtime role can't run these — the SQL editor runs as the table owner and bypasses RLS, which is what you want for an admin operation.

> ⚠️ These are production-data writes. Double-check the email/`user_id` before running. There is no undo beyond running the reverse statement.

---

## Grant AUCKETS_ADMIN (ops / Julia)

```sql
update users set role = 'AUCKETS_ADMIN' where email = 'julia@auckets.com';
```

Verify, then have them reload — the nav's **Requests** link and **Admin** pill appear, and `/admin` + `/admin/requests` resolve instead of 404ing.

To revoke:

```sql
update users set role = 'FAN' where email = 'julia@auckets.com';
```

---

## Grant artist management (e.g. Cope on his own artist)

Two parts: (1) optionally set `role = 'ARTIST'`, and (2) add the `artist_members` row that actually grants management of a specific artist. The membership row is the load-bearing one.

```sql
-- 1. (optional) mark them as an ARTIST platform-wide
update users set role = 'ARTIST' where email = 'cope@example.com';

-- 2. let them manage a specific artist — this is what unlocks the
--    artist dashboard + ShowAdmin for that artist
insert into artist_members (artist_id, user_id)
select a.id, u.id
from artists a, users u
where a.name = 'Citizen Cope'
  and u.email = 'cope@example.com'
on conflict (artist_id, user_id) do nothing;
```

After reload, the artist's name appears in the nav, linking to `/artists/<id>`, and they can open their shows' ShowAdmin. Note: **preview/binding stay admin-only** (NEW-10) — an artist sees placements but doesn't run allocation.

To revoke management of one artist:

```sql
delete from artist_members
where artist_id = (select id from artists where name = 'Citizen Cope')
  and user_id   = (select id from users   where email = 'cope@example.com');
```

---

## Quick checks

```sql
-- who's an admin?
select email, role from users where role = 'AUCKETS_ADMIN';

-- who can manage which artist?
select a.name as artist, u.email
from artist_members m
join artists a on a.id = m.artist_id
join users   u on u.id = m.user_id
order by a.name;
```
