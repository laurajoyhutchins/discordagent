import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("operator package scripts execute compiled production entrypoints", async () => {
  const packageJson = JSON.parse(await readRepositoryFile("package.json"));
  const expectedScripts = {
    register: "node dist/commands/register.js",
    "database:backup": "node dist/commands/databaseMaintenance.js backup",
    "database:verify": "node dist/commands/databaseMaintenance.js verify",
    "database:stage-restore": "node dist/commands/databaseMaintenance.js stage",
    "database:activate-restore": "node dist/commands/databaseMaintenance.js activate",
    "discord:permissions": "node dist/discord/capabilities/calculator.js",
    "smoke:host": "node dist/smoke/hostPreflight.js",
    "smoke:discord": "node dist/smoke/discordConnectivity.js",
    "smoke:agent": "node dist/smoke/agentRoundTrip.js",
  };

  for (const [name, command] of Object.entries(expectedScripts)) {
    assert.equal(packageJson.scripts[name], command, `${name} must use compiled output`);
    assert.ok(!command.includes("tsx"), `${name} must not require a dev dependency`);
  }
});

test("production installer preserves maintenance and smoke entrypoints", async () => {
  const installer = await readRepositoryFile("deploy/install-production.sh");
  const requiredEntrypoints = [
    "dist/index.js",
    "dist/commands/databaseMaintenance.js",
    "dist/commands/register.js",
    "dist/discord/capabilities/calculator.js",
    "dist/smoke/agentRoundTrip.js",
    "dist/smoke/discordConnectivity.js",
    "dist/smoke/hostPreflight.js",
    "dist/smoke/resourceAdmission.js",
  ];

  assert.ok(
    installer.includes('BACKUP_ROOT="${BACKUP_ROOT:-${DATA_ROOT}/backups}"'),
    "installer must define the protected backup root",
  );
  assert.ok(
    installer.includes('"${BACKUP_ROOT}"'),
    "installer must create the protected backup root",
  );

  for (const entrypoint of requiredEntrypoints) {
    assert.ok(
      installer.includes(`"${entrypoint}"`),
      `installer must reject a release missing ${entrypoint}`,
    );
  }
});
