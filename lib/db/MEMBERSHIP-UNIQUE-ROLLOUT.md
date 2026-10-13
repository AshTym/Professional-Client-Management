# ClientGuard membership uniqueness rollout

`clientguard_membership_user_unique` allows one firm membership per Clerk user. Before synchronizing the schema, run the read-only preflight:

```sh
pnpm --filter @workspace/db run preflight:memberships
```

Exit code `0` means the target schema has no duplicate membership rows (or has no membership table yet). Exit code `1` lists each conflicting Clerk user and the affected firm, membership, and role IDs; stop the rollout. Exit code `2` means the check could not complete; do not proceed until the database or configuration issue is resolved.

Both supported schema commands run the preflight first:

```sh
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
```

Use these package scripts rather than invoking `drizzle-kit push` directly; a direct CLI invocation bypasses the preflight.

If conflicts are reported:

1. Pause the schema change and review the listed identities with the affected firm administrators.
2. Confirm which firm access should remain for each person, and whether any membership change is authorized. Do not choose a firm automatically.
3. Apply only the explicitly approved membership corrections using the established administrative process. Do not move or delete membership rows automatically, and do not alter client, matter, or other firm records as a side effect.
4. Rerun the preflight. Apply the schema change only after it exits successfully.

The preflight opens a read-only database transaction and never modifies membership data.
