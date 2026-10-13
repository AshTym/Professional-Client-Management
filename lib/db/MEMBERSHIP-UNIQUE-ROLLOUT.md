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

1. Pause the schema change and ask an owner or admin from each affected firm to review that firm's own access.
2. Each firm admin sees only their local membership and aggregate duplicate counts; do not disclose other firm names or records to them. Each firm admin independently records whether their firm's access should remain or be removed.
3. Apply only the explicitly approved, firm-local decision. A removal cannot delete the firm owner or the acting admin's own access. If the membership owns client or matter assignments, the admin must explicitly select a replacement in the same firm; the records remain in place and the approval is written to the firm's audit history.
4. Rerun the preflight. Apply the schema change only after it exits successfully.

The preflight opens a read-only database transaction and never modifies membership data.
