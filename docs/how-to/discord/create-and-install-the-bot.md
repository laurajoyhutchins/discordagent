# How to create and install the Discord bot

Create a Discord application, configure the bot, and invite it to your server.

## Prerequisites

- A Discord server where you have **Manage Server** permissions
- Access to the [Discord Developer Portal](https://discord.com/developers/applications)

## Procedure

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Give it a name — this will be visible in Discord.
2. Go to **Bot** and click **Add Bot**.
3. Under the bot's username, click **Reset Token** and copy the new token. This is `DISCORD_TOKEN`.
4. Go to **General Information** and copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
5. Enable privileged Gateway Intents under **Bot > Privileged Gateway Intents**:
   - **Server Members Intent** — required for role-based authorization
   - **Message Content Intent** — required to read task prompts
6. Generate an invite URL using the permission calculator:

   ```bash
   npm run discord:permissions
   ```

   Copy the printed URL and open it in a browser.
7. Select your server from the dropdown and click **Authorize**. Complete the CAPTCHA.
8. Confirm the bot appears in your server's member list (offline until started).

## Verification

Check the bot appears in Server Settings > Members. Confirm it has the expected role (usually at the bottom of the role list).

## Related

- [Configure permissions and intents](configure-permissions-and-intents.md) — detailed permission breakdown
- [Diagnose Discord connectivity](diagnose-discord-connectivity.md) — smoke test the connection
- [Discord capabilities reference](../../reference/discord-capabilities.md) — complete capability catalog
