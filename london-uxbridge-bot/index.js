require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

// ==================================================
// CONFIGURATION
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.");
}

const SUPPORT_ROLE_ID = "1558934432675790888";
const ESCALATION_ROLE_ID = "1558933872824287313";
const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Data loading error:", error);
  }

  return {};
}

const data = {
  tickets: {},
  warnings: {},
  shifts: {},
  operations: {},
  ticketConfigs: {},
  nextTicketNumber: 1,
  ...loadData(),
};

data.tickets ??= {};
data.warnings ??= {};
data.shifts ??= {};
data.operations ??= {};
data.ticketConfigs ??= {};
data.nextTicketNumber ??= 1;

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const setupSessions = new Map();

// ==================================================
// TICKET TYPES
// ==================================================

const TICKET_TYPES = {
  report: {
    label: "Report a User",
    slug: "report-a-user",
    button: "Report a User",
    description:
      "Report a member or an incident to the moderation team.",
    intro:
      "Use this ticket to report a user or incident. Explain what happened, include relevant dates, and attach any evidence you have.",
    guidance:
      "Please provide the username of the person involved, what happened, when it happened, and any screenshots or other evidence.",
  },

  appeal: {
    label: "Appeals",
    slug: "appeal",
    button: "Submit an Appeal",
    description:
      "Request a review of a moderation action or community decision.",
    intro:
      "Use this ticket to submit an appeal. Explain the action you are appealing and why you believe it should be reviewed.",
    guidance:
      "Please include the action you are appealing, when it happened, and a clear explanation of your appeal.",
  },

  staff: {
    label: "Staff Report",
    slug: "staff-report",
    button: "Report a Staff Member",
    description:
      "Raise a concern about a member of the staff team privately.",
    intro:
      "Use this ticket to report a staff member. Please remain respectful and provide relevant details and evidence.",
    guidance:
      "Please name the staff member involved, describe the incident, and include any relevant evidence.",
  },

  enquiries: {
    label: "Enquiries",
    slug: "enquiries",
    button: "Open an Enquiry",
    description:
      "Ask the team a question or request help with the community.",
    intro:
      "Use this ticket for general questions and enquiries. Explain what you need help with and the team will get back to you.",
    guidance:
      "Please describe your question or enquiry in as much detail as you can.",
  },
};

// ==================================================
// COMPONENTS V2 HELPERS
// ==================================================

function container(...lines) {
  const result = new ContainerBuilder();

  lines
    .filter(
      (line) =>
        line !== null &&
        line !== undefined &&
        String(line).length > 0
    )
    .forEach((line, index) => {
      if (index > 0) {
        result.addSeparatorComponents(new SeparatorBuilder());
      }

      result.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(String(line))
      );
    });

  return result;
}

function v2(...lines) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container(...lines)],
  };
}

/*
 * IMPORTANT:
 * Components V2 requires the buttons and text to be placed
 * together in the same container.
 *
 * This helper adds action rows directly to the container,
 * rather than sending a separate message containing buttons.
 */

function v2WithRows(lines, rows = [], ephemeral = false) {
  const panel = container(...lines);

  for (const row of rows) {
    panel.addActionRowComponents(row);
  }

  return {
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [panel],
  };
}

function privateV2(...lines) {
  return {
    flags:
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral,
    components: [container(...lines)],
  };
}

async function privateReply(interaction, ...lines) {
  const payload = privateV2(...lines);

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function hasSupportRole(interaction) {
  const roles = interaction.member?.roles?.cache;

  return Boolean(
    roles?.has(SUPPORT_ROLE_ID) ||
    roles?.has(ESCALATION_ROLE_ID)
  );
}

function isStaff(interaction) {
  return isAdmin(interaction) || hasSupportRole(interaction);
}

function getTicket(channelId) {
  return data.tickets[channelId];
}

function getConfig(guildId) {
  return data.ticketConfigs[guildId];
}

function makeButton(
  id,
  label,
  style = ButtonStyle.Secondary
) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style);
}

function slugify(value) {
  return (
    String(value || "member")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "member"
  );
}

// ==================================================
// TICKET LOGS
// ONE LOG MESSAGE PER TICKET
// ==================================================

async function updateTicketLog(guild, ticket) {
  if (!ticket.logChannelId || !ticket.logMessageId) {
    return;
  }

  const channel = await guild.channels
    .fetch(ticket.logChannelId)
    .catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const claimed = ticket.claimedBy
    ? `<@${ticket.claimedBy}>`
    : "N/A";

  const status = ticket.closed ? "Closed" : "Open";

  const lines = [
    "## London, Uxbridge | Ticket Log",
    `**Ticket number:** #${ticket.ticketNumber}`,
    `**Ticket type:** ${
      TICKET_TYPES[ticket.type]?.label || ticket.type
    }`,
    `**Opened by:** <@${ticket.userId}>`,
    `**Ticket channel:** <#${ticket.channelId}>`,
    `**Created:** <t:${Math.floor(ticket.createdAt / 1000)}:F>`,
    `**Status:** ${status}`,
    `**Claimed by:** ${claimed}`,
    `**Escalated:** ${ticket.escalated ? "Yes" : "No"}`,
    `**Last action:** ${ticket.lastAction || "Ticket opened"}`,
    `**Last updated:** <t:${Math.floor(
      (ticket.updatedAt || ticket.createdAt) / 1000
    )}:F>`,
  ];

  if (ticket.closedBy) {
    lines.push(`**Closed by:** <@${ticket.closedBy}>`);
  }

  const message = await channel.messages
    .fetch(ticket.logMessageId)
    .catch(() => null);

  if (message) {
    await message.edit(v2(...lines)).catch(console.error);
  }
}

async function createTicketLog(guild, ticket, logsChannelId) {
  const channel = await guild.channels
    .fetch(logsChannelId)
    .catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  ticket.logChannelId = channel.id;
  ticket.updatedAt = Date.now();
  ticket.lastAction = "Ticket opened";

  const message = await channel
    .send(
      v2(
        "## London, Uxbridge | Ticket Log",
        `**Ticket number:** #${ticket.ticketNumber}`,
        `**Ticket type:** ${
          TICKET_TYPES[ticket.type]?.label || ticket.type
        }`,
        `**Opened by:** <@${ticket.userId}>`,
        `**Ticket channel:** <#${ticket.channelId}>`,
        `**Created:** <t:${Math.floor(ticket.createdAt / 1000)}:F>`,
        "**Status:** Open",
        "**Claimed by:** N/A",
        "**Escalated:** No",
        "**Last action:** Ticket opened",
        `**Last updated:** <t:${Math.floor(ticket.createdAt / 1000)}:F>`
      )
    )
    .catch((error) => {
      console.error("Could not create ticket log:", error);
      return null;
    });

  if (message) {
    ticket.logMessageId = message.id;
    saveData();
  }
}

async function sendTicketLog(guild, ticket, text) {
  ticket.lastAction = text;
  ticket.updatedAt = Date.now();

  saveData();

  await updateTicketLog(guild, ticket);
}

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Post the community information panel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Set up a Components V2 ticket panel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the bot command list."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member.")
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to inspect.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Manage staff shifts.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Start your staff shift.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("end")
        .setDescription("End your staff shift.")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage military operations.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("start")
        .setDescription("Start an operation.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Operation name.")
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("end")
        .setDescription("End the current operation.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("View operation status.")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption((option) =>
      option
        .setName("details")
        .setDescription("Training details.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to warn.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to timeout.")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("minutes")
        .setDescription("Duration in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.KickMembers
    )
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to kick.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.BanMembers
    )
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to ban.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Reason.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages in this channel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View a member's warning records.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Member to inspect.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Announcement channel.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("Announcement text.")
        .setRequired(true)
    ),
].map((command) => command.toJSON());

// ==================================================
// REGISTER COMMANDS GLOBALLY
// ==================================================

client.once("ready", async () => {
  console.log(`London, Uxbridge online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("Registering global slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log(`${commands.length} global commands registered.`);
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on("interactionCreate", async (interaction) => {
  try {
    // --------------------------------------------------
    // SLASH COMMANDS
    // --------------------------------------------------

    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        return privateReply(
          interaction,
          "Please use this command inside a server."
        );
      }

      const guild = interaction.guild;
      const user = interaction.user;
      const name = interaction.commandName;

      if (name === "ping") {
        return privateReply(
          interaction,
          "## Pong",
          "London, Uxbridge is online and responding."
        );
      }

      if (name === "help") {
        return privateReply(
          interaction,
          "## London, Uxbridge | Command Centre",
          "**Tickets:** `/ticket`",
          "**Community:** `/information`, `/help`, `/ping`, `/userinfo`",
          "**Staff:** `/staff-shift`, `/training-session`",
          "**Operations:** `/military-operation`",
          "**Moderation:** `/warn`, `/timeout`, `/kick`, `/ban`, `/purge`, `/modlogs`, `/announce`",
          `[Support server](${SUPPORT_URL})`
        );
      }

      // --------------------------------------------------
      // TICKET SETUP
      // --------------------------------------------------

      if (name === "ticket") {
        if (!isAdmin(interaction)) {
          return privateReply(
            interaction,
            "Only server administrators can configure ticket panels."
          );
        }

        const key = `${guild.id}:${user.id}`;

        setupSessions.set(key, {
          guildId: guild.id,
          userId: user.id,
          type: null,
          panelChannelId: null,
          categoryId: null,
          logsChannelId: null,
          createdAt: Date.now(),
        });

        const typeMenu = new StringSelectMenuBuilder()
          .setCustomId("ticket_setup_type")
          .setPlaceholder("1. Choose a ticket panel type")
          .addOptions(
            ...Object.entries(TICKET_TYPES).map(([value, type]) => ({
              label: type.label,
              value,
              description: type.description.slice(0, 100),
            }))
          );

        const panelMenu = new ChannelSelectMenuBuilder()
          .setCustomId("ticket_setup_panel_channel")
          .setPlaceholder("2. Choose the panel channel")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1);

        const categoryMenu = new ChannelSelectMenuBuilder()
          .setCustomId("ticket_setup_category")
          .setPlaceholder("3. Choose the ticket category")
          .setChannelTypes(ChannelType.GuildCategory)
          .setMinValues(1)
          .setMaxValues(1);

        const logsMenu = new ChannelSelectMenuBuilder()
          .setCustomId("ticket_setup_logs_channel")
          .setPlaceholder("4. Choose the logs channel")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.reply(
          v2WithRows(
            [
              "## London, Uxbridge | Ticket Setup",
              "Configure one ticket panel at a time. Nothing is published until you press **Confirm Setup**.",
              "**1 — Panel type:** Choose Report a User, Appeals, Staff Report or Enquiries.",
              "**2 — Panel channel:** Where members will see the panel.",
              "**3 — Ticket category:** Where new private ticket channels will be created.",
              "**4 — Logs channel:** Where ticket activity will be recorded.",
              "**5 — Confirm:** Once all four choices are selected, press Confirm Setup to publish the panel.",
            ],
            [
              new ActionRowBuilder().addComponents(typeMenu),
              new ActionRowBuilder().addComponents(panelMenu),
              new ActionRowBuilder().addComponents(categoryMenu),
              new ActionRowBuilder().addComponents(logsMenu),
              new ActionRowBuilder().addComponents(
                makeButton(
                  "ticket_setup_confirm",
                  "Confirm Setup",
                  ButtonStyle.Success
                ),
                makeButton(
                  "ticket_setup_cancel",
                  "Cancel",
                  ButtonStyle.Danger
                )
              ),
            ],
            true
          )
        );
      }

      // --------------------------------------------------
      // INFORMATION PANEL
      // --------------------------------------------------

      if (name === "information") {
        if (!isAdmin(interaction)) {
          return privateReply(
            interaction,
            "Only administrators can post the information panel."
          );
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("community_information")
          .setPlaceholder("Choose an information section")
          .addOptions(
            { label: "Information", value: "information" },
            { label: "Server Rules", value: "server_rules" },
            { label: "Game Rules", value: "game_rules" },
            { label: "Departments", value: "departments" },
            { label: "Disclaimer", value: "disclaimer" }
          );

        await interaction.channel.send(
          v2WithRows(
            [
              "## London, Uxbridge",
              "Welcome to London, Uxbridge, a British Roblox roleplay community.",
              "Choose a section from the menu below to view our information, rules and departments.",
            ],
            [new ActionRowBuilder().addComponents(menu)]
          )
        );

        return privateReply(
          interaction,
          "The information panel has been posted."
        );
      }

      // --------------------------------------------------
      // USER INFORMATION
      // --------------------------------------------------

      if (name === "userinfo") {
        const target =
          interaction.options.getUser("member") || user;

        const targetMember = await guild.members
          .fetch(target.id)
          .catch(() => null);

        return privateReply(
          interaction,
          "## Member Information",
          `**Username:** ${target.username}`,
          `**User ID:** ${target.id}`,
          `**Account created:** <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
          `**Joined server:** ${
            targetMember?.joinedTimestamp
              ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:F>`
              : "Unknown"
          }`
        );
      }

      // --------------------------------------------------
      // STAFF SHIFTS
      // --------------------------------------------------

      if (name === "staff-shift") {
        if (!isStaff(interaction)) {
          return privateReply(
            interaction,
            "You do not have permission to manage staff shifts."
          );
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
          if (data.shifts[guild.id]?.userId === user.id) {
            return privateReply(
              interaction,
              "You already have an active shift."
            );
          }

          data.shifts[guild.id] = {
            userId: user.id,
            startedAt: Date.now(),
          };

          saveData();

          return privateReply(
            interaction,
            "## Staff Shift Started",
            `**Staff member:** ${user}`,
            `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`,
            "Your shift will automatically expire after one hour."
          );
        }

        const shift = data.shifts[guild.id];

        if (!shift || shift.userId !== user.id) {
          return privateReply(
            interaction,
            "You do not have an active shift."
          );
        }

        delete data.shifts[guild.id];
        saveData();

        return privateReply(
          interaction,
          "## Staff Shift Ended",
          `**Staff member:** ${user}`,
          `**Duration:** ${Math.floor(
            (Date.now() - shift.startedAt) / 60000
          )} minutes`
        );
      }

      // --------------------------------------------------
      // MILITARY OPERATIONS
      // --------------------------------------------------

      if (name === "military-operation") {
        if (!isStaff(interaction)) {
          return privateReply(
            interaction,
            "You do not have permission to manage operations."
          );
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
          if (data.operations[guild.id]) {
            return privateReply(
              interaction,
              "An operation is already active."
            );
          }

          const operationName =
            interaction.options.getString("name");

          data.operations[guild.id] = {
            name: operationName,
            startedAt: Date.now(),
            startedBy: user.id,
          };

          saveData();

          return privateReply(
            interaction,
            "## Operation Started",
            `**Operation:** ${operationName}`,
            `**Started by:** ${user}`,
            `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`,
            "This operation will automatically expire after one hour."
          );
        }

        if (sub === "end") {
          const operation = data.operations[guild.id];

          if (!operation) {
            return privateReply(
              interaction,
              "There is no active operation."
            );
          }

          delete data.operations[guild.id];
          saveData();

          return privateReply(
            interaction,
            "## Operation Ended",
            `**Operation:** ${operation.name}`,
            `**Ended by:** ${user}`
          );
        }

        const operation = data.operations[guild.id];

        if (!operation) {
          return privateReply(
            interaction,
            "There is no active operation."
          );
        }

        return privateReply(
          interaction,
          "## Operation Status",
          `**Operation:** ${operation.name}`,
          `**Started by:** <@${operation.startedBy}>`,
          `**Started:** <t:${Math.floor(operation.startedAt / 1000)}:R>`
        );
      }

      // --------------------------------------------------
      // TRAINING SESSION
      // --------------------------------------------------

      if (name === "training-session") {
        if (!isStaff(interaction)) {
          return privateReply(
            interaction,
            "You do not have permission to announce training."
          );
        }

        const details = interaction.options.getString("details");

        await interaction.channel.send(
          v2(
            "## Training Session",
            `**Organiser:** ${user}`,
            `**Details:** ${details}`
          )
        );

        return privateReply(
          interaction,
          "The training announcement has been posted."
        );
      }

      // --------------------------------------------------
      // WARN
      // --------------------------------------------------

      if (name === "warn") {
        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason");

        data.warnings[target.id] ??= [];

        data.warnings[target.id].push({
          guildId: guild.id,
          moderatorId: user.id,
          reason,
          timestamp: Date.now(),
        });

        saveData();

        await target
          .send(
            privateV2(
              "## Warning Received",
              `**Server:** ${guild.name}`,
              `**Reason:** ${reason}`
            )
          )
          .catch(() => {});

        return privateReply(
          interaction,
          "## Warning Recorded",
          `**Member:** ${target}`,
          `**Reason:** ${reason}`
        );
      }

      // --------------------------------------------------
      // TIMEOUT
      // --------------------------------------------------

      if (name === "timeout") {
        const target = interaction.options.getMember("member");
        const minutes = interaction.options.getInteger("minutes");
        const reason =
          interaction.options.getString("reason") ||
          "No reason provided";

        if (!target?.moderatable) {
          return privateReply(
            interaction,
            "I cannot timeout that member. Check my permissions and role position."
          );
        }

        await target.timeout(minutes * 60000, reason);

        return privateReply(
          interaction,
          "## Member Timed Out",
          `**Member:** ${target.user}`,
          `**Duration:** ${minutes} minutes`,
          `**Reason:** ${reason}`
        );
      }

      // --------------------------------------------------
      // KICK
      // --------------------------------------------------

      if (name === "kick") {
        const target = interaction.options.getMember("member");
        const reason =
          interaction.options.getString("reason") ||
          "No reason provided";

        if (!target?.kickable) {
          return privateReply(
            interaction,
            "I cannot kick that member. Check my permissions and role position."
          );
        }

        await target.kick(reason);

        return privateReply(
          interaction,
          "## Member Kicked",
          `**Member:** ${target.user.tag}`,
          `**Reason:** ${reason}`
        );
      }

      // --------------------------------------------------
      // BAN
      // --------------------------------------------------

      if (name === "ban") {
        const target = interaction.options.getUser("member");
        const reason =
          interaction.options.getString("reason") ||
          "No reason provided";

        const targetMember = await guild.members
          .fetch(target.id)
          .catch(() => null);

        if (targetMember && !targetMember.bannable) {
          return privateReply(
            interaction,
            "I cannot ban that member. Check my permissions and role position."
          );
        }

        await guild.members.ban(target.id, { reason });

        return privateReply(
          interaction,
          "## Member Banned",
          `**Member:** ${target.tag}`,
          `**Reason:** ${reason}`
        );
      }

      // --------------------------------------------------
      // PURGE
      // --------------------------------------------------

      if (name === "purge") {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.bulkDelete) {
          return privateReply(
            interaction,
            "This command cannot be used here."
          );
        }

        const messages = await interaction.channel.bulkDelete(
          amount,
          true
        );

        return privateReply(
          interaction,
          "## Messages Deleted",
          `Deleted **${messages.size}** messages. Messages older than 14 days cannot be bulk deleted.`
        );
      }

      // --------------------------------------------------
      // MODERATION LOGS
      // --------------------------------------------------

      if (name === "modlogs") {
        const target = interaction.options.getUser("member");

        const records = (data.warnings[target.id] || []).filter(
          (record) => record.guildId === guild.id
        );

        if (!records.length) {
          return privateReply(
            interaction,
            "No warnings are recorded for this member."
          );
        }

        return privateReply(
          interaction,
          "## Moderation Records",
          `**Member:** ${target}`,
          records
            .slice(-10)
            .map(
              (record, index) =>
                `**${index + 1}.** ${record.reason}\nModerator: <@${record.moderatorId}> · <t:${Math.floor(record.timestamp / 1000)}:R>`
            )
            .join("\n\n")
        );
      }

      // --------------------------------------------------
      // ANNOUNCEMENTS
      // --------------------------------------------------

      if (name === "announce") {
        const channel =
          interaction.options.getChannel("channel");
        const message =
          interaction.options.getString("message");

        await channel.send(
          v2(
            "## London, Uxbridge Announcement",
            message,
            `**Posted by:** ${user}`
          )
        );

        return privateReply(
          interaction,
          "The announcement has been posted."
        );
      }
    }

    // --------------------------------------------------
    // TICKET SETUP TYPE MENU
    // --------------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_setup_type"
    ) {
      if (!isAdmin(interaction)) {
        return privateReply(
          interaction,
          "Only administrators can configure ticket panels."
        );
      }

      const session = setupSessions.get(
        `${interaction.guildId}:${interaction.user.id}`
      );

      if (!session) {
        return privateReply(
          interaction,
          "Your setup session expired. Run `/ticket` again."
        );
      }

      session.type = interaction.values[0];

      return privateReply(
        interaction,
        `Selected panel type: **${TICKET_TYPES[session.type].label}**.`,
        "Continue with the panel channel, ticket category and logs channel."
      );
    }

    // --------------------------------------------------
    // TICKET SETUP CHANNEL MENUS
    // --------------------------------------------------

    if (
      interaction.isChannelSelectMenu() &&
      [
        "ticket_setup_panel_channel",
        "ticket_setup_category",
        "ticket_setup_logs_channel",
      ].includes(interaction.customId)
    ) {
      if (!isAdmin(interaction)) {
        return privateReply(
          interaction,
          "Only administrators can configure ticket panels."
        );
      }

      const session = setupSessions.get(
        `${interaction.guildId}:${interaction.user.id}`
      );

      if (!session) {
        return privateReply(
          interaction,
          "Your setup session expired. Run `/ticket` again."
        );
      }

      if (
        interaction.customId === "ticket_setup_panel_channel"
      ) {
        session.panelChannelId = interaction.values[0];
      }

      if (interaction.customId === "ticket_setup_category") {
        session.categoryId = interaction.values[0];
      }

      if (
        interaction.customId === "ticket_setup_logs_channel"
      ) {
        session.logsChannelId = interaction.values[0];
      }

      const labels = {
        ticket_setup_panel_channel: "Panel channel",
        ticket_setup_category: "Ticket category",
        ticket_setup_logs_channel: "Logs channel",
      };

      return privateReply(
        interaction,
        `**${labels[interaction.customId]} selected.** <#${interaction.values[0]}>`
      );
    }

    // --------------------------------------------------
    // CONFIRM OR CANCEL TICKET SETUP
    // --------------------------------------------------

    if (
      interaction.isButton() &&
      [
        "ticket_setup_confirm",
        "ticket_setup_cancel",
      ].includes(interaction.customId)
    ) {
      if (!isAdmin(interaction)) {
        return privateReply(
          interaction,
          "Only administrators can configure ticket panels."
        );
      }

      const key = `${interaction.guildId}:${interaction.user.id}`;
      const session = setupSessions.get(key);

      if (!session) {
        return privateReply(
          interaction,
          "Your setup session expired. Run `/ticket` again."
        );
      }

      if (interaction.customId === "ticket_setup_cancel") {
        setupSessions.delete(key);

        return privateReply(
          interaction,
          "Ticket setup cancelled."
        );
      }

      if (
        !session.type ||
        !session.panelChannelId ||
        !session.categoryId ||
        !session.logsChannelId
      ) {
        return privateReply(
          interaction,
          "Setup is incomplete. Choose a panel type, panel channel, ticket category and logs channel before confirming."
        );
      }

      const guild = interaction.guild;

      const panelChannel = await guild.channels
        .fetch(session.panelChannelId)
        .catch(() => null);

      const category = await guild.channels
        .fetch(session.categoryId)
        .catch(() => null);

      const logsChannel = await guild.channels
        .fetch(session.logsChannelId)
        .catch(() => null);

      if (
        !panelChannel ||
        panelChannel.type !== ChannelType.GuildText ||
        !category ||
        category.type !== ChannelType.GuildCategory ||
        !logsChannel ||
        logsChannel.type !== ChannelType.GuildText
      ) {
        return privateReply(
          interaction,
          "One of the selected channels is unavailable. Run `/ticket` again and choose valid channels."
        );
      }

      const botMember = await guild.members.fetchMe();

      const panelPermissions =
        panelChannel.permissionsFor(botMember);

      if (
        !panelPermissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ])
      ) {
        return privateReply(
          interaction,
          "I cannot post in that panel channel. Give me View Channel and Send Messages permissions there."
        );
      }

      const type = TICKET_TYPES[session.type];

      const openButton = makeButton(
        `ticket_open_${session.type}`,
        type.button,
        ButtonStyle.Primary
      );

      try {
        /*
         * THIS IS THE MAIN FIX.
         *
         * The heading, description, instructions and button
         * are all included in ONE Components V2 container.
         * The button is not sent as a separate message.
         */

        const ticketPanel = v2WithRows(
          [
            `# ${type.label}`,
            "**LONDON, UXBRIDGE | SUPPORT CENTRE**",
            type.description,
            " ",
            "### Before opening a ticket",
            type.guidance,
            " ",
            "**What happens next?**",
            "Your ticket will be private to you and the authorised support team.",
            "Please do not open duplicate tickets for the same issue.",
            " ",
            "Select the button below when you are ready.",
          ],
          [
            new ActionRowBuilder().addComponents(openButton),
          ]
        );

        await panelChannel.send(ticketPanel);
      } catch (error) {
        console.error("Could not post ticket panel:", error);

        return privateReply(
          interaction,
          "I could not post the panel. Check my permissions in the selected channel and check the hosting logs."
        );
      }

      data.ticketConfigs[guild.id] ??= {};

      data.ticketConfigs[guild.id][session.type] = {
        panelChannelId: session.panelChannelId,
        categoryId: session.categoryId,
        logsChannelId: session.logsChannelId,
      };

      saveData();
      setupSessions.delete(key);

      return privateReply(
        interaction,
        "## Ticket Setup Complete",
        `**Panel:** ${type.label}`,
        `**Panel channel:** <#${panelChannel.id}>`,
        `**Ticket category:** <#${category.id}>`,
        `**Logs channel:** <#${logsChannel.id}>`,
        "Your ticket panel has been published. Run `/ticket` again to configure another panel type."
      );
    }

    // --------------------------------------------------
    // INFORMATION DROPDOWN
    // --------------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "community_information"
    ) {
      const sections = {
        information: [
          "## About London, Uxbridge",
          "A British Roblox roleplay community aiming to provide organised, enjoyable and realistic roleplay.",
        ],

        server_rules: [
          "## Server Rules",
          "1. Treat members respectfully.",
          "2. Do not harass, threaten or discriminate against others.",
          "3. Do not spam or disrupt channels.",
          "4. Follow staff instructions.",
          "5. Do not share private information without permission.",
          "6. Use the appropriate channels for support.",
        ],

        game_rules: [
          "## Game Rules",
          "1. Keep roleplay appropriate and realistic.",
          "2. Do not exploit or cheat.",
          "3. Do not disrupt other players' roleplay.",
          "4. Follow department procedures.",
          "5. Do not impersonate staff.",
        ],

        departments: [
          "## Departments",
          "Information about departments, applications and requirements will be published by authorised community staff.",
        ],

        disclaimer: [
          "## Disclaimer",
          "London, Uxbridge is an independent Roblox roleplay community. It is not affiliated with or endorsed by the real London Borough of Hillingdon, the Metropolitan Police Service, the London Fire Brigade, the NHS or any other real-world public authority.",
          "Roleplay activities are fictional and for entertainment.",
        ],
      };

      const selected = sections[interaction.values[0]];

      if (!selected) {
        return privateReply(
          interaction,
          "That information section could not be found."
        );
      }

      return privateReply(interaction, ...selected);
    }

    // --------------------------------------------------
    // OPEN A PRIVATE TICKET
    // --------------------------------------------------

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("ticket_open_")
    ) {
      const guild = interaction.guild;
      const user = interaction.user;

      const typeKey = interaction.customId.replace(
        "ticket_open_",
        ""
      );

      const type = TICKET_TYPES[typeKey];
      const config = getConfig(guild.id)?.[typeKey];

      if (!type || !config) {
        return privateReply(
          interaction,
          "This ticket panel is not configured correctly. Ask an administrator to run `/ticket` again."
        );
      }

      const existing = Object.values(data.tickets).find(
        (ticket) =>
          ticket.guildId === guild.id &&
          ticket.userId === user.id &&
          !ticket.closed
      );

      if (existing) {
        const existingChannel = await guild.channels
          .fetch(existing.channelId)
          .catch(() => null);

        if (existingChannel) {
          return privateReply(
            interaction,
            `You already have an open ticket: <#${existingChannel.id}>`
          );
        }

        delete data.tickets[existing.channelId];
        saveData();
      }

      await interaction.deferReply({
        flags:
          MessageFlags.Ephemeral |
          MessageFlags.IsComponentsV2,
      });

      const category = await guild.channels
        .fetch(config.categoryId)
        .catch(() => null);

      if (
        !category ||
        category.type !== ChannelType.GuildCategory
      ) {
        return interaction.editReply(
          privateV2(
            "The configured ticket category no longer exists. Ask an administrator to run `/ticket` again."
          )
        );
      }

      const ticketNumber = data.nextTicketNumber++;
      const username = slugify(user.username);

      const baseName =
        `${type.slug}-${username}`.slice(0, 90);

      let ticketName = baseName;
      let suffix = 2;

      while (
        guild.channels.cache.some(
          (channel) =>
            channel.parentId === category.id &&
            channel.name === ticketName
        )
      ) {
        ticketName =
          `${baseName.slice(0, 85)}-${suffix++}`;
      }

      const overwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ];

      const supportRole =
        guild.roles.cache.get(SUPPORT_ROLE_ID);

      const escalationRole =
        guild.roles.cache.get(ESCALATION_ROLE_ID);

      if (supportRole) {
        overwrites.push({
          id: supportRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        });
      }

      if (escalationRole) {
        overwrites.push({
          id: escalationRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
          deny: [PermissionFlagsBits.SendMessages],
        });
      }

      let channel;

      try {
        channel = await guild.channels.create({
          name: ticketName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `Ticket #${ticketNumber} | ${type.label} | Opened by ${user.tag}`,
          permissionOverwrites: overwrites,
        });
      } catch (error) {
        console.error("Ticket channel creation failed:", error);

        return interaction.editReply(
          privateV2(
            "I couldn't create the private ticket. Check my Manage Channels permission and the category permissions."
          )
        );
      }

      const ticket = {
        channelId: channel.id,
        guildId: guild.id,
        userId: user.id,
        ticketNumber,
        type: typeKey,
        createdAt: Date.now(),
        claimedBy: null,
        closed: false,
        escalated: false,
        lastAction: "Ticket opened",
      };

      data.tickets[channel.id] = ticket;
      saveData();

      const controls = new ActionRowBuilder().addComponents(
        makeButton(
          "ticket_claim",
          "Claim Ticket",
          ButtonStyle.Primary
        ),
        makeButton(
          "ticket_close",
          "Close Ticket",
          ButtonStyle.Danger
        ),
        makeButton(
          "ticket_modpanel",
          "Staff Tools",
          ButtonStyle.Secondary
        )
      );

      /*
       * The ticket welcome text and management controls
       * are also placed together in one Components V2 panel.
       */

      await channel.send({
        ...v2WithRows(
          [
            `# ${type.label}`,
            `## Welcome, ${user.username}`,
            "Your private ticket is now open. A member of the support team will assist you as soon as possible.",
            `**Ticket number:** #${ticketNumber}`,
            " ",
            "### What happens next?",
            type.intro,
            " ",
            "### Please include",
            type.guidance,
            " ",
            "Keep all details and evidence in this channel. Please be patient while staff review your ticket.",
            `**Ticket owner:** <@${user.id}>`,
          ],
          [controls]
        ),
        allowedMentions: {
          users: [user.id],
        },
      });

      if (supportRole) {
        await channel.send({
          ...v2(
            `Support team notified: <@&${supportRole.id}>`
          ),
          allowedMentions: {
            roles: [supportRole.id],
          },
        }).catch(console.error);
      }

      await createTicketLog(
        guild,
        ticket,
        config.logsChannelId
      );

      return interaction.editReply(
        privateV2(
          `Your ${type.label} ticket has been created.`,
          `Head to your ticket at <#${channel.id}>.`
        )
      );
    }

    // --------------------------------------------------
    // TICKET MANAGEMENT BUTTONS
    // --------------------------------------------------

    if (
      interaction.isButton() &&
      [
        "ticket_claim",
        "ticket_close",
        "ticket_modpanel",
        "ticket_rename",
        "ticket_unclaim",
        "ticket_escalate",
      ].includes(interaction.customId)
    ) {
      const ticket = getTicket(interaction.channelId);

      if (
        !ticket ||
        ticket.guildId !== interaction.guildId
      ) {
        return privateReply(
          interaction,
          "This ticket could not be found."
        );
      }

      if (!isStaff(interaction)) {
        return privateReply(
          interaction,
          "Only authorised support staff can use these controls."
        );
      }

      // CLAIM TICKET

      if (interaction.customId === "ticket_claim") {
        if (ticket.closed) {
          return privateReply(
            interaction,
            "This ticket is closed."
          );
        }

        if (ticket.claimedBy) {
          return privateReply(
            interaction,
            `This ticket is already claimed by <@${ticket.claimedBy}>.`
          );
        }

        ticket.claimedBy = interaction.user.id;
        ticket.updatedAt = Date.now();

        saveData();

        await interaction.channel.send(
          v2(
            "## Ticket Claimed",
            `This ticket has been claimed by ${interaction.user}.`
          )
        );

        await sendTicketLog(
          interaction.guild,
          ticket,
          `Ticket claimed by ${interaction.user.tag}`
        );

        return privateReply(
          interaction,
          "You have claimed this ticket."
        );
      }

      // CLOSE TICKET

      if (interaction.customId === "ticket_close") {
        if (ticket.closed) {
          return privateReply(
            interaction,
            "This ticket is already closed."
          );
        }

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;
        ticket.updatedAt = Date.now();

        saveData();

        await interaction.channel.permissionOverwrites
          .edit(ticket.userId, {
            SendMessages: false,
            ViewChannel: true,
          })
          .catch(console.error);

        const ticketOwner = await client.users
          .fetch(ticket.userId)
          .catch(() => null);

        await interaction.channel
          .setName(
            `closed-${ticket.type}-${slugify(
              ticketOwner?.username || "ticket"
            )}`.slice(0, 95)
          )
          .catch(console.error);

        await interaction.channel.send(
          v2(
            "## Ticket Closed",
            `This ticket was closed by ${interaction.user}.`,
            "The ticket owner can no longer send messages. Staff can reopen it by editing the channel permissions if needed."
          )
        );

        await sendTicketLog(
          interaction.guild,
          ticket,
          `Ticket closed by ${interaction.user.tag}`
        );

        return privateReply(
          interaction,
          "The ticket has been closed."
        );
      }

      // STAFF TOOLS

      if (interaction.customId === "ticket_modpanel") {
        const controls = new ActionRowBuilder().addComponents(
          makeButton(
            "ticket_rename",
            "Rename Ticket"
          ),
          makeButton(
            "ticket_unclaim",
            "Unclaim",
            ButtonStyle.Secondary
          ),
          makeButton(
            "ticket_escalate",
            "Escalate",
            ButtonStyle.Primary
          )
        );

        return interaction.reply(
          v2WithRows(
            [
              "## Ticket Staff Tools",
              "Choose an action for this ticket.",
            ],
            [controls],
            true
          )
        );
      }

      // RENAME TICKET MODAL

      if (interaction.customId === "ticket_rename") {
        const modal = new ModalBuilder()
          .setCustomId("ticket_rename_modal")
          .setTitle("Rename Ticket")
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId("new_name")
                .setLabel("New channel name")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(90)
            )
          );

        return interaction.showModal(modal);
      }

      // UNCLAIM TICKET

      if (interaction.customId === "ticket_unclaim") {
        if (ticket.closed) {
          return privateReply(
            interaction,
            "This ticket is closed."
          );
        }

        ticket.claimedBy = null;
        ticket.updatedAt = Date.now();

        saveData();

        await sendTicketLog(
          interaction.guild,
          ticket,
          `Ticket unclaimed by ${interaction.user.tag}`
        );

        return privateReply(
          interaction,
          "The ticket has been unclaimed."
        );
      }

      // ESCALATE TICKET

      if (interaction.customId === "ticket_escalate") {
        const role = interaction.guild.roles.cache.get(
          ESCALATION_ROLE_ID
        );

        if (!role) {
          return privateReply(
            interaction,
            "The escalation role was not found. Check the role ID in index.js."
          );
        }

        await interaction.channel.permissionOverwrites.edit(
          role.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
          }
        );

        ticket.escalated = true;
        ticket.updatedAt = Date.now();

        saveData();

        await interaction.channel.send(
          v2(
            "## Ticket Escalated",
            `This ticket has been escalated by ${interaction.user}.`
          )
        );

        await interaction.channel.send({
          ...v2(
            `Escalation team notified: <@&${role.id}>`
          ),
          allowedMentions: {
            roles: [role.id],
          },
        }).catch(console.error);

        await sendTicketLog(
          interaction.guild,
          ticket,
          `Ticket escalated by ${interaction.user.tag}`
        );

        return privateReply(
          interaction,
          "The ticket has been escalated."
        );
      }
    }

    // --------------------------------------------------
    // RENAME MODAL SUBMISSION
    // --------------------------------------------------

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "ticket_rename_modal"
    ) {
      const ticket = getTicket(interaction.channelId);

      if (!ticket || !isStaff(interaction)) {
        return privateReply(
          interaction,
          "You cannot rename this ticket."
        );
      }

      const newName = slugify(
        interaction.fields.getTextInputValue("new_name")
      ).slice(0, 90);

      if (!newName) {
        return privateReply(
          interaction,
          "Please enter a valid channel name."
        );
      }

      await interaction.channel.setName(newName);

      await sendTicketLog(
        interaction.guild,
        ticket,
        `Ticket renamed to ${newName} by ${interaction.user.tag}`
      );

      return privateReply(
        interaction,
        `Ticket renamed to **${newName}**.`
      );
    }
  } catch (error) {
    console.error("Interaction error:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(
          privateV2(
            "Something went wrong. Please check the hosting logs."
          )
        );
      } else {
        await interaction.reply(
          privateV2(
            "Something went wrong. Please check the hosting logs."
          )
        );
      }
    } catch (replyError) {
      console.error(
        "Could not send error response:",
        replyError
      );
    }
  }
});

// ==================================================
// AUTOMATIC SHIFT AND OPERATION EXPIRY
// ==================================================

setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [guildId, shift] of Object.entries(data.shifts)) {
    if (
      shift &&
      now - shift.startedAt >= 60 * 60 * 1000
    ) {
      delete data.shifts[guildId];
      changed = true;
    }
  }

  for (const [guildId, operation] of Object.entries(data.operations)) {
    if (
      operation &&
      now - operation.startedAt >= 60 * 60 * 1000
    ) {
      delete data.operations[guildId];
      changed = true;
    }
  }

  if (changed) {
    saveData();
  }
}, 60 * 1000);

// ==================================================
// START BOT
// ==================================================

client.login(TOKEN);
