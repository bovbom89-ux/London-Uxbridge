
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

/* ==================================================
   LONDON, UXBRIDGE — COMPLETE BOT
================================================== */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

const SUPPORT_ROLE_ID = "1558934432675790888";
const ESCALATION_ROLE_ID = "1558933872824287313";
const TICKET_BLACKLIST_ROLE_ID = "1559232249122136136";
const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";

if (!TOKEN || !CLIENT_ID) {
  console.error("ERROR: DISCORD_TOKEN or DISCORD_CLIENT_ID is missing.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("Could not read bot data:", error);
    return {};
  }
}

const data = {
  ticketConfigs: {},
  tickets: {},
  blacklistedUsers: {},
  warnings: {},
  shifts: {},
  operations: {},
  ...loadData()
};

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Could not save bot data:", error);
  }
}

/* ==================================================
   GENERAL HELPERS
================================================== */

const P = PermissionFlagsBits;

function embed(title, description, color = 0x3F5378) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "London, Uxbridge" })
    .setTimestamp();
}

async function privateReply(interaction, title, description) {
  const e = embed(title, description);
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ embeds: [e], ephemeral: true });
  }
  return interaction.reply({ embeds: [e], ephemeral: true });
}

function isAdmin(interaction) {
  return interaction.memberPermissions?.has(P.Administrator) || false;
}

function hasPermission(interaction, permission) {
  return interaction.memberPermissions?.has(permission) || false;
}

function hasSupportRole(member) {
  return Boolean(
    member?.roles?.cache?.has(SUPPORT_ROLE_ID) ||
    member?.roles?.cache?.has(ESCALATION_ROLE_ID)
  );
}

function isStaff(interaction) {
  return isAdmin(interaction) || hasSupportRole(interaction.member);
}

function makeButton(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
}

function getTicket(guildId, channelId) {
  return data.tickets[`${guildId}:${channelId}`];
}

function getConfig(guildId) {
  return data.ticketConfigs[guildId];
}

function isBlacklisted(guildId, userId, member = null) {
  const stored = data.blacklistedUsers[guildId]?.[userId];
  const hasRole = member?.roles?.cache?.has(TICKET_BLACKLIST_ROLE_ID);
  return Boolean(stored || hasRole);
}

function warnRecords(guildId, userId) {
  return (data.warnings[userId] || []).filter(
    record => record.guildId === guildId
  );
}

function ticketKey(guildId, channelId) {
  return `${guildId}:${channelId}`;
}

async function sendTicketLog(guild, ticket, message) {
  const config = getConfig(guild.id);
  if (!config?.logsChannelId) return;

  const channel = await guild.channels
    .fetch(config.logsChannelId)
    .catch(() => null);

  if (!channel?.isTextBased()) return;

  await channel.send({
    embeds: [
      embed(
        "Ticket Activity",
        [
          `**Ticket:** <#${ticket.channelId}>`,
          `**Owner:** <@${ticket.userId}>`,
          `**Activity:** ${message}`
        ].join("\n")
      )
    ]
  }).catch(error => console.error("Ticket log error:", error));
}

/* ==================================================
   TICKET TYPES
================================================== */

const TICKET_TYPES = {
  report: {
    label: "Report a User",
    description: "Report rule-breaking or misconduct.",
    color: 0xC0392B
  },
  appeal: {
    label: "Appeals",
    description: "Appeal a moderation action.",
    color: 0x3498DB
  },
  staff: {
    label: "Staff Report",
    description: "Raise a concern about a staff member.",
    color: 0xE67E22
  },
  enquiries: {
    label: "Enquiries",
    description: "Contact the support team.",
    color: 0x3F5378
  }
};

/* ==================================================
   SLASH COMMAND DEFINITIONS
================================================== */

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot response and latency"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View available bot commands"),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member")
    .addUserOption(o =>
      o.setName("member").setDescription("Member to inspect").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Post the community information panel"),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Configure and publish the support ticket panel")
    .setChannelOption(o =>
      o.setName("panel_channel")
        .setDescription("Channel where members open tickets")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("category")
        .setDescription("Category for private ticket channels")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("logs_channel")
        .setDescription("Channel for ticket logs")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Ticket panel type")
        .setRequired(true)
        .addChoices(
          { name: "Report a User", value: "report" },
          { name: "Appeals", value: "appeal" },
          { name: "Staff Report", value: "staff" },
          { name: "Enquiries", value: "enquiries" }
        )
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Manage your staff shift")
    .addSubcommand(s =>
      s.setName("start").setDescription("Start your staff shift")
    )
    .addSubcommand(s =>
      s.setName("end").setDescription("End your staff shift")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage military operations")
    .addSubcommand(s =>
      s.setName("start")
        .setDescription("Start an operation")
        .addStringOption(o =>
          o.setName("name").setDescription("Operation name").setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("end").setDescription("End the active operation")
    )
    .addSubcommand(s =>
      s.setName("status").setDescription("View operation status")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session")
    .addStringOption(o =>
      o.setName("details").setDescription("Training details").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption(o =>
      o.setName("member").setDescription("Member to warn").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason for the warning").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .addUserOption(o =>
      o.setName("member").setDescription("Member to timeout").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Timeout duration in minutes")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member")
    .addUserOption(o =>
      o.setName("member").setDescription("Member to kick").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user")
    .addUserOption(o =>
      o.setName("member").setDescription("User to ban").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by ID")
    .addStringOption(o =>
      o.setName("user_id").setDescription("Discord user ID").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Number of messages, between 1 and 100")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View a member's moderation records")
    .addUserOption(o =>
      o.setName("member").setDescription("Member to inspect").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Clear moderation records for a member in this server")
    .addUserOption(o =>
      o.setName("member").setDescription("Member to clear").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode")
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds between messages; 0 disables slowmode")
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Prevent @everyone from sending messages in this channel"),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Remove the @everyone message lock in this channel"),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Destination text channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message").setDescription("Announcement text").setRequired(true)
    )
].map(command => command.toJSON());

/* ==================================================
   REGISTER COMMANDS
================================================== */

client.once("ready", async () => {
  console.log(`London, Uxbridge online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log(`Registering ${commands.length} global slash commands...`);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log(`Successfully registered ${commands.length} commands.`);
  } catch (error) {
    console.error("SLASH COMMAND REGISTRATION FAILED:", error);
  }
});

/* ==================================================
   SLASH COMMAND HANDLERS
================================================== */

client.on("interactionCreate", async interaction => {
  try {
    /* -----------------------------------------------
       COMMANDS
    ----------------------------------------------- */

    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        return privateReply(interaction, "Server Only", "Use this command inside a server.");
      }

      const guild = interaction.guild;
      const user = interaction.user;
      const name = interaction.commandName;

      if (name === "ping") {
        return privateReply(
          interaction,
          "Pong!",
          `Latency: **${client.ws.ping}ms**`
        );
      }

      if (name === "help") {
        return privateReply(
          interaction,
          "London, Uxbridge | Commands",
          [
            "**General:** `/ping`, `/help`, `/userinfo`",
            "**Community:** `/information`",
            "**Tickets:** `/ticket`",
            "**Staff:** `/staff-shift`, `/training-session`",
            "**Operations:** `/military-operation`",
            "**Moderation:** `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/modlogs`, `/clearwarns`",
            "**Channels:** `/slowmode`, `/lock`, `/unlock`",
            "**Announcements:** `/announce`",
            `[Support Server](${SUPPORT_URL})`
          ].join("\n")
        );
      }

      if (name === "userinfo") {
        const target = interaction.options.getUser("member") || user;
        const member = await guild.members.fetch(target.id).catch(() => null);

        return privateReply(
          interaction,
          "Member Information",
          [
            `**Username:** ${target.tag || target.username}`,
            `**ID:** ${target.id}`,
            `**Bot:** ${target.bot ? "Yes" : "No"}`,
            `**Account created:** <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
            `**Joined server:** ${
              member?.joinedTimestamp
                ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
                : "Unknown"
            }`
          ].join("\n")
        );
      }

      /* COMMUNITY INFORMATION */

      if (name === "information") {
        if (!isAdmin(interaction)) {
          return privateReply(interaction, "Permission Denied", "Only administrators can post this panel.");
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("community_information")
          .setPlaceholder("Choose a section")
          .addOptions(
            { label: "About the Community", value: "information" },
            { label: "Server Rules", value: "server_rules" },
            { label: "Game Rules", value: "game_rules" },
            { label: "Departments", value: "departments" },
            { label: "Disclaimer", value: "disclaimer" }
          );

        try {
          await interaction.channel.send({
            embeds: [
              embed(
                "Welcome to London, Uxbridge",
                [
                  "Welcome to our British Roblox roleplay community, based around Uxbridge and West London.",
                  "Our aim is to provide organised, enjoyable and realistic roleplay for civilians, public services, emergency services and military personnel.",
                  "",
                  "Use the menu below to learn about our community, rules and departments."
                ].join("\n")
              )
            ],
            components: [new ActionRowBuilder().addComponents(menu)]
          });

          return privateReply(interaction, "Panel Published", "The community information panel has been posted.");
        } catch (error) {
          console.error("INFORMATION PANEL ERROR:", error);
          return privateReply(
            interaction,
            "Could Not Publish",
            `Check my channel permissions.\n\`\`\`${String(error.message || error).slice(0, 700)}\`\`\``
          );
        }
      }

      /* TICKET SETUP AND PUBLISHING */

      if (name === "ticket") {
        if (!isAdmin(interaction)) {
          return privateReply(interaction, "Permission Denied", "Only administrators can set up ticket panels.");
        }

        const panelChannel = interaction.options.getChannel("panel_channel");
        const category = interaction.options.getChannel("category");
        const logsChannel = interaction.options.getChannel("logs_channel");
        const type = interaction.options.getString("type");
        const ticketType = TICKET_TYPES[type];

        if (!ticketType) {
          return privateReply(interaction, "Invalid Ticket Type", "Choose a valid ticket type.");
        }

        const me = await guild.members.fetchMe();

        const panelPermissions = panelChannel.permissionsFor(me);

        if (
          !panelPermissions?.has(P.ViewChannel) ||
          !panelPermissions?.has(P.SendMessages)
        ) {
          return privateReply(
            interaction,
            "Missing Permissions",
            `I need **View Channel** and **Send Messages** in <#${panelChannel.id}>.`
          );
        }

        data.ticketConfigs[guild.id] = {
          categoryId: category.id,
          logsChannelId: logsChannel.id
        };

        saveData();

        const menu = new StringSelectMenuBuilder()
          .setCustomId("ticket_type_select")
          .setPlaceholder("Select the reason for your ticket")
          .addOptions(
            ...Object.entries(TICKET_TYPES).map(([value, item]) => ({
              label: item.label,
              value,
              description: item.description
            }))
          );

        try {
          await panelChannel.send({
            embeds: [
              embed(
                `London, Uxbridge | ${ticketType.label}`,
                [
                  "**ONLY SUPPORT SERVER**",
                  "This ticket system is exclusively for support requests within our support server.",
                  "",
                  `**Panel type:** ${ticketType.label}`,
                  `**Purpose:** ${ticketType.description}`,
                  "",
                  "Please choose the appropriate ticket type from the menu below. Do not open tickets for general community information.",
                  "",
                  `[Visit the support server](${SUPPORT_URL})`
                ].join("\n"),
                ticketType.color
              )
            ],
            components: [
              new ActionRowBuilder().addComponents(menu)
            ]
          });

          return privateReply(
            interaction,
            "Ticket Panel Published",
            `The panel has been posted in <#${panelChannel.id}>.`
          );
        } catch (error) {
          console.error("COULD NOT POST TICKET PANEL:", error);

          return privateReply(
            interaction,
            "Could Not Publish Ticket Panel",
            [
              `**Channel:** <#${panelChannel.id}>`,
              "Check that I can view the channel and send messages, and that the channel is not read-only.",
              "",
              `**Discord error:** ${String(error.message || error).slice(0, 700)}`
            ].join("\n")
          );
        }
      }

      /* STAFF SHIFTS */

      if (name === "staff-shift") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "Permission Denied", "You need the support staff role or Administrator.");
        }

        const sub = interaction.options.getSubcommand();
        const shift = data.shifts[guild.id];

        if (sub === "start") {
          if (shift?.userId === user.id) {
            return privateReply(interaction, "Shift Already Active", "You already have an active staff shift.");
          }

          data.shifts[guild.id] = {
            userId: user.id,
            startedAt: Date.now()
          };

          saveData();

          return privateReply(
            interaction,
            "Staff Shift Started",
            `**Staff member:** ${user}\n**Started:** <t:${Math.floor(Date.now() / 1000)}:F>\nShifts automatically expire after one hour.`
          );
        }

        if (!shift || shift.userId !== user.id) {
          return privateReply(interaction, "No Active Shift", "You do not have an active staff shift.");
        }

        delete data.shifts[guild.id];
        saveData();

        return privateReply(
          interaction,
          "Staff Shift Ended",
          `**Duration:** ${Math.floor((Date.now() - shift.startedAt) / 60000)} minutes.`
        );
      }

      /* MILITARY OPERATIONS */

      if (name === "military-operation") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "Permission Denied", "You need the support staff role or Administrator.");
        }

        const sub = interaction.options.getSubcommand();
        const operation = data.operations[guild.id];

        if (sub === "start") {
          if (operation) {
            return privateReply(interaction, "Operation Already Active", `**${operation.name}** is already running.`);
          }

          const operationName = interaction.options.getString("name");

          data.operations[guild.id] = {
            name: operationName,
            startedAt: Date.now(),
            startedBy: user.id
          };

          saveData();

          return privateReply(
            interaction,
            "Military Operation Started",
            `**Operation:** ${operationName}\n**Organiser:** ${user}\nAutomatically expires after one hour.`
          );
        }

        if (sub === "end") {
          if (!operation) {
            return privateReply(interaction, "No Active Operation", "There is no active operation.");
          }

          delete data.operations[guild.id];
          saveData();

          return privateReply(interaction, "Operation Ended", `**Operation:** ${operation.name}`);
        }

        if (!operation) {
          return privateReply(interaction, "No Active Operation", "There is no active operation.");
        }

        return privateReply(
          interaction,
          "Military Operation Status",
          `**Operation:** ${operation.name}\n**Organiser:** <@${operation.startedBy}>\n**Started:** <t:${Math.floor(operation.startedAt / 1000)}:R>`
        );
      }

      /* TRAINING */

      if (name === "training-session") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "Permission Denied", "You need the support staff role or Administrator.");
        }

        const details = interaction.options.getString("details");

        try {
          await interaction.channel.send({
            embeds: [
              embed(
                "London, Uxbridge | Training Session",
                `**Organiser:** ${user}\n\n${details}\n\nPlease follow the organiser's instructions and arrive prepared.`
              )
            ]
          });

          return privateReply(interaction, "Training Announced", "The training session announcement has been posted.");
        } catch (error) {
          console.error("TRAINING ANNOUNCEMENT ERROR:", error);
          return privateReply(interaction, "Announcement Failed", "I could not post the training announcement. Check channel permissions.");
        }
      }

      /* MODERATION PERMISSION HELPER */

      const target = interaction.options.getUser("member");

      if (["warn", "timeout", "kick", "ban", "unban", "purge", "modlogs", "clearwarns"].includes(name)) {
        const neededPermission = {
          warn: P.ModerateMembers,
          timeout: P.ModerateMembers,
          kick: P.KickMembers,
          ban: P.BanMembers,
          unban: P.BanMembers,
          purge: P.ManageMessages,
          modlogs: P.ModerateMembers,
          clearwarns: P.ModerateMembers
        }[name];

        if (!hasPermission(interaction, neededPermission)) {
          return privateReply(interaction, "Permission Denied", "You do not have the Discord permission required for this command.");
        }
      }

      /* WARN */

      if (name === "warn") {
        const reason = interaction.options.getString("reason");
        const member = await guild.members.fetch(target.id).catch(() => null);

        if (target.id === user.id || target.id === client.user.id) {
          return privateReply(interaction, "Invalid Target", "You cannot warn yourself or the bot.");
        }

        if (
          member &&
          !isAdmin(interaction) &&
          member.roles.highest.position >= interaction.member.roles.highest.position
        ) {
          return privateReply(interaction, "Role Hierarchy", "You cannot warn someone with an equal or higher role.");
        }

        data.warnings[target.id] ??= [];
        data.warnings[target.id].push({
          guildId: guild.id,
          moderatorId: user.id,
          reason,
          timestamp: Date.now(),
          action: "Warning"
        });

        saveData();

        await target.send({
          embeds: [
            embed("You Have Received a Warning", `**Server:** ${guild.name}\n**Reason:** ${reason}`)
          ]
        }).catch(() => {});

        return privateReply(interaction, "Warning Recorded", `**Member:** ${target}\n**Reason:** ${reason}`);
      }

      /* TIMEOUT */

      if (name === "timeout") {
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason");
        const member = await guild.members.fetch(target.id).catch(() => null);

        if (!member) {
          return privateReply(interaction, "Member Not Found", "That member is not in this server.");
        }

        if (!member.moderatable) {
          return privateReply(interaction, "Cannot Timeout", "Check the bot's Moderate Members permission and role hierarchy.");
        }

        await member.timeout(minutes * 60000, reason);

        data.warnings[target.id] ??= [];
        data.warnings[target.id].push({
          guildId: guild.id,
          moderatorId: user.id,
          reason,
          timestamp: Date.now(),
          action: `Timeout (${minutes} minutes)`
        });

        saveData();

        return privateReply(interaction, "Member Timed Out", `**Member:** ${target}\n**Duration:** ${minutes} minutes\n**Reason:** ${reason}`);
      }

      /* KICK */

      if (name === "kick") {
        const reason = interaction.options.getString("reason");
        const member = await guild.members.fetch(target.id).catch(() => null);

        if (!member) {
          return privateReply(interaction, "Member Not Found", "That member is not in this server.");
        }

        if (!member.kickable) {
          return privateReply(interaction, "Cannot Kick", "Check the bot's Kick Members permission and role hierarchy.");
        }

        await member.kick(reason);

        data.warnings[target.id] ??= [];
        data.warnings[target.id].push({
          guildId: guild.id,
          moderatorId: user.id,
          reason,
          timestamp: Date.now(),
          action: "Kick"
        });

        saveData();

        return privateReply(interaction, "Member Kicked", `**Member:** ${target.tag}\n**Reason:** ${reason}`);
      }

      /* BAN */

      if (name === "ban") {
        const reason = interaction.options.getString("reason");
        const member = await guild.members.fetch(target.id).catch(() => null);

        if (member && !member.bannable) {
          return privateReply(interaction, "Cannot Ban", "Check the bot's Ban Members permission and role hierarchy.");
        }

        await guild.members.ban(target.id, { reason });

        data.warnings[target.id] ??= [];
        data.warnings[target.id].push({
          guildId: guild.id,
          moderatorId: user.id,
          reason,
          timestamp: Date.now(),
          action: "Ban"
        });

        saveData();

        return privateReply(interaction, "User Banned", `**User:** ${target.tag}\n**Reason:** ${reason}`);
      }

      /* UNBAN */

      if (name === "unban") {
        const id = interaction.options.getString("user_id");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!/^\d{17,20}$/.test(id)) {
          return privateReply(interaction, "Invalid ID", "Enter a valid Discord user ID.");
        }

        await guild.members.unban(id, reason);

        return privateReply(interaction, "User Unbanned", `**User ID:** ${id}\n**Reason:** ${reason}`);
      }

      /* PURGE */

      if (name === "purge") {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.bulkDelete) {
          return privateReply(interaction, "Unsupported Channel", "This channel does not support bulk deletion.");
        }

        const messages = await interaction.channel.bulkDelete(amount, true);

        return privateReply(
          interaction,
          "Messages Deleted",
          `Deleted **${messages.size}** messages.\nDiscord does not allow bulk deletion of messages older than 14 days.`
        );
      }

      /* MODLOGS */

      if (name === "modlogs") {
        const records = warnRecords(guild.id, target.id);

        if (!records.length) {
          return privateReply(interaction, "No Records", `No moderation records found for ${target.tag} in this server.`);
        }

        const description = records.slice(-10).reverse().map((record, index) =>
          `**${index + 1}. ${record.action || "Warning"}**\nReason: ${record.reason}\nModerator: <@${record.moderatorId}>\n<t:${Math.floor(record.timestamp / 1000)}:R>`
        ).join("\n\n");

        return privateReply(interaction, `Moderation Records — ${target.tag}`, description);
      }

      /* CLEAR WARNS */

      if (name === "clearwarns") {
        const records = data.warnings[target.id] || [];
        const removed = records.filter(record => record.guildId === guild.id).length;

        data.warnings[target.id] = records.filter(record => record.guildId !== guild.id);
        saveData();

        return privateReply(interaction, "Records Cleared", `Removed **${removed}** moderation record(s) for ${target} from this server.`);
      }

      /* SLOWMODE */

      if (name === "slowmode") {
        if (!hasPermission(interaction, P.ManageChannels)) {
          return privateReply(interaction, "Permission Denied", "You need Manage Channels.");
        }

        if (!interaction.channel?.setRateLimitPerUser) {
          return privateReply(interaction, "Unsupported Channel", "Slowmode cannot be configured here.");
        }

        const seconds = interaction.options.getInteger("seconds");
        await interaction.channel.setRateLimitPerUser(seconds);

        return privateReply(
          interaction,
          "Slowmode Updated",
          seconds === 0 ? "Slowmode is disabled." : `Slowmode is now **${seconds} seconds**.`
        );
      }

      /* LOCK / UNLOCK */

      if (name === "lock" || name === "unlock") {
        if (!hasPermission(interaction, P.ManageChannels)) {
          return privateReply(interaction, "Permission Denied", "You need Manage Channels.");
        }

        const locked = name === "lock";

        await interaction.channel.permissionOverwrites.edit(
          guild.roles.everyone.id,
          { SendMessages: locked ? false : null }
        );

        return privateReply(
          interaction,
          locked ? "Channel Locked" : "Channel Unlocked",
          locked
            ? "The @everyone role can no longer send messages in this channel."
            : "The @everyone send-message override has been removed."
        );
      }

      /* ANNOUNCE */

      if (name === "announce") {
        if (!hasPermission(interaction, P.ManageGuild)) {
          return privateReply(interaction, "Permission Denied", "You need Manage Server.");
        }

        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");

        await channel.send({
          embeds: [
            embed("London, Uxbridge | Announcement", message)
          ]
        });

        return privateReply(interaction, "Announcement Posted", `Published in <#${channel.id}>.`);
      }
    }

    /* -----------------------------------------------
       INFORMATION DROPDOWN
    ----------------------------------------------- */

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "community_information"
    ) {
      const pages = {
        information: [
          "**About London, Uxbridge**",
          "London, Uxbridge is a British Roblox roleplay community based around Uxbridge and West London.",
          "Our goal is to provide organised, enjoyable and realistic roleplay, with opportunities for civilians, emergency services, public services and military personnel.",
          "Members are expected to contribute positively and respect fellow players."
        ],
        server_rules: [
          "**Server Rules**",
          "1. Treat members and staff respectfully.",
          "2. Do not harass, bully, threaten or discriminate against others.",
          "3. Do not spam, flood channels or misuse pings.",
          "4. Do not advertise without permission.",
          "5. Do not evade moderation or exploit loopholes.",
          "6. Follow Discord's Terms of Service and Community Guidelines.",
          "7. Follow instructions from authorised staff."
        ],
        game_rules: [
          "**Game Rules**",
          "1. Keep roleplay realistic and appropriate to the scene.",
          "2. No random deathmatch or random killing.",
          "3. No exploiting, cheating or abusing game mechanics.",
          "4. Do not powergame or force outcomes on other players.",
          "5. Follow department procedures and roleplay instructions.",
          "6. Do not impersonate staff or emergency personnel.",
          "7. Follow server staff instructions during events and operations."
        ],
        departments: [
          "**Departments**",
          "**Civilian Operations:** Everyday life and civilian roleplay.",
          "**Emergency Services:** Public safety and emergency response roleplay.",
          "**Public Services:** Community-facing services and local operations.",
          "**Military:** Organised military roleplay and approved operations.",
          "Department availability, requirements and recruitment may change. Check official announcements for current information."
        ],
        disclaimer: [
          "**Disclaimer**",
          "London, Uxbridge is a community roleplay project associated with Roblox.",
          "Unless explicitly stated otherwise, it is not an official UK government organisation, emergency service, military organisation or Roblox-affiliated entity.",
          "Roleplay scenarios are fictional. Do not treat them as real emergency instructions.",
          "Community rules and department arrangements may be updated by authorised staff."
        ]
      };

      const selected = pages[interaction.values[0]];

      if (!selected) {
        return privateReply(interaction, "Section Not Found", "Please select a valid information section.");
      }

      return interaction.reply({
        embeds: [
          embed("London, Uxbridge | Community Guide", selected.join("\n\n"))
        ],
        ephemeral: true
      });
    }

    /* -----------------------------------------------
       TICKET TYPE MENU
    ----------------------------------------------- */

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_type_select"
    ) {
      const guild = interaction.guild;
      const user = interaction.user;
      const selectedType = interaction.values[0];
      const typeInfo = TICKET_TYPES[selectedType];

      if (!guild || !typeInfo) {
        return privateReply(interaction, "Ticket Error", "The selected ticket type is invalid.");
      }

      const member = await guild.members.fetch(user.id).catch(() => null);

      if (isBlacklisted(guild.id, user.id, member)) {
        return privateReply(
          interaction,
          "Ticket Access Restricted",
          "You cannot open tickets in this server. If you believe this is a mistake, contact the support team through an approved alternative."
        );
      }

      const config = getConfig(guild.id);

      if (!config) {
        return privateReply(interaction, "Ticket System Not Configured", "An administrator must configure the ticket system first.");
      }

      const existing = Object.values(data.tickets).find(
        ticket => ticket.guildId === guild.id && ticket.userId === user.id && !ticket.closed
      );

      if (existing) {
        return privateReply(interaction, "Ticket Already Open", `You already have an open ticket: <#${existing.channelId}>.`);
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const category = await guild.channels.fetch(config.categoryId).catch(() => null);

        if (!category || category.type !== ChannelType.GuildCategory) {
          return interaction.editReply({
            embeds: [embed("Ticket Setup Error", "The configured ticket category no longer exists. Ask an administrator to run `/ticket` again.")]
          });
        }

        const me = await guild.members.fetchMe();

        const permissionOverwrites = [
          {
            id: guild.roles.everyone.id,
            deny: [P.ViewChannel]
          },
          {
            id: user.id,
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles]
          },
          {
            id: me.id,
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels]
          }
        ];

        for (const roleId of [SUPPORT_ROLE_ID, ESCALATION_ROLE_ID]) {
          const role = guild.roles.cache.get(roleId);
          if (role) {
            permissionOverwrites.push({
              id: roleId,
              allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory]
            });
          }
        }

        const channel = await guild.channels.create({
          name: `${selectedType}-${user.username}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .slice(0, 90),
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites
        });

        const ticket = {
          guildId: guild.id,
          channelId: channel.id,
          userId: user.id,
          type: selectedType,
          claimedBy: null,
          closed: false,
          createdAt: Date.now()
        };

        data.tickets[ticketKey(guild.id, channel.id)] = ticket;
        saveData();

        const staffTools = new ActionRowBuilder().addComponents(
          makeButton("ticket_claim", "Claim", ButtonStyle.Primary),
          makeButton("ticket_escalate", "Escalate", ButtonStyle.Secondary),
          makeButton("ticket_blacklist", "Blacklist User", ButtonStyle.Danger),
          makeButton("ticket_rename", "Rename", ButtonStyle.Secondary),
          makeButton("ticket_close", "Close Ticket", ButtonStyle.Danger)
        );

        await channel.send({
          content: `${user} <@&${SUPPORT_ROLE_ID}>`,
          embeds: [
            embed(
              `Support Ticket | ${typeInfo.label}`,
              [
                `Welcome ${user}. A member of the support team will assist you.`,
                "",
                `**Ticket owner:** ${user}`,
                `**Ticket type:** ${typeInfo.label}`,
                `**Created:** <t:${Math.floor(ticket.createdAt / 1000)}:F>`,
                "",
                "**Please explain your issue clearly.** Include relevant details and evidence where appropriate.",
                "",
                "**Staff Tools:** Only authorised staff should use the buttons below."
              ].join("\n"),
              typeInfo.color
            )
          ],
          components: [staffTools]
        });

        await sendTicketLog(guild, ticket, "Ticket created.");

        return interaction.editReply({
          embeds: [embed("Ticket Created", `Your private ticket is ready: <#${channel.id}>.`)]
        });
      } catch (error) {
        console.error("TICKET CREATION FAILED:", error);

        return interaction.editReply({
          embeds: [
            embed(
              "Ticket Creation Failed",
              `The ticket could not be created.\n\n**Error:** ${String(error.message || error).slice(0, 700)}`
            )
          ]
        });
      }
    }

    /* -----------------------------------------------
       TICKET BUTTONS
    ----------------------------------------------- */

    if (interaction.isButton() && interaction.customId.startsWith("ticket_")) {
      const guild = interaction.guild;

      if (!guild) {
        return privateReply(interaction, "Server Only", "This button must be used inside the server.");
      }

      const ticket = getTicket(guild.id, interaction.channelId);

      if (!ticket || ticket.closed) {
        return privateReply(interaction, "Ticket Not Found", "This ticket is closed or is no longer registered.");
      }

      const staffOnly = [
        "ticket_claim",
        "ticket_escalate",
        "ticket_blacklist",
        "ticket_rename",
        "ticket_close"
      ];

      if (staffOnly.includes(interaction.customId) && !isStaff(interaction)) {
        return privateReply(interaction, "Permission Denied", "Only authorised support staff can use this tool.");
      }

      /* CLAIM */

      if (interaction.customId === "ticket_claim") {
        if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
          return privateReply(interaction, "Already Claimed", `This ticket is claimed by <@${ticket.claimedBy}>.`);
        }

        ticket.claimedBy = interaction.user.id;
        saveData();

        await sendTicketLog(guild, ticket, `Claimed by ${interaction.user.tag}.`);

        return interaction.reply({
          embeds: [embed("Ticket Claimed", `This ticket is now being handled by ${interaction.user}.`)]
        });
      }

      /* ESCALATE */

      if (interaction.customId === "ticket_escalate") {
        const role = guild.roles.cache.get(ESCALATION_ROLE_ID);

        if (!role) {
          return privateReply(interaction, "Escalation Role Missing", "The configured escalation role does not exist.");
        }

        await interaction.channel.permissionOverwrites.edit(role.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });

        await interaction.channel.send({
          content: `<@&${ESCALATION_ROLE_ID}>`,
          embeds: [embed("Ticket Escalated", `Escalated by ${interaction.user}. An escalation team member has been notified.`)]
        });

        await sendTicketLog(guild, ticket, `Escalated by ${interaction.user.tag}.`);

        return privateReply(interaction, "Ticket Escalated", "The escalation role has been notified.");
      }

      /* BLACKLIST */

      if (interaction.customId === "ticket_blacklist") {
        await interaction.deferReply({ ephemeral: true });

        try {
          const owner = await guild.members.fetch(ticket.userId).catch(() => null);

          data.blacklistedUsers[guild.id] ??= {};
          data.blacklistedUsers[guild.id][ticket.userId] = {
            moderatorId: interaction.user.id,
            timestamp: Date.now(),
            reason: "Blacklisted through ticket staff tools"
          };

          if (owner) {
            const role = guild.roles.cache.get(TICKET_BLACKLIST_ROLE_ID);

            if (!role) {
              delete data.blacklistedUsers[guild.id][ticket.userId];
              saveData();

              return interaction.editReply({
                embeds: [embed("Blacklist Role Missing", `I cannot find the blacklist role \`${TICKET_BLACKLIST_ROLE_ID}\` in this server.`)]
              });
            }

            const botMember = await guild.members.fetchMe();

            if (
              !botMember.permissions.has(P.ManageRoles) ||
              role.position >= botMember.roles.highest.position
            ) {
              delete data.blacklistedUsers[guild.id][ticket.userId];
              saveData();

              return interaction.editReply({
                embeds: [
                  embed(
                    "Cannot Assign Blacklist Role",
                    "Give the bot **Manage Roles** and move its highest role above the blacklist role. The blacklist was not applied."
                  )
                ]
              });
            }

            await owner.roles.add(role, `Ticket blacklist applied by ${interaction.user.tag}`);
          }

          saveData();

          await interaction.channel.send({
            embeds: [
              embed(
                "Ticket Access Restricted",
                `The ticket owner <@${ticket.userId}> has been blacklisted from opening new tickets by ${interaction.user}.`,
                0xC0392B
              )
            ]
          });

          await sendTicketLog(guild, ticket, `Owner blacklisted by ${interaction.user.tag}.`);

          return interaction.editReply({
            embeds: [
              embed(
                "User Blacklisted",
                `The blacklist has been saved for <@${ticket.userId}>. They will be prevented from opening tickets in this server.`
              )
            ]
          });
        } catch (error) {
          console.error("TICKET BLACKLIST ERROR:", error);

          return interaction.editReply({
            embeds: [
              embed(
                "Blacklist Failed",
                `Discord rejected the action. Check Manage Roles and role hierarchy.\n\n${String(error.message || error).slice(0, 500)}`
              )
            ]
          });
        }
      }

      /* RENAME */

      if (interaction.customId === "ticket_rename") {
        const modal = new ModalBuilder()
          .setCustomId("ticket_rename_modal")
          .setTitle("Rename Ticket");

        const nameInput = new TextInputBuilder()
          .setCustomId("new_name")
          .setLabel("New channel name")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(90)
          .setRequired(true)
          .setValue(interaction.channel.name);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput)
        );

        return interaction.showModal(modal);
      }

      /* CLOSE */

      if (interaction.customId === "ticket_close") {
        await interaction.deferReply({ ephemeral: true });

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;
        saveData();

        await sendTicketLog(guild, ticket, `Closed by ${interaction.user.tag}.`);

        await interaction.channel.send({
          embeds: [
            embed(
              "Ticket Closed",
              `Closed by ${interaction.user}.\nThis channel will be deleted in 10 seconds.`
            )
          ],
          components: []
        });

        await interaction.editReply({
          embeds: [embed("Ticket Closed", "The ticket has been marked as closed.")]
        });

        setTimeout(async () => {
          try {
            await interaction.channel.delete("Ticket closed");
          } catch (error) {
            console.error("TICKET CHANNEL DELETE ERROR:", error);
          }

          delete data.tickets[ticketKey(guild.id, ticket.channelId)];
          saveData();
        }, 10000);
      }
    }

    /* -----------------------------------------------
       TICKET RENAME MODAL
    ----------------------------------------------- */

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "ticket_rename_modal"
    ) {
      if (!interaction.guild || !isStaff(interaction)) {
        return privateReply(interaction, "Permission Denied", "Only support staff can rename tickets.");
      }

      const ticket = getTicket(interaction.guild.id, interaction.channelId);

      if (!ticket || ticket.closed) {
        return privateReply(interaction, "Ticket Not Found", "This ticket is closed or unregistered.");
      }

      const newName = interaction.fields
        .getTextInputValue("new_name")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90);

      if (newName.length < 2) {
        return privateReply(interaction, "Invalid Name", "Please enter a longer channel name.");
      }

      await interaction.channel.setName(newName);

      await sendTicketLog(
        interaction.guild,
        ticket,
        `Channel renamed to ${newName} by ${interaction.user.tag}.`
      );

      return privateReply(interaction, "Ticket Renamed", `New name: **${newName}**.`);
    }

    /* -----------------------------------------------
       ERROR HANDLING
    ----------------------------------------------- */

  } catch (error) {
    console.error("INTERACTION ERROR:", error);

    const message = {
      embeds: [
        embed(
          "Something Went Wrong",
          "An error occurred while processing your request. Please check the bot logs or contact an administrator."
        )
      ],
      ephemeral: true
    };

    try {
      if (interaction.deferred) {
        await interaction.editReply(message);
      } else if (interaction.replied) {
        await interaction.followUp(message);
      } else {
        await interaction.reply(message);
      }
    } catch (replyError) {
      console.error("COULD NOT SEND ERROR RESPONSE:", replyError);
    }
  }
});

/* ==================================================
   AUTOMATIC SHIFT AND OPERATION EXPIRY
================================================== */

setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [guildId, shift] of Object.entries(data.shifts)) {
    if (now - shift.startedAt >= 60 * 60 * 1000) {
      delete data.shifts[guildId];
      console.log(`Staff shift expired for guild ${guildId}.`);
      changed = true;
    }
  }

  for (const [guildId, operation] of Object.entries(data.operations)) {
    if (now - operation.startedAt >= 60 * 60 * 1000) {
      delete data.operations[guildId];
      console.log(`Military operation expired for guild ${guildId}.`);
      changed = true;
    }
  }

  if (changed) saveData();
}, 60 * 1000);

/* ==================================================
   START BOT
================================================== */

client.on("error", error => {
  console.error("DISCORD CLIENT ERROR:", error);
});

process.on("unhandledRejection", error => {
  console.error("UNHANDLED PROMISE REJECTION:", error);
});

client.login(TOKEN);
