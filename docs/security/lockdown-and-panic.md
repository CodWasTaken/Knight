# Lockdown and Panic

Knight stores one emergency state per server in PostgreSQL. The normal state is `NORMAL`. Every change requires a reason and is written to the Security Ledger. If a Security notification channel is configured, Knight also sends a best-effort notification there.

## Lockdown

Lockdown freezes one fixed scope:

- `MEMBER_MODERATION` blocks warn, timeout, kick, ban, unban, and purge.
- `ROLES` blocks Knight role and Guarded permission changes.
- `CHANNELS` reserves channel configuration and recovery operations for a later supported path.
- `BOTS_WEBHOOKS` blocks firewall configuration changes. Existing Enforce rules may still remove entries already marked Blocked.
- `SECURITY_CONFIG` blocks Staff Profile, Security Manager, policy, protected-resource, logging, and firewall configuration changes.
- `FULL` applies every supported Lockdown restriction.

Use `/security unlock reason:<text>` or the **Clear Lockdown** dashboard form to return to Normal. Unlock cannot clear Panic.

## Panic

Panic freezes privileged Knight mutations and creates a critical incident marker. It does not automatically delete bots or webhooks, strip roles, or rewrite server permissions. A firewall already in Enforce may still remove an inventory entry that was explicitly marked Blocked before Panic.

Panic requires an explicit confirmation. Only `/security panic-clear reason:<text>` or the **Clear Panic** dashboard form can clear it. Status remains readable throughout an incident.

After clearing an emergency state, review the Security Ledger, active incidents, Staff Profile assignments, firewall inventory, and Guarded role snapshots before resuming ordinary changes.
