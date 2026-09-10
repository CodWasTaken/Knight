# 5. Invite Knight

## What and why

Knight needs enough Discord capability to inspect the server and perform the actions you explicitly route through it. Its role must also outrank every mapped staff role it may edit during Guarded migration.

## How

Create a Discord install/invite for the Knight bot and add it to the target server. Grant the permissions required by your enabled features. For the foundation `/doctor` checks, pay particular attention to:

- View Audit Log
- Ban Members
- Manage Roles

After joining, move Knight's role above every Discord role that will be mapped to a Knight Staff Profile.

## Example

If `Moderator` is the mapped role for a Staff Profile, the server role list should place `Knight` above `Moderator`. `/doctor` should then report the mapped-role hierarchy as healthy.

## Security implications

Do not give Knight broad permissions merely to silence a warning. Grant the minimum permissions needed for the features you intend to use. Manage Roles is powerful; Knight uses it for controlled mapped-role synchronization and Guarded migration.

## Common mistakes

A role can have Manage Roles and still be unable to modify a role at or above its own hierarchy position. Also remember that manually granting somebody the mapped Discord role does not grant Knight authority; the PostgreSQL staff assignment remains authoritative.
