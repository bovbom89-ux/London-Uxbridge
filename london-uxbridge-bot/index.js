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
  ButtonStyle
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID =
  process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";
const BRAND = "London, Uxbridge";
const ACCENT = 0x3F5378;
const ONE_HOUR = 60 * 60 * 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// Persistent data
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Could not load saved data:", error);
  }

  return {
    shifts: [],
    operations: [],
    modlogs: []
  };
}

const savedData = loadData();

const shifts = new Map(
  (savedData.shifts || []).map(item => [item.id, item])
);

const operations = new Map(
  (savedData.operations || []).map(item => [item.id, item])
);

const modlogs = new Map(savedData.modlogs || []);

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({
        shifts: [...shifts.values()],
        operations: [...operations.values()],
        modlogs: [...modlogs.entries()]
      }, null, 2)
    );
  } catch (error) {
    console.error("Could not save bot data:", error);
  }
}

// Components V2 message builder
function makeV2(title, description, options = {}) {
  const container = new ContainerBuilder()
    .setAccentColor(options.color ?? ACCENT)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `# ${title}\n\n${description}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ${BRAND}`
      )
    );

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

async function sendV2(channel, title, description, options = {}) {
  return channel.send({
    components: [makeV2(title, description, options)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  });
}

async function replyV2(interaction, title, description, options = {}) {
  const payload = {
    components: [makeV2(title, description, options)],
    flags:
      MessageFlags.IsComponentsV2 |
      (options.ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] }
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function getReason(interaction) {
  return interaction.options.getString("reason") ||
    "No reason provided.";
}

function addModlog(guildId, userId, action) {
  const key = `${guildId}:${userId}`;
  const entries = modlogs.get(key) || [];

  entries.push({
    action,
    moderator: "Unknown",
    timestamp: Date.now()
  });

  modlogs.set(key, entries.slice(-50));
  saveData();
}

function recordModlog(guildId, userId, action, moderatorId) {
  const key = `${guildId}:${userId}`;
  const entries = modlogs.get(key) || [];

  entries.push({
    action,
    moderator: moderatorId,
    timestamp: Date.now()
  });

  modlogs.set(key, entries.slice(-50));
  saveData();
}

// Timed shift and operation announcements
async function endAutomatically(record) {
  try {
    const channel = await client.channels.fetch(record.channelId);

    if (channel && channel.isTextBased()) {
      const elapsed = Math.max(
        0,
        Math.floor((record.endsAt - record.startedAt) / 60000)
      );

      const isShift = record.type === "shift";

      await sendV2(
        channel,
        isShift ? "Staff Shift Has Ended" : "Military Operation Has Ended",
        `**Host:** ${record.hostName}\n` +
        `**Host ID:** \`${record.hostId}\`\n` +
        `**Started:** <t:${Math.floor(record.startedAt / 1000)}:F>\n` +
        `**Ended:** <t:${Math.floor(record.endsAt / 1000)}:F>\n` +
        `**Duration:** ${elapsed} minutes\n` +
        `**Information:** ${record.details || "No additional details."}\n\n` +
        "The scheduled one-hour session has now concluded.",
        { color: 0x718096 }
      );
    }
  } catch (error) {
    console.error("Could not send automatic ending message:", error);
  } finally {
    if (record.type === "shift") {
      shifts.delete(record.id);
    } else {
      operations.delete(record.id);
    }

    saveData();
  }
}

function scheduleEnding(record) {
  const remaining = record.endsAt - Date.now();

  if (remaining <= 0) {
    endAutomatically(record);
    return;
  }

  const timer = setTimeout(() => {
    endAutomatically(record);
  }, remaining);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function startTimedSession(record) {
  if (record.type === "shift") {
    shifts.set(record.id, record);
  } else {
    operations.set(record.id, record);
  }

  saveData();
  scheduleEnding(record);
}

// Slash commands
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's online status and latency."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("View information about London, Uxbridge."),

  new SlashCommandBuilder()
    .setName("rules")
    .setDescription("View the server rules and conduct expectations."),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Open the London, Uxbridge support server."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View account and server membership information.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user whose information you want to view.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Host a staff shift with an automatic one-hour ending.")
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Information about the shift.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Host a military operation lasting one hour.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("The name of the military operation.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Additional operation information.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a staff training session.")
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Training details, time and location.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue and record a warning for a server member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member receiving the warning.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("The reason for the warning.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily prevent a member from communicating.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to timeout.")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("minutes")
        .setDescription("Timeout duration in minutes (1–40320).")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("The reason for the timeout.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Remove a member from the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to kick.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("The reason for the kick.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user to ban.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("The reason for the ban.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete up to 100 recent messages.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("The number of messages to delete (1–100).")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View recorded moderation actions for a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The user whose moderation history to view.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post a formatted server announcement.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("The announcement message.")
        .setRequired(true)
    )
];

// Bot startup
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  if (!CLIENT_ID || !GUILD_ID) {
    console.error(
      "Missing DISCORD_CLIENT_ID or DISCORD_GUILD_ID/GUILD_ID."
    );
    return;
  }

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log(`Registered ${commands.length} slash commands.`);

    // Restore active timers after a restart.
    for (const record of shifts.values()) {
      scheduleEnding(record);
    }

    for (const record of operations.values()) {
      scheduleEnding(record);
    }

    console.log("Restored saved session timers.");
  } catch (error) {
    console.error("Startup or command registration failed:", error);
  }
});

// Command handler
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    const command = interaction.commandName;

    if (command === "ping") {
      return replyV2(
        interaction,
        "Pong!",
        `**Status:** Online\n**Latency:** ${client.ws.ping} ms`
      );
    }

    if (command === "information") {
      return replyV2(
        interaction,
        "London, Uxbridge",
        "Welcome to **London, Uxbridge**.\n\n" +
        "This bot supports server operations, staff shifts, training sessions and moderation.\n\n" +
        `**Support:** [Join our support server](${SUPPORT_URL})`
      );
    }

    if (command === "rules") {
      return replyV2(
        interaction,
        "Server Rules",
        "**1. Respect everyone.** Treat members and staff appropriately.\n\n" +
        "**2. Follow staff instructions.** Cooperate with authorised staff.\n\n" +
        "**3. No spam.** Keep channels organised and relevant.\n\n" +
        "**4. No abuse of commands.** Use moderation and operation commands responsibly.\n\n" +
        "**5. Follow Discord's Terms of Service.**\n\n" +
        "**6. Use the correct channels.** Keep discussions in their appropriate places."
      );
    }

    if (command === "help") {
      return replyV2(
        interaction,
        "London, Uxbridge Support",
        "Need help with the bot or server?\n\n" +
        "Join our support server using the button below to get assistance.",
        { supportButton: true }
      );
    }

    if (command === "userinfo") {
      const user =
        interaction.options.getUser("user") || interaction.user;

      const member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

      const joined = member?.joinedAt
        ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>`
        : "Not a member of this server.";

      return replyV2(
        interaction,
        "User Information",
        `**Username:** ${user.username}\n` +
        `**Mention:** <@${user.id}>\n` +
        `**User ID:** \`${user.id}\`\n` +
        `**Account Created:** <t:${Math.floor(user.createdAt.getTime() / 1000)}:F>\n` +
        `**Joined Server:** ${joined}\n` +
        `**Bot Account:** ${user.bot ? "Yes" : "No"}`
      );
    }

    if (command === "staff-shift") {
      const host = interaction.user;
      const id = `${interaction.guildId}:${host.id}`;
      const channel = interaction.channel;

      if (!channel || !channel.isTextBased()) {
        return replyV2(
          interaction,
          "Unable to Start Shift",
          "Use this command in a text channel.",
          { ephemeral: true }
        );
      }

      if (shifts.has(id)) {
        return replyV2(
          interaction,
          "Shift Already Active",
          "You already have an active staff shift.",
          { ephemeral: true }
        );
      }

      const now = Date.now();
      const details =
        interaction.options.getString("information") ||
        "No additional information provided.";

      const record = {
        id,
        type: "shift",
        guildId: interaction.guildId,
        channelId: channel.id,
        hostId: host.id,
        hostName: host.username,
        details,
        startedAt: now,
        endsAt: now + ONE_HOUR
      };

      startTimedSession(record);

      return replyV2(
        interaction,
        "Staff Shift Started",
        `**Host:** <@${host.id}>\n` +
        `**Start Time:** <t:${Math.floor(now / 1000)}:F>\n` +
        `**Scheduled End:** <t:${Math.floor(record.endsAt / 1000)}:F>\n` +
        `**Duration:** 1 hour\n` +
        `**Information:** ${details}\n\n` +
        "The bot will automatically announce when this shift ends."
      );
    }

    if (command === "military-operation") {
      const host = interaction.user;
      const id = interaction.guildId;
      const channel = interaction.channel;

      if (!channel || !channel.isTextBased()) {
        return replyV2(
          interaction,
          "Unable to Start Operation",
          "Use this command in a text channel.",
          { ephemeral: true }
        );
      }

      if (operations.has(id)) {
        return replyV2(
          interaction,
          "Operation Already Active",
          "A military operation is already active in this server.",
          { ephemeral: true }
        );
      }

      const now = Date.now();
      const name = interaction.options.getString("name", true);
      const details =
        interaction.options.getString("information") ||
        "No additional information provided.";

      const record = {
        id,
        type: "operation",
        guildId: interaction.guildId,
        channelId: channel.id,
        hostId: host.id,
        hostName: host.username,
        details: `**Operation:** ${name}\n${details}`,
        startedAt: now,
        endsAt: now + ONE_HOUR
      };

      startTimedSession(record);

      return replyV2(
        interaction,
        "Military Operation Started",
        `**Operation:** ${name}\n` +
        `**Host:** <@${host.id}>\n` +
        `**Start Time:** <t:${Math.floor(now / 1000)}:F>\n` +
        `**Scheduled End:** <t:${Math.floor(record.endsAt / 1000)}:F>\n` +
        `**Duration:** 1 hour\n` +
        `**Information:** ${details}\n\n` +
        "The bot will automatically announce when this operation ends."
      );
    }

    if (command === "training-session") {
      const information =
        interaction.options.getString("information", true);

      return replyV2(
        interaction,
        "Training Session",
        `**Host:** <@${interaction.user.id}>\n` +
        `**Scheduled:** To be confirmed by the host\n\n` +
        `**Training Information**\n${information}`
      );
    }

    if (command === "warn") {
      const user = interaction.options.getUser("user", true);
      const reason = getReason(interaction);

      recordModlog(
        interaction.guildId,
        user.id,
        `Warning — ${reason}`,
        interaction.user.id
      );

      return replyV2(
        interaction,
        "Warning Recorded",
        `**Member:** <@${user.id}>\n` +
        `**Moderator:** <@${interaction.user.id}>\n` +
        `**Reason:** ${reason}`
      );
    }

    if (command === "timeout") {
      const user = interaction.options.getUser("user", true);
      const minutes = interaction.options.getInteger("minutes", true);
      const reason = getReason(interaction);

      const member = await interaction.guild.members.fetch(user.id);

      if (!member.moderatable) {
        return replyV2(
          interaction,
          "Timeout Failed",
          "I cannot timeout this member. Check my permissions and role position.",
          { ephemeral: true }
        );
      }

      await member.timeout(minutes * 60000, reason);

      recordModlog(
        interaction.guildId,
        user.id,
        `Timeout — ${minutes} minutes — ${reason}`,
        interaction.user.id
      );

      return replyV2(
        interaction,
        "Member Timed Out",
        `**Member:** <@${user.id}>\n` +
        `**Duration:** ${minutes} minutes\n` +
        `**Moderator:** <@${interaction.user.id}>\n` +
        `**Reason:** ${reason}`
      );
    }

    if (command === "kick") {
      const user = interaction.options.getUser("user", true);
      const reason = getReason(interaction);
      const member = await interaction.guild.members.fetch(user.id);

      if (!member.kickable) {
        return replyV2(
          interaction,
          "Kick Failed",
          "I cannot kick this member. Check my permissions and role position.",
          { ephemeral: true }
        );
      }

      await member.kick(reason);

      recordModlog(
        interaction.guildId,
        user.id,
        `Kick — ${reason}`,
        interaction.user.id
      );

      return replyV2(
        interaction,
        "Member Kicked",
        `**Member:** ${user.username}\n` +
        `**Moderator:** <@${interaction.user.id}>\n` +
        `**Reason:** ${reason}`
      );
    }

    if (command === "ban") {
      const user = interaction.options.getUser("user", true);
      const reason = getReason(interaction);

      await interaction.guild.members.ban(user.id, { reason });

      recordModlog(
        interaction.guildId,
        user.id,
        `Ban — ${reason}`,
        interaction.user.id
      );

      return replyV2(
        interaction,
        "Member Banned",
        `**User:** ${user.username}\n` +
        `**Moderator:** <@${interaction.user.id}>\n` +
        `**Reason:** ${reason}`
      );
    }

    if (command === "purge") {
      const amount = interaction.options.getInteger("amount", true);
      const channel = interaction.channel;

      if (!channel || !channel.isTextBased() ||
          typeof channel.bulkDelete !== "function") {
        return replyV2(
          interaction,
          "Purge Failed",
          "This command must be used in a supported text channel.",
          { ephemeral: true }
        );
      }

      const deleted = await channel.bulkDelete(amount, true);

      return replyV2(
        interaction,
        "Messages Purged",
        `**Requested:** ${amount}\n` +
        `**Deleted:** ${deleted.size}\n\n` +
        "Messages older than 14 days cannot be bulk-deleted."
      );
    }

    if (command === "modlogs") {
      const user = interaction.options.getUser("user", true);
      const entries = modlogs.get(
        `${interaction.guildId}:${user.id}`
      ) || [];

      const description = entries.length
        ? entries.slice(-10).reverse().map((entry, index) =>
            `**${index + 1}.** ${entry.action}\n` +
            `Moderator: <@${entry.moderator}>\n` +
            `Date: <t:${Math.floor(entry.timestamp / 1000)}:F>`
          ).join("\n\n")
        : "No moderation actions have been recorded for this user.";

      return replyV2(
        interaction,
        `Moderation Logs — ${user.username}`,
        description,
        { ephemeral: true }
      );
    }

    if (command === "announce") {
      const message =
        interaction.options.getString("message", true);

      return replyV2(
        interaction,
        "Server Announcement",
        `**Announcement by:** <@${interaction.user.id}>\n\n${message}`
      );
    }
  } catch (error) {
    console.error("Command failed:", error);

    return replyV2(
      interaction,
      "Command Error",
      "The command could not be completed. Check the bot console for the detailed error.",
      { ephemeral: true }
    ).catch(console.error);
  }
});

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
} else {
  client.login(TOKEN).catch(error => {
    console.error("Bot login failed:", error);
  });
}
