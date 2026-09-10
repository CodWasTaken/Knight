# Staff action limits

## What and why

Knight action policies can limit how often a Staff Profile may perform a sensitive action. Limits reduce blast radius when an account is compromised or a moderator makes repeated mistakes. Redis stores the operational counters; PostgreSQL remains the authority for the profile and policy.

## How

Open the Staff Profile in the dashboard, enable the action permission, then configure its policy. For the foundation ban test, use `member.ban` with a limit of **2 actions per 30 minutes**.

## Example

```text
1st /member ban -> allowed
2nd /member ban -> allowed
3rd /member ban within 30 minutes -> denied by Knight
```

The denial is part of Knight's guarded authorization path; staff should not work around it with native Discord permissions.

## Security implications

Redis failure must not become an authorization bypass. Knight's security path is designed to fail closed when required operational controls cannot be evaluated. Limits complement rank, permission, mode, and self-escalation checks; they do not replace them.

## Common mistakes

Do not choose a limit so high that it provides no containment value. Do not test a ban limit on real users when a controlled private test target is available. If Redis is unhealthy, resolve `/doctor` or readiness failures rather than repeatedly retrying destructive actions.
