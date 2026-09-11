# Staff action limits

## What and why

Knight gives each mutating moderation action its own independent rate budget. Limits reduce blast radius when an account is compromised or a moderator repeats a destructive action. PostgreSQL stores the Staff Profile and policy; Redis stores the operational counters.

The independently rate-limited actions are:

- `member.warn`
- `member.timeout`
- `member.kick`
- `member.ban`
- `member.unban`
- `message.purge`

`member.warnings.view` is read-only and deliberately has no rate-limit policy.

## Configure limits

Open a Staff Profile in the dashboard, enable a mutating action, then choose **Unlimited** or **Custom**. A custom policy accepts one to three finite windows. Each window has a positive maximum and a whole-number duration in minutes, hours, or days.

Examples:

```text
member.warn: 10 per 1 hour
member.timeout: 4 per 1 hour AND 12 per 1 day
member.ban: 2 per 30 minutes
message.purge: unlimited
```

All configured windows for one action must allow the operation. A denial for one action does not consume or alter another action's budget.

If a capability is disabled, stale submitted rate rows are discarded and the action is stored disabled with no active windows. Re-enabling it requires choosing the intended Unlimited or Custom policy again.

## Runtime behavior

Knight evaluates permission, target protection/rank, action policy, and Redis rate state in the shared moderation authorization path. A required Redis failure fails closed instead of becoming an authorization bypass.

For example, with `member.ban` set to 2 per 30 minutes:

```text
1st /member ban -> allowed
2nd /member ban -> allowed
3rd /member ban inside the same 30-minute window -> denied
```

The same actor can still have a separate timeout, warning, kick, unban, or purge budget because each action uses an independent counter key.

## Common mistakes

Do not choose limits so high that they provide no containment value. Do not treat `member.warnings.view` as a mutation budget; it has no rate control. Do not work around a Knight denial with native Discord permissions. If Redis or `/doctor` is unhealthy, repair the dependency rather than repeatedly retrying destructive actions.
