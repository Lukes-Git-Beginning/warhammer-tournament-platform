/**
 * One-shot script: registers /rizzotto slash commands in the Discord guild.
 *
 * Usage (run once after deploying the interactions endpoint):
 *   DISCORD_BOT_TOKEN=xxx DISCORD_APP_ID=yyy DISCORD_GUILD_ID=zzz \
 *     npx tsx apps/backend/scripts/register-discord-commands.ts
 *
 * DISCORD_APP_ID: Application ID from the Developer Portal ("General Information")
 * DISCORD_GUILD_ID: The ID of the Discord server (right-click server → Copy Server ID)
 */

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !appId || !guildId) {
  console.error('Missing DISCORD_BOT_TOKEN, DISCORD_APP_ID, or DISCORD_GUILD_ID');
  process.exit(1);
}

const commands = [
  {
    name: 'rizzotto',
    description: 'Rizzotto matchmaking commands',
    options: [
      {
        name: 'queue',
        description: 'Join the Open Play queue',
        type: 1, // SUB_COMMAND
        options: [
          {
            name: 'format',
            description: 'Match format (default: BO3)',
            type: 3, // STRING
            required: false,
            choices: [
              { name: 'BO1 — Best of 1', value: 'BO1' },
              { name: 'BO3 — Best of 3', value: 'BO3' },
              { name: 'BO5 — Best of 5', value: 'BO5' },
            ],
          },
        ],
      },
      {
        name: 'unqueue',
        description: 'Leave all Open Play queues',
        type: 1, // SUB_COMMAND
      },
    ],
  },
];

const url = `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  const err = await res.text();
  console.error('Failed to register commands:', err);
  process.exit(1);
}

const data = await res.json();
console.log('Commands registered successfully:');
console.log(JSON.stringify(data, null, 2));
