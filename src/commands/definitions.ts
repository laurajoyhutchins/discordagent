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
];
