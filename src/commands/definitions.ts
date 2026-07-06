import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('add-project')
    .setDescription('Register a project for Claude Code orchestration')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Project name (used for category)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('path').setDescription('Absolute path to the project directory').setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('roborev').setDescription('Enable Roborev code review integration (auto-detected if omitted)').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('list-projects')
    .setDescription('List all registered projects'),

  new SlashCommandBuilder()
    .setName('remove-project')
    .setDescription('Remove a project and clean up its channels')
    .addStringOption(opt =>
      opt.setName('name').setDescription('Project name to remove').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel the active Claude session in this channel'),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Run a prompt on a recurring interval')
    .addStringOption(opt =>
      opt.setName('prompt').setDescription('The prompt to run repeatedly').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('interval').setDescription('Interval between runs (e.g. 5m, 1h, 30s). Default: 10m').setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('stop-loop')
    .setDescription('Stop the running loop in this channel'),

  new SlashCommandBuilder()
    .setName('usage')
    .setDescription('Show Claude Code rate limit usage and session stats'),

  new SlashCommandBuilder()
    .setName('model')
    .setDescription('Pick which Claude model to use for this project')
    .addStringOption(opt =>
      opt.setName('model')
        .setDescription('Choose a model')
        .setRequired(false)
        .addChoices(
          { name: 'Claude Sonnet — balanced speed & capability (recommended)', value: 'sonnet' },
          { name: 'Claude Opus — most powerful reasoning', value: 'opus' },
          { name: 'Claude Haiku — fastest, lightweight tasks', value: 'haiku' },
          { name: 'Default (env/SDK)', value: '__default__' },
        )
    )
    .addStringOption(opt =>
      opt.setName('custom').setDescription('Set a custom model name directly (alias or exact model ID)').setRequired(false)
    ),
];
