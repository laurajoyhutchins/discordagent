import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('add-project')
    .setDescription('Register a project for agent orchestration')
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
    .setDescription('Cancel the active agent task in this thread'),

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
    .setName('agents')
    .setDescription('Show active agent tasks and reserved capacity'),

  new SlashCommandBuilder()
    .setName('usage')
    .setDescription('Show provider rate limit usage and task stats'),

  new SlashCommandBuilder()
    .setName('capabilities')
    .setDescription('Show effective Discord capabilities in this channel'),

  new SlashCommandBuilder()
    .setName('settings')
    .setDescription('View and edit global agent and PM settings in the primary channel'),

  new SlashCommandBuilder()
    .setName('project-settings')
    .setDescription('View and edit settings for the current project channel'),


  new SlashCommandBuilder()
    .setName('provider')
    .setDescription('Show or change the default agent provider globally or for this project')
    .addStringOption(opt =>
      opt.setName('provider')
        .setDescription('Provider for new task threads')
        .setRequired(false)
        .addChoices(
          { name: 'Claude', value: 'claude' },
          { name: 'Codex', value: 'codex' },
          { name: 'OpenCode', value: 'opencode' },
        )
    ),



  new SlashCommandBuilder()
    .setName('codex-auth')
    .setDescription('Manage local Codex authentication')
    .addSubcommand(command => command.setName('status').setDescription('Check Codex authentication state'))
    .addSubcommand(command => command.setName('login').setDescription('Start private device-code sign-in'))
    .addSubcommand(command => command.setName('logout').setDescription('Log out Codex after confirmation')),

  new SlashCommandBuilder()
    .setName('model')
    .setDescription("Set this project's model and thinking depth")
    .addStringOption(opt =>
      opt.setName('model')
        .setDescription('Set a provider-scoped model alias or exact model ID (use custom for provider-specific choices)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('custom').setDescription('Set a custom model name directly (alias or exact model ID)').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('thinking')
        .setDescription('Codex reasoning effort for new and continued task turns')
        .setRequired(false)
        .addChoices(
          { name: 'Default (model/provider)', value: '__default__' },
          { name: 'None', value: 'none' },
          { name: 'Low', value: 'low' },
          { name: 'Medium', value: 'medium' },
          { name: 'High', value: 'high' },
          { name: 'Extra high', value: 'xhigh' },
          { name: 'Maximum', value: 'max' },
        )
    ),
];
