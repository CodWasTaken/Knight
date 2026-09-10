# 2. Create the Discord application

## What and why

Knight uses one Discord application for the bot and dashboard OAuth. The bot performs Discord actions; OAuth identifies dashboard users. Knight still applies its own PostgreSQL authorization after OAuth.

## How

1. In the Discord Developer Portal, create an application and add a bot.
2. Copy the Application/Client ID, bot token, and OAuth client secret into a password manager. You will place them in `.env` later.
3. Under bot privileged intents, enable **Guild Members**.
4. **Message Content is not required** by Knight's foundation commands.
5. Add this OAuth redirect URL, replacing the host with your `APP_URL`:

```text
${APP_URL}/api/auth/callback/discord
```

## Example

For a local setup with `APP_URL=http://localhost:3000`, register `http://localhost:3000/api/auth/callback/discord` as the Discord OAuth redirect.

## Security implications

The bot token and client secret are credentials, not IDs. Never paste them into Discord messages, screenshots, issue reports, source files, or browser-side code. If either credential is exposed, rotate it in Discord before continuing.

## Common mistakes

A frequent OAuth failure is a callback that differs by scheme, hostname, port, or path. Another is enabling Message Content unnecessarily; Knight does not need it for this milestone.
