
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// =====================================
// CONFIGURATION
// =====================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID =
  process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

const BRAND = "London, Uxbridge";
const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";
const ONE_HOUR = 60 * 60 * 1000;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID/GUILD_ID."
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// =====================================
// DATA STORAGE
// =====================================

const dataDirectory = path.join(__dirname, "data");
const dataFile = path.join(dataDirectory, "bot-data.json");

if (!fs.existsSync(dataDirectory)) {
  fs.mkdirSync(dataDirectory, { recursive: true });
}

function loadData() {
  try {
    if (fs.existsSync(dataFile)) {
      const saved = JSON.parse(
        fs.readFileSync(dataFile, "utf8")
      );

      return {
        shifts: saved.shifts || {},
        operations: saved.operations || {},
        modlogs: saved.modlogs || {},
      };
    }
  } catch (error) {
    console.error("Could not load saved data:", error);
  }

  return {
    shifts: {},
    operations: {},
    modlogs: {},
  };
}

const data = loadData();
const activeTimers = new Map();

function saveData() {
  try {
    fs.writeFileSync(
      dataFile,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error("Could not save data:", error);
  }
}

// =====================================
// COMPONENTS V2
// No accent colours or coloured embeds.
// =====================================

function makeV2(title, description, options = {}) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${title}\n${description || ""}`
    )
  );

  if (options.fields?.length) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    for (const field of options.fields) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**${field.name}**\n${field.value}`
        )
      );
    }
  }

  if (options.footer) {
    container.addSeparatorComponents(
      new SeparatorBuilder()
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${options.footer}`
      )
    );
  }

  if (options.supportButton) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Join Support Server")
          .setStyle(ButtonStyle.Link)
          .setURL(SUPPORT_URL)
      )
    );
  }

  return container;
}

async function replyV2(
  interaction,
  title,
  description,
  options = {}
) {
  return interaction.reply({
    components: [makeV2(title, description, options)],
    flags:
      MessageFlags.IsComponentsV2 |
      (options.ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] },
  });
}

async function sendV2(
  channel,
  title,
  description,
  options = {}
) {
  return channel.send({
    components: [makeV2(title, description, options)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}

// =====================================
// MODERATION LOG STORAGE
// =====================================

function addModlog(guildId, entry) {
  if (!data.modlogs[guildId]) {
    data.modlogs[guildId] = [];
  }

  data.modlogs[guildId].unshift({
    ...entry,
    timestamp: Date.now(),
  });

  data.modlogs[guildId] =
    data.modlogs[guildId].slice(0, 100);

  saveData();
}

// =====================================
// AUTOMATIC SHIFT / OPERATION ENDINGS
// =====================================

function clearTimer(key) {
  const timer = activeTimers.get(key);

  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(key);
  }
}

function scheduleAutomaticEnd(type, record) {
  const key = `${type}:${record.guildId}`;
  clearTimer(key);

  const delay = Math.max(
    0,
    record.endsAt - Date.now()
  );

  const timer = setTimeout(async () => {
    activeTimers.delete(key);

    const collection =
      type === "shift"
        ? data.shifts
        : data.operations;

    const current = collection[record.guildId];

    if (!current || current.endsAt !== record.endsAt) {
      return;
    }

    try {
      const channel = await client.channels.fetch(
        record.channelId
      );

      if (channel?.isTextBased()) {
        if (type === "shift") {
          await sendV2(
            channel,
            "Staff Shift Ended",
            `The staff shift hosted by <@${record.hostId}> has ended automatically.`,
            {
              fields: [
                {
                  name: "Host",
                  value: `<@${record.hostId}>`,
                },
                {
                  name: "Started",
                  value: `<t:${Math.floor(record.startedAt / 1000)}:F>`,
                },
                {
                  name: "Ended",
                  value: `<t:${Math.floor(record.endsAt / 1000)}:F>`,
                },
                {
                  name: "Duration",
                  value: "1 hour",
                },
              ],
              footer: BRAND,
            }
          );
        } else {
          await sendV2(
            channel,
            "Military Operation Ended",
            `The military operation **${record.name}** has ended automatically.`,
            {
              fields: [
                {
                  name: "Operation",
                  value: record.name,
                },
                {
                  name: "Host",
                  value: `<@${record.hostId}>`,
                },
                {
                  name: "Started",
                  value: `<t:${Math.floor(record.startedAt / 1000)}:F>`,
                },
                {
                  name: "Ended",
                  value: `<t:${Math.floor(record.endsAt / 1000)}:F>`,
                },
                {
                  name: "Duration",
                  value: "1 hour",
                },
              ],
              footer: BRAND,
            }
          );
        }
      }
    } catch (error) {
      console.error(
        `Could not post ${type} ending message:`,
        error
      );
    }

    delete collection[record.guildId];
    saveData();
  }, delay);

  activeTimers.set(key, timer);
}

// =====================================
// SLASH COMMAND DEFINITIONS
// There is deliberately NO /setup command.
// =====================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("View detailed bot and server information."),

  new SlashCommandBuilder()
    .setName("rules")
    .setDescription("View the server rules."),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Visit the bot's support server."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a server member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to look up.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Start a one-hour staff shift.")
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Optional information about the shift.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Start a one-hour military operation.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Name of the operation.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Optional operation information.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Name of the training session.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Optional session information.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to warn.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the warning.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily timeout a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to timeout.")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("minutes")
        .setDescription("Timeout length in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the timeout.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.KickMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to kick.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the kick.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to ban.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason for the ban.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages from this channel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete, from 1 to 100.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View recent moderation records.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement in a channel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("The announcement message.")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel to post in; defaults to this channel.")
        .setRequired(false)
    ),
].map(command => command.toJSON());

// =====================================
// REGISTER COMMANDS ON STARTUP
// =====================================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Serving ${client.guilds.cache.size} server(s).`);

  try {
    console.log("Registering slash commands...");

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log(`Registered ${commands.length} slash commands.`);
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  // Restore active timers after a restart.
  for (const record of Object.values(data.shifts)) {
    scheduleAutomaticEnd("shift", record);
  }

  for (const record of Object.values(data.operations)) {
    scheduleAutomaticEnd("operation", record);
  }
});

// =====================================
// COMMAND HANDLER
// =====================================

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;
  const guild = interaction.guild;
  const user = interaction.user;

  try {
    // ---------------------------------
    // PING
    // ---------------------------------

    if (command === "ping") {
      return replyV2(
        interaction,
        "Pong!",
        `The bot is online.\n**WebSocket ping:** ${client.ws.ping} ms`,
        { footer: BRAND }
      );
    }

    // ---------------------------------
    // INFORMATION
    // ---------------------------------

    if (command === "information") {
      if (!guild) {
        return replyV2(
          interaction,
          "London, Uxbridge — Information",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const owner = await guild.fetchOwner().catch(() => null);
      const created = Math.floor(
        guild.createdTimestamp / 1000
      );

      return replyV2(
        interaction,
        "London, Uxbridge — Information",
        "Welcome to the London, Uxbridge information centre. This page provides an overview of the server, the bot, its features and its available commands.",
        {
          fields: [
            {
              name: "Server Details",
              value:
                `**Server name:** ${guild.name}\n` +
                `**Server ID:** ${guild.id}\n` +
                `**Server owner:** ${owner ? `<@${owner.id}>` : "Unavailable"}\n` +
                `**Created:** <t:${created}:F>\n` +
                `**Members:** ${guild.memberCount}`,
            },
            {
              name: "About the Bot",
              value:
                "London, Uxbridge provides staff operation announcements, shift tracking, training announcements and moderation tools. It uses Discord slash commands and Components V2 messages.",
            },
            {
              name: "Staff Operations",
              value:
                "`/staff-shift` — Start a staff shift lasting one hour.\n" +
                "`/military-operation` — Start a named operation lasting one hour.\n" +
                "`/training-session` — Announce a training session.",
            },
            {
              name: "Moderation Commands",
              value:
                "`/warn` — Issue a warning record.\n" +
                "`/timeout` — Temporarily restrict a member.\n" +
                "`/kick` — Remove a member from the server.\n" +
                "`/ban` — Ban a member from the server.\n" +
                "`/purge` — Delete recent messages.\n" +
                "`/modlogs` — View recent records created by this bot.",
            },
            {
              name: "General Commands",
              value:
                "`/ping` — Check bot responsiveness.\n" +
                "`/rules` — View the server rules.\n" +
                "`/userinfo` — View a member's account and server information.\n" +
                "`/help` — Open the support server link.\n" +
                "`/announce` — Publish an announcement.",
            },
            {
              name: "Automatic Features",
              value:
                "Staff shifts and military operations are scheduled to end after one hour. The bot posts an ending notice in the channel where the session was started.",
            },
            {
              name: "Permissions and Responsible Use",
              value:
                "Moderation commands require the relevant Discord permissions. The bot also needs the appropriate server and channel permissions to carry out actions and send messages.",
            },
            {
              name: "Support",
              value:
                `For help, use \`/help\` or visit the [London, Uxbridge support server](${SUPPORT_URL}).`,
            },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // RULES
    // ---------------------------------

    if (command === "rules") {
      return replyV2(
        interaction,
        "Server Rules",
        "Please follow the rules established by the server's leadership.",
        {
          fields: [
            {
              name: "1. Respect",
              value: "Treat all members respectfully. Harassment, bullying and personal attacks are not acceptable.",
            },
            {
              name: "2. Follow Staff Instructions",
              value: "Follow reasonable instructions from authorised staff and raise concerns through the appropriate channels.",
            },
            {
              name: "3. Keep Channels Appropriate",
              value: "Use channels for their intended purposes and avoid spam or disruptive messages.",
            },
            {
              name: "4. No Exploiting or Disruption",
              value: "Do not deliberately disrupt server activities, exploit bot features or misuse commands.",
            },
            {
              name: "5. Follow Discord's Rules",
              value: "You must follow Discord's Terms of Service and Community Guidelines.",
            },
            {
              name: "6. Staff Decisions",
              value: "Moderation actions may be taken when rules are broken. Contact the appropriate staff member if you need to appeal a decision.",
            },
          ],
          footer: "Please also follow any additional rules posted by the server owner.",
        }
      );
    }

    // ---------------------------------
    // HELP
    // ---------------------------------

    if (command === "help") {
      return replyV2(
        interaction,
        "London, Uxbridge Support",
        "Need assistance, have a question or need help with the bot? Join the support server using the button below.",
        {
          supportButton: true,
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // USER INFO
    // ---------------------------------

    if (command === "userinfo") {
      if (!guild) {
        return replyV2(
          interaction,
          "User Information",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const target =
        interaction.options.getUser("user") || user;

      const member = await guild.members
        .fetch(target.id)
        .catch(() => null);

      const created = Math.floor(
        target.createdTimestamp / 1000
      );

      const joined = member?.joinedTimestamp
        ? Math.floor(member.joinedTimestamp / 1000)
        : null;

      return replyV2(
        interaction,
        "User Information",
        `Information for ${target}.`,
        {
          fields: [
            {
              name: "Account",
              value:
                `**Username:** ${target.username}\n` +
                `**User ID:** ${target.id}\n` +
                `**Bot account:** ${target.bot ? "Yes" : "No"}\n` +
                `**Account created:** <t:${created}:F>`,
            },
            {
              name: "Server Membership",
              value:
                `**Member:** ${member ? "Yes" : "Not found"}\n` +
                `**Joined server:** ${joined ? `<t:${joined}:F>` : "Unavailable"}\n` +
                `**Nickname:** ${member?.nickname || "None"}`,
            },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // STAFF SHIFT
    // ---------------------------------

    if (command === "staff-shift") {
      if (!guild) {
        return replyV2(
          interaction,
          "Staff Shift",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      if (data.shifts[guild.id]) {
        return replyV2(
          interaction,
          "Staff Shift Already Active",
          "A staff shift is already active in this server. Wait for it to finish before starting another.",
          { ephemeral: true }
        );
      }

      const information =
        interaction.options.getString("information") ||
        "No additional information provided.";

      const startedAt = Date.now();
      const endsAt = startedAt + ONE_HOUR;

      const record = {
        guildId: guild.id,
        channelId: interaction.channelId,
        hostId: user.id,
        startedAt,
        endsAt,
        information,
      };

      data.shifts[guild.id] = record;
      saveData();

      try {
        await replyV2(
          interaction,
          "Staff Shift Started",
          "A staff shift has started and is scheduled to end automatically in one hour.",
          {
            fields: [
              {
                name: "Host",
                value: `${user} (${user.username})`,
              },
              {
                name: "Started",
                value: `<t:${Math.floor(startedAt / 1000)}:F>`,
              },
              {
                name: "Scheduled End",
                value: `<t:${Math.floor(endsAt / 1000)}:F>\n<t:${Math.floor(endsAt / 1000)}:R>`,
              },
              {
                name: "Duration",
                value: "1 hour",
              },
              {
                name: "Information",
                value: information,
              },
            ],
            footer: BRAND,
          }
        );

        scheduleAutomaticEnd("shift", record);
      } catch (error) {
        delete data.shifts[guild.id];
        saveData();
        throw error;
      }

      return;
    }

    // ---------------------------------
    // MILITARY OPERATION
    // ---------------------------------

    if (command === "military-operation") {
      if (!guild) {
        return replyV2(
          interaction,
          "Military Operation",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      if (data.operations[guild.id]) {
        return replyV2(
          interaction,
          "Operation Already Active",
          "A military operation is already active in this server. Wait for it to finish before starting another.",
          { ephemeral: true }
        );
      }

      const name = interaction.options.getString("name");
      const information =
        interaction.options.getString("information") ||
        "No additional information provided.";

      const startedAt = Date.now();
      const endsAt = startedAt + ONE_HOUR;

      const record = {
        guildId: guild.id,
        channelId: interaction.channelId,
        hostId: user.id,
        name,
        information,
        startedAt,
        endsAt,
      };

      data.operations[guild.id] = record;
      saveData();

      try {
        await replyV2(
          interaction,
          "Military Operation Started",
          `The military operation **${name}** has started and is scheduled to end automatically in one hour.`,
          {
            fields: [
              {
                name: "Operation",
                value: name,
              },
              {
                name: "Host",
                value: `${user} (${user.username})`,
              },
              {
                name: "Started",
                value: `<t:${Math.floor(startedAt / 1000)}:F>`,
              },
              {
                name: "Scheduled End",
                value: `<t:${Math.floor(endsAt / 1000)}:F>\n<t:${Math.floor(endsAt / 1000)}:R>`,
              },
              {
                name: "Duration",
                value: "1 hour",
              },
              {
                name: "Information",
                value: information,
              },
            ],
            footer: BRAND,
          }
        );

        scheduleAutomaticEnd("operation", record);
      } catch (error) {
        delete data.operations[guild.id];
        saveData();
        throw error;
      }

      return;
    }

    // ---------------------------------
    // TRAINING SESSION
    // ---------------------------------

    if (command === "training-session") {
      if (!guild) {
        return replyV2(
          interaction,
          "Training Session",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const name = interaction.options.getString("name");
      const information =
        interaction.options.getString("information") ||
        "No additional information provided.";

      return replyV2(
        interaction,
        "Training Session Announced",
        `A training session has been announced by ${user}.`,
        {
          fields: [
            {
              name: "Session",
              value: name,
            },
            {
              name: "Host",
              value: `${user} (${user.username})`,
            },
            {
              name: "Information",
              value: information,
            },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // WARN
    // ---------------------------------

    if (command === "warn") {
      if (!guild) {
        return replyV2(
          interaction,
          "Warning",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const target = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");

      if (target.id === user.id) {
        return replyV2(
          interaction,
          "Warning Failed",
          "You cannot warn yourself.",
          { ephemeral: true }
        );
      }

      if (target.id === client.user.id) {
        return replyV2(
          interaction,
          "Warning Failed",
          "You cannot warn the bot.",
          { ephemeral: true }
        );
      }

      addModlog(guild.id, {
        type: "Warning",
        targetId: target.id,
        moderatorId: user.id,
        reason,
      });

      return replyV2(
        interaction,
        "Warning Recorded",
        `A warning has been recorded for ${target}.`,
        {
          fields: [
            { name: "Member", value: `${target} (${target.username})` },
            { name: "Moderator", value: `${user}` },
            { name: "Reason", value: reason },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // TIMEOUT
    // ---------------------------------

    if (command === "timeout") {
      if (!guild) {
        return replyV2(
          interaction,
          "Timeout",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const target = interaction.options.getUser("user");
      const minutes = interaction.options.getInteger("minutes");
      const reason =
        interaction.options.getString("reason") ||
        "No reason provided.";

      const member = await guild.members
        .fetch(target.id)
        .catch(() => null);

      if (!member) {
        return replyV2(
          interaction,
          "Timeout Failed",
          "That member could not be found in this server.",
          { ephemeral: true }
        );
      }

      if (
        target.id === user.id ||
        target.id === client.user.id
      ) {
        return replyV2(
          interaction,
          "Timeout Failed",
          "You cannot timeout yourself or the bot.",
          { ephemeral: true }
        );
      }

      if (!member.moderatable) {
        return replyV2(
          interaction,
          "Timeout Failed",
          "I cannot timeout this member. Check my permissions and role position.",
          { ephemeral: true }
        );
      }

      await member.timeout(minutes * 60 * 1000, reason);

      addModlog(guild.id, {
        type: "Timeout",
        targetId: target.id,
        moderatorId: user.id,
        reason,
        duration: `${minutes} minutes`,
      });

      return replyV2(
        interaction,
        "Member Timed Out",
        `${target} has been timed out successfully.`,
        {
          fields: [
            { name: "Member", value: `${target}` },
            { name: "Duration", value: `${minutes} minutes` },
            { name: "Reason", value: reason },
            { name: "Moderator", value: `${user}` },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // KICK
    // ---------------------------------

    if (command === "kick") {
      if (!guild) {
        return replyV2(
          interaction,
          "Kick",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const target = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") ||
        "No reason provided.";

      const member = await guild.members
        .fetch(target.id)
        .catch(() => null);

      if (!member) {
        return replyV2(
          interaction,
          "Kick Failed",
          "That member could not be found in this server.",
          { ephemeral: true }
        );
      }

      if (
        target.id === user.id ||
        target.id === client.user.id
      ) {
        return replyV2(
          interaction,
          "Kick Failed",
          "You cannot kick yourself or the bot.",
          { ephemeral: true }
        );
      }

      if (!member.kickable) {
        return replyV2(
          interaction,
          "Kick Failed",
          "I cannot kick this member. Check my permissions and role position.",
          { ephemeral: true }
        );
      }

      await member.kick(reason);

      addModlog(guild.id, {
        type: "Kick",
        targetId: target.id,
        moderatorId: user.id,
        reason,
      });

      return replyV2(
        interaction,
        "Member Kicked",
        `${target.username} has been kicked from the server.`,
        {
          fields: [
            { name: "Member", value: `${target.username} (${target.id})` },
            { name: "Moderator", value: `${user}` },
            { name: "Reason", value: reason },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // BAN
    // ---------------------------------

    if (command === "ban") {
      if (!guild) {
        return replyV2(
          interaction,
          "Ban",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const target = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") ||
        "No reason provided.";

      if (
        target.id === user.id ||
        target.id === client.user.id
      ) {
        return replyV2(
          interaction,
          "Ban Failed",
          "You cannot ban yourself or the bot.",
          { ephemeral: true }
        );
      }

      await guild.members.ban(target.id, { reason });

      addModlog(guild.id, {
        type: "Ban",
        targetId: target.id,
        moderatorId: user.id,
        reason,
      });

      return replyV2(
        interaction,
        "Member Banned",
        `${target.username} has been banned from the server.`,
        {
          fields: [
            { name: "Member", value: `${target.username} (${target.id})` },
            { name: "Moderator", value: `${user}` },
            { name: "Reason", value: reason },
          ],
          footer: BRAND,
        }
      );
    }

    // ---------------------------------
    // PURGE
    // ---------------------------------

    if (command === "purge") {
      if (!guild || !interaction.channel?.isTextBased()) {
        return replyV2(
          interaction,
          "Purge",
          "Use this command in a text channel.",
          { ephemeral: true }
        );
      }

      const amount = interaction.options.getInteger("amount");

      if (!interaction.channel.bulkDelete) {
        return replyV2(
          interaction,
          "Purge Failed",
          "This channel does not support bulk message deletion.",
          { ephemeral: true }
        );
      }

      const deleted = await interaction.channel.bulkDelete(
        amount,
        true
      );

      addModlog(guild.id, {
        type: "Purge",
        targetId: "N/A",
        moderatorId: user.id,
        reason: `Deleted ${deleted.size} messages in ${interaction.channel}`,
      });

      return replyV2(
        interaction,
        "Messages Deleted",
        `Deleted **${deleted.size}** recent messages. Messages older than 14 days cannot be bulk-deleted.`,
        { ephemeral: true, footer: BRAND }
      );
    }

    // ---------------------------------
    // MODERATION LOGS
    // ---------------------------------

    if (command === "modlogs") {
      if (!guild) {
        return replyV2(
          interaction,
          "Moderation Logs",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const entries = (data.modlogs[guild.id] || []).slice(0, 10);

      if (!entries.length) {
        return replyV2(
          interaction,
          "Moderation Logs",
          "There are no moderation records stored by this bot yet.",
          { ephemeral: true, footer: BRAND }
        );
      }

      const description = entries.map((entry, index) => {
        const timestamp = Math.floor(entry.timestamp / 1000);

        return (
          `**${index + 1}. ${entry.type}** — <t:${timestamp}:R>\n` +
          `**Member:** ${entry.targetId === "N/A" ? "Not applicable" : `<@${entry.targetId}>`}\n` +
          `**Moderator:** <@${entry.moderatorId}>\n` +
          `**Reason:** ${entry.reason || "No reason provided."}`
        );
      }).join("\n\n");

      return replyV2(
        interaction,
        "Recent Moderation Logs",
        description,
        {
          ephemeral: true,
          footer: "Showing up to 10 recent records stored by this bot.",
        }
      );
    }

    // ---------------------------------
    // ANNOUNCE
    // ---------------------------------

    if (command === "announce") {
      if (!guild) {
        return replyV2(
          interaction,
          "Announcement",
          "Use this command inside a server.",
          { ephemeral: true }
        );
      }

      const message = interaction.options.getString("message");
      const destination =
        interaction.options.getChannel("channel") ||
        interaction.channel;

      if (!destination?.isTextBased() || !destination.send) {
        return replyV2(
          interaction,
          "Announcement Failed",
          "Please select a text channel that can receive messages.",
          { ephemeral: true }
        );
      }

      await sendV2(
        destination,
        "Server Announcement",
        message,
        {
          fields: [
            {
              name: "Published By",
              value: `${user}`,
            },
          ],
          footer: BRAND,
        }
      );

      return replyV2(
        interaction,
        "Announcement Published",
        `Your announcement has been posted in ${destination}.`,
        { ephemeral: true }
      );
    }
  } catch (error) {
    console.error(`Error in /${command}:`, error);

    const message =
      "Something went wrong while running this command. Check the bot's permissions and hosting logs.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          components: [
            makeV2("Command Error", message, {
              footer: BRAND,
            }),
          ],
          flags:
            MessageFlags.IsComponentsV2 |
            MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
      } else {
        await replyV2(
          interaction,
          "Command Error",
          message,
          { ephemeral: true }
        );
      }
    } catch (replyError) {
      console.error("Could not send error response:", replyError);
    }
  }
});

// =====================================
// START BOT
// =====================================

client.login(TOKEN);
