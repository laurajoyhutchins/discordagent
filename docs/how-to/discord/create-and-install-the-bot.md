# How to create and install the Discord bot

Create a Discord application, configure its bot user, and install it in a private server with the permissions Discord Agent requests.

## Prerequisites

- A private Discord server where you have **Manage Server** permission
- Access to the [Discord Developer Portal](https://discord.com/developers/applications)
- Discord Agent cloned locally with dependencies installed:

  ```bash
  git clone https://github.com/laurajoyhutchins/discordagent.git
  cd discordagent
  npm ci
  ```

Run the commands below from that checkout.

## Procedure

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Open **General Information** and copy the **Application ID**. Use it as `DISCORD_CLIENT_ID`.
3. Open **Bot**. Newly created Discord applications normally include a bot user; create one if the portal presents that option.
4. Under **Token**, reset and copy the token. Use it as `DISCORD_TOKEN` and treat it like a password.
5. Under **Privileged Gateway Intents**, enable:
   - **Server Members Intent** — required for role-based authorization;
   - **Message Content Intent** — required to receive natural-language task prompts.
6. Copy the IDs needed for configuration:
   - the private server ID as `DISCORD_GUILD_ID`;
   - one or more trusted role IDs as `AUTHORIZED_ROLE_IDS`;
   - the owner's user ID as `AUTHORIZED_USER_ID`.
7. Configure those values in `.env` before running the connectivity checks.
8. Generate the least-privilege installation URL:

   ```bash
   npm run discord:permissions
   ```

9. Open the printed URL, choose **Add to server**, select the private server, and authorize the application. Do not grant **Administrator**.

The installation uses the `bot` and `applications.commands` OAuth scopes. Bot permissions, OAuth scopes, Gateway intents, and application features are distinct; see the capability reference for the complete mapping.

## Verification

Confirm that the application appears in the server member list. It remains offline until Discord Agent starts.

After registering commands, verify the complete connection:

```bash
npm run register
npm run smoke:discord
```

## Related

- [Configure permissions and intents](configure-permissions-and-intents.md)
- [Diagnose Discord connectivity](diagnose-discord-connectivity.md)
- [Discord capabilities reference](../../reference/discord-capabilities.md)
