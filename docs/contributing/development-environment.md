# Development environment

## Prerequisites

- Node.js 22 or later
- Git
- npm
- A Discord server for testing
- At least one coding agent provider installed and authenticated on the development host

## Setup

```bash
git clone https://github.com/laurajoyhutchins/discordagent.git
cd discordagent
npm ci
cp .env.example .env
```

Configure `.env` with a Discord bot token, client ID, guild ID, and authorized role IDs (see the [configuration reference](../reference/configuration.md)).

## Development commands

```bash
npm run dev              # Start bot in watch mode (tsx)
npm run build            # Compile TypeScript to dist/
npm run start            # Run compiled bot
npm run register         # Register slash commands in guild
npm run smoke:host       # Run host preflight checks
npm run smoke:discord    # Run Discord connectivity checks
npm run smoke            # Run all smoke checks
```

## Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage
npm run check            # Run tests then build
```

See the [testing guide](testing.md) for testing patterns and conventions.

## Project structure

See the [repository structure guide](repository-structure.md) for the source layout and file conventions.
