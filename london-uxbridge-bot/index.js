
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
  OverwriteType,
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

// Stores unfinished setup sessions until Confirm Setup is clicked.
const setupSessions = new Map();

const TICKET_TYPES = {
  report: {
    label: "Report a User",
    description: "Report a user or incident.",
    button: "Open Report",
    intro: "Use this ticket to report a user or incident. Explain what happened and include any relevant evidence.",
  },
  appeal: {
    label: "Appeals",
    description: "Submit an appeal for review.",
    button: "Submit Appeal",
    intro: "Use this ticket to submit an appeal. Explain the decision you are appealing and why it should be reviewed.",
  },
  staff: {
    label: "Staff Report",
    description: "Report a member of staff.",
    button: "Report Staff",
    intro: "Use this ticket to report a staff member. Provide details and any relevant evidence.",
  },
  enquiries: {
    label: "Enquiries",
    description: "Ask the support team a question.",
    button: "Open Enquiry",
    intro: "Use this ticket for general questions and enquiries. Explain how the support team can help.",
  },
};

// ==================================================
// COMPONENTS V2 HELPERS
// ==================================================

function container(...lines) {
  const result = new ContainerBuilder();

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      result.addSeparatorComponents(new SeparatorBuilder());
    }

    result.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines[i])
    );
  }

  return result;
}

function v2(...lines) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container(...lines)],
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

function makeButton(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style);
}

async function sendTicketLog(guild, ticket, text) {
  const config = getConfig(ticket.guildId);
  if (!config?.logsChannelId) return;

  const channel = await guild.channels
    .fetch(config.logsChannelId)
    .catch(() => null);

  if (!channel?.isTextBased()) return;

  await channel.send(
    v2(
      "## London, Uxbridge | Ticket Log",
      text,
      `**Ticket number:** ${ticket.ticketNumber}`,
      `**Ticket type:** ${TICKET_TYPES[ticket.type]?.label || ticket.type}`
    )
  ).catch(console.error);
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Set up a ticket panel using the interactive setup.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the bot command list."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member.")
    .addUserOption(o =>
      o.setName("member")
        .setDescription("Member to inspect.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Manage staff shifts.")
    .addSubcommand(s =>
      s.setName("start").setDescription("Start your staff shift.")
    )
    .addSubcommand(s =>
      s.setName("end").setDescription("End your staff shift.")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage military operations.")
    .addSubcommand(s =>
      s.setName("start")
        .setDescription("Start an operation.")
        .addStringOption(o =>
          o.setName("name")
            .setDescription("Operation name.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("end").setDescription("End the current operation.")
    )
    .addSubcommand(s =>
      s.setName("status").setDescription("View operation status.")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption(o =>
      o.setName("details")
        .setDescription("Training details.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to warn.").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to timeout.").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Duration in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to kick.").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to ban.").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("Number of messages to delete.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View a member's warning records.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("member").setDescription("Member to inspect.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Announcement channel.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message").setDescription("Announcement text.").setRequired(true)
    ),
].map(command => command.toJSON());

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

client.on("interactionCreate", async interaction => {
  try {
    // ==============================================
    // SLASH COMMANDS
    // ==============================================

    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        return privateReply(interaction, "Please use this command inside a server.");
      }

      const guild = interaction.guild;
      const user = interaction.user;
      const member = interaction.member;
      const name = interaction.commandName;

      if (name === "ping") {
        return privateReply(interaction, "Pong! The bot is online.");
      }

      if (name === "help") {
        return privateReply(
          interaction,
          "## London, Uxbridge Commands",
          "**Tickets:** `/ticket`",
          "**Information:** `/information`, `/help`, `/ping`, `/userinfo`",
          "**Staff:** `/staff-shift`, `/training-session`",
          "**Operations:** `/military-operation`",
          "**Moderation:** `/warn`, `/timeout`, `/kick`, `/ban`, `/purge`, `/modlogs`, `/announce`"
        );
      }

      // --------------------------------------------
      // INTERACTIVE TICKET SETUP
      // --------------------------------------------

      if (name === "ticket") {
        if (!isAdmin(interaction)) {
          return privateReply(
            interaction,
            "Only server administrators can configure ticket panels."
          );
        }

        const sessionKey = `${guild.id}:${user.id}`;

        setupSessions.set(sessionKey, {
          guildId: guild.id,
          userId: user.id,
          type: null,
          panelChannelId: null,
          logsChannelId: null,
          createdAt: Date.now(),
        });

        const typeMenu = new StringSelectMenuBuilder()
          .setCustomId("ticket_setup_type")
          .setPlaceholder("1. Choose a ticket panel")
          .addOptions(
            {
              label: "Report a User",
              value: "report",
              description: "Configure the user report panel.",
            },
            {
              label: "Appeals",
              value: "appeal",
              description: "Configure the appeal panel.",
            },
            {
              label: "Staff Report",
              value: "staff",
              description: "Configure the staff report panel.",
            },
            {
              label: "Enquiries",
              value: "enquiries",
              description: "Configure the enquiries panel.",
            }
          );

        const panelChannelMenu = new ChannelSelectMenuBuilder()
          .setCustomId("ticket_setup_panel_channel")
          .setPlaceholder("2. Choose where the panel will be posted")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1);

        const logsChannelMenu = new ChannelSelectMenuBuilder()
          .setCustomId("ticket_setup_logs_channel")
          .setPlaceholder("3. Choose the ticket logs channel")
          .setChannelTypes(ChannelType.GuildText)
          .setMinValues(1)
          .setMaxValues(1);

        const confirmButton = makeButton(
          "ticket_setup_confirm",
          "Confirm Setup",
          ButtonStyle.Success
        );

        const cancelButton = makeButton(
          "ticket_setup_cancel",
          "Cancel",
          ButtonStyle.Danger
        );

        return interaction.reply({
          ...privateV2(
            "## London, Uxbridge | Ticket Setup",
            "Configure your ticket system below. Select a ticket type, choose the channel where its panel should appear, and choose a logs channel.",
            "**Step 1 — Ticket panel**\nChoose Report a User, Appeals, Staff Report, or Enquiries.",
            "**Step 2 — Panel channel**\nChoose the text channel where members will see the panel.",
            "**Step 3 — Logs channel**\nChoose where ticket actions will be logged.",
            "**Step 4 — Confirm**\nPress Confirm Setup to save your choices and publish the panel."
          ),
          components: [
            new ActionRowBuilder().addComponents(typeMenu),
            new ActionRowBuilder().addComponents(panelChannelMenu),
            new ActionRowBuilder().addComponents(logsChannelMenu),
            new ActionRowBuilder().addComponents(confirmButton, cancelButton),
          ],
        });
      }

      if (name === "information") {
        if (!isAdmin(interaction)) {
          return privateReply(interaction, "Only administrators can post the information panel.");
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

        await interaction.channel.send({
          ...v2(
            "## London, Uxbridge",
            "Welcome to London, Uxbridge, a British Roblox roleplay community. Use the menu below to view community information and rules."
          ),
          components: [new ActionRowBuilder().addComponents(menu)],
        });

        return privateReply(interaction, "The information panel has been posted.");
      }

      if (name === "userinfo") {
        const target = interaction.options.getUser("member") || user;
        const targetMember = await guild.members.fetch(target.id).catch(() => null);

        return privateReply(
          interaction,
          "## Member Information",
          `**Username:** ${target.username}`,
          `**User ID:** ${target.id}`,
          `**Account created:** <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
          `**Joined server:** ${targetMember?.joinedTimestamp ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:F>` : "Unknown"}`
        );
      }

      if (name === "staff-shift") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "You do not have permission to manage staff shifts.");
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
          if (data.shifts[guild.id]?.userId === user.id) {
            return privateReply(interaction, "You already have an active shift.");
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
            `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`
          );
        }

        const shift = data.shifts[guild.id];

        if (!shift || shift.userId !== user.id) {
          return privateReply(interaction, "You do not have an active shift.");
        }

        delete data.shifts[guild.id];
        saveData();

        return privateReply(
          interaction,
          "## Staff Shift Ended",
          `**Staff member:** ${user}`,
          `**Duration:** ${Math.floor((Date.now() - shift.startedAt) / 60000)} minutes`
        );
      }

      if (name === "military-operation") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "You do not have permission to manage operations.");
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
          if (data.operations[guild.id]) {
            return privateReply(interaction, "An operation is already active.");
          }

          const operationName = interaction.options.getString("name");

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
            `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`
          );
        }

        if (sub === "end") {
          const operation = data.operations[guild.id];

          if (!operation) {
            return privateReply(interaction, "There is no active operation.");
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
          return privateReply(interaction, "There is no active operation.");
        }

        return privateReply(
          interaction,
          "## Operation Status",
          `**Operation:** ${operation.name}`,
          `**Started by:** <@${operation.startedBy}>`,
          `**Started:** <t:${Math.floor(operation.startedAt / 1000)}:R>`
        );
      }

      if (name === "training-session") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "You do not have permission to announce training.");
        }

        const details = interaction.options.getString("details");

        await interaction.channel.send(
          v2(
            "## Training Session",
            `**Organiser:** ${user}`,
            `**Details:** ${details}`
          )
        );

        return privateReply(interaction, "The training announcement has been posted.");
      }

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

        await target.send(
          privateV2(
            "## Warning Received",
            `**Server:** ${guild.name}`,
            `**Reason:** ${reason}`
          )
        ).catch(() => {});

        return privateReply(
          interaction,
          "## Warning Recorded",
          `**Member:** ${target}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "timeout") {
        const target = interaction.options.getMember("member");
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!target?.moderatable) {
          return privateReply(interaction, "I cannot timeout that member. Check my permissions and role position.");
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

      if (name === "kick") {
        const target = interaction.options.getMember("member");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!target?.kickable) {
          return privateReply(interaction, "I cannot kick that member. Check my permissions and role position.");
        }

        await target.kick(reason);

        return privateReply(
          interaction,
          "## Member Kicked",
          `**Member:** ${target.user.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "ban") {
        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const targetMember = await guild.members.fetch(target.id).catch(() => null);

        if (targetMember && !targetMember.bannable) {
          return privateReply(interaction, "I cannot ban that member. Check my permissions and role position.");
        }

        await guild.members.ban(target.id, { reason });

        return privateReply(
          interaction,
          "## Member Banned",
          `**Member:** ${target.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "purge") {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.bulkDelete) {
          return privateReply(interaction, "This command cannot be used here.");
        }

        const messages = await interaction.channel.bulkDelete(amount, true);

        return privateReply(
          interaction,
          "## Messages Deleted",
          `Deleted **${messages.size}** messages. Messages older than 14 days cannot be bulk deleted.`
        );
      }

      if (name === "modlogs") {
        const target = interaction.options.getUser("member");
        const records = (data.warnings[target.id] || [])
          .filter(record => record.guildId === guild.id);

        if (!records.length) {
          return privateReply(interaction, "No warnings are recorded for this member.");
        }

        return privateReply(
          interaction,
          "## Moderation Records",
          `**Member:** ${target}`,
          records.slice(-10).map((record, i) =>
            `**${i + 1}.** ${record.reason}\nModerator: <@${record.moderatorId}> • <t:${Math.floor(record.timestamp / 1000)}:R>`
          ).join("\n\n")
        );
      }

      if (name === "announce") {
        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");

        await channel.send(
          v2(
            "## London, Uxbridge Announcement",
            message,
            `**Posted by:** ${user}`
          )
        );

        return privateReply(interaction, "The announcement has been posted.");
      }
    }

    // ==============================================
    // TICKET SETUP DROPDOWNS
    // ==============================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_setup_type"
    ) {
      if (!isAdmin(interaction)) {
        return privateReply(interaction, "Only administrators can configure ticket panels.");
      }

      const key = `${interaction.guildId}:${interaction.user.id}`;
      const session = setupSessions.get(key);

      if (!session) {
        return privateReply(interaction, "Your setup session expired. Run `/ticket` again.");
      }

      session.type = interaction.values[0];

      return privateReply(
        interaction,
        `Ticket type selected: **${TICKET_TYPES[session.type].label}**.`,
        "Continue by choosing the panel channel and logs channel, then press Confirm Setup."
      );
    }

    if (
      interaction.isChannelSelectMenu() &&
      (
        interaction.customId === "ticket_setup_panel_channel" ||
        interaction.customId === "ticket_setup_logs_channel"
      )
    ) {
      if (!isAdmin(interaction)) {
        return privateReply(interaction, "Only administrators can configure ticket panels.");
      }

      const key = `${interaction.guildId}:${interaction.user.id}`;
      const session = setupSessions.get(key);

      if (!session) {
        return privateReply(interaction, "Your setup session expired. Run `/ticket` again.");
      }

      if (interaction.customId === "ticket_setup_panel_channel") {
        session.panelChannelId = interaction.values[0];

        return privateReply(
          interaction,
          `Panel channel selected: <#${session.panelChannelId}>.`
        );
      }

      session.logsChannelId = interaction.values[0];

      return privateReply(
        interaction,
        `Logs channel selected: <#${session.logsChannelId}>.`
      );
    }

    // ==============================================
    // CONFIRM OR CANCEL SETUP
    // ==============================================

    if (
      interaction.isButton() &&
      (
        interaction.customId === "ticket_setup_confirm" ||
        interaction.customId === "ticket_setup_cancel"
      )
    ) {
      if (!isAdmin(interaction)) {
        return privateReply(interaction, "Only administrators can configure ticket panels.");
      }

      const key = `${interaction.guildId}:${interaction.user.id}`;
      const session = setupSessions.get(key);

      if (!session) {
        return privateReply(interaction, "Your setup session expired. Run `/ticket` again.");
      }

      if (interaction.customId === "ticket_setup_cancel") {
        setupSessions.delete(key);
        return privateReply(interaction, "Ticket setup cancelled.");
      }

      if (
        !session.type ||
        !session.panelChannelId ||
        !session.logsChannelId
      ) {
        return privateReply(
          interaction,
          "Setup is incomplete. Select a ticket type, panel channel and logs channel before confirming."
        );
      }

      const guild = interaction.guild;
      const panelChannel = await guild.channels
        .fetch(session.panelChannelId)
        .catch(() => null);

      const logsChannel = await guild.channels
        .fetch(session.logsChannelId)
        .catch(() => null);

      if (
        !panelChannel ||
        panelChannel.type !== ChannelType.GuildText ||
        !logsChannel ||
        logsChannel.type !== ChannelType.GuildText
      ) {
        return privateReply(
          interaction,
          "One of the selected channels is unavailable. Run `/ticket` again and choose valid text channels."
        );
      }

      const botMember = await guild.members.fetchMe();

      if (
        !panelChannel.permissionsFor(botMember)?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ])
      ) {
        return privateReply(
          interaction,
          "I cannot post in the selected panel channel. Give the bot View Channel and Send Messages permissions."
        );
      }

      data.ticketConfigs[guild.id] ??= {};
      data.ticketConfigs[guild.id][session.type] = {
        panelChannelId: session.panelChannelId,
        logsChannelId: session.logsChannelId,
      };

      const type = TICKET_TYPES[session.type];

      const openButton = makeButton(
        `ticket_open_${session.type}`,
        type.button,
        ButtonStyle.Primary
      );

      try {
        await panelChannel.send({
          ...v2(
            `## London, Uxbridge | ${type.label}`,
            type.intro,
            "Press the button below to open a private ticket with the support team.",
            "Please do not open multiple tickets for the same issue."
          ),
          components: [
            new ActionRowBuilder().addComponents(openButton),
          ],
        });
      } catch (error) {
        console.error("Could not post ticket panel:", error);
        return privateReply(
          interaction,
          "I could not post the panel. Check my permissions in the selected channel."
        );
      }

      saveData();
      setupSessions.delete(key);

      return privateReply(
        interaction,
        "## Ticket Setup Confirmed",
        `**Panel type:** ${type.label}`,
        `**Panel channel:** ${panelChannel}`,
        `**Logs channel:** ${logsChannel}`,
        "Your panel has been posted successfully."
      );
    }

    // ==============================================
    // INFORMATION DROPDOWN
    // ==============================================

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
        return privateReply(interaction, "That information section could not be found.");
      }

      return privateReply(interaction, ...selected);
    }

    // ==============================================
    // OPEN PRIVATE TICKETS
    // ==============================================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("ticket_open_")
    ) {
      const guild = interaction.guild;
      const user = interaction.user;
      const typeKey = interaction.customId.replace("ticket_open_", "");
      const type = TICKET_TYPES[typeKey];
      const config = getConfig(guild.id)?.[typeKey];

      if (!type || !config) {
        return privateReply(
          interaction,
          "This ticket panel is not configured correctly. Ask an administrator to run `/ticket` again."
        );
      }

      const existing = Object.values(data.tickets).find(ticket =>
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
            `You already have an open ticket: ${existingChannel}`
          );
        }

        delete data.tickets[existing.channelId];
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let category = guild.channels.cache.find(channel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name.toLowerCase() === "support tickets"
      );

      if (!category) {
        category = await guild.channels.create({
          name: "Support Tickets",
          type: ChannelType.GuildCategory,
        });
      }

      const ticketNumber = data.nextTicketNumber++;
      const ticketName = `ticket-${String(ticketNumber).padStart(4, "0")}`;

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

      const supportRole = guild.roles.cache.get(SUPPORT_ROLE_ID);
      const escalationRole = guild.roles.cache.get(ESCALATION_ROLE_ID);

      if (supportRole) {
        overwrites.push({
          id: supportRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
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
          topic: `Ticket ${ticketNumber} | ${type.label} | Opened by ${user.tag}`,
          permissionOverwrites: overwrites,
        });
      } catch (error) {
        console.error("Ticket channel creation failed:", error);

        return interaction.editReply(
          "I couldn't create the private ticket. Check my Manage Channels permission and the category permissions."
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
      };

      data.tickets[channel.id] = ticket;
      saveData();

      const controls = new ActionRowBuilder().addComponents(
        makeButton("ticket_claim", "Claim", ButtonStyle.Primary),
        makeButton("ticket_close", "Close", ButtonStyle.Danger),
        makeButton("ticket_modpanel", "Mod Panel", ButtonStyle.Secondary)
      );

      await channel.send({
        ...v2(
          `## ${type.label} | Ticket #${ticketNumber}`,
          `Welcome ${user}. A support team member will assist you as soon as possible.`,
          type.intro,
          "**Please provide any relevant details or evidence below.**"
        ),
        content: `<@${user.id}>${supportRole ? ` <@&${supportRole.id}>` : ""}`,
        allowedMentions: {
          users: [user.id],
          roles: supportRole ? [supportRole.id] : [],
        },
        components: [controls],
      });

      await sendTicketLog(
        guild,
        ticket,
        `**Action:** Ticket opened\n**Member:** ${user}\n**Channel:** ${channel}`
      );

      return interaction.editReply(`Your private ticket has been created: ${channel}`);
    }

    // ==============================================
    // TICKET CONTROLS
    // ==============================================

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

      if (!ticket || ticket.guildId !== interaction.guildId) {
        return privateReply(interaction, "This ticket could not be found.");
      }

      if (!isStaff(interaction)) {
        return privateReply(interaction, "Only authorised support staff can use these controls.");
      }

      if (interaction.customId === "ticket_claim") {
        if (ticket.closed) {
          return privateReply(interaction, "This ticket is closed.");
        }

        if (ticket.claimedBy) {
          return privateReply(interaction, `This ticket is already claimed by <@${ticket.claimedBy}>.`);
        }

        ticket.claimedBy = interaction.user.id;
        saveData();

        await interaction.channel.send(
          v2("## Ticket Claimed", `This ticket has been claimed by ${interaction.user}.`)
        );

        await sendTicketLog(
          interaction.guild,
          ticket,
          `**Action:** Ticket claimed\n**Staff:** ${interaction.user}\n**Channel:** ${interaction.channel}`
        );

        return privateReply(interaction, "You have claimed this ticket.");
      }

      if (interaction.customId === "ticket_close") {
        if (ticket.closed) {
          return privateReply(interaction, "This ticket is already closed.");
        }

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;
        saveData();

        await interaction.channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false,
          ViewChannel: true,
        }).catch(console.error);

        await interaction.channel.setName(
          `closed-${String(ticket.ticketNumber).padStart(4, "0")}`
        ).catch(console.error);

        await interaction.channel.send(
          v2(
            "## Ticket Closed",
            `This ticket was closed by ${interaction.user}.`
          )
        );

        await sendTicketLog(
          interaction.guild,
          ticket,
          `**Action:** Ticket closed\n**Opened by:** <@${ticket.userId}>\n**Closed by:** ${interaction.user}\n**Channel:** ${interaction.channel}`
        );

        return privateReply(interaction, "The ticket has been closed.");
      }

      if (interaction.customId === "ticket_modpanel") {
        const controls = new ActionRowBuilder().addComponents(
          makeButton("ticket_rename", "Change Name"),
          makeButton("ticket_unclaim", "Unclaim"),
          makeButton("ticket_escalate", "Escalate", ButtonStyle.Primary)
        );

        return interaction.reply({
          ...privateV2(
            "## Ticket Moderation Panel",
            "Choose an action for this ticket."
          ),
          components: [controls],
        });
      }

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
          ));

        return interaction.showModal(modal);
      }

      if (interaction.customId === "ticket_unclaim") {
        ticket.claimedBy = null;
        saveData();

        await sendTicketLog(
          interaction.guild,
          ticket,
          `**Action:** Ticket unclaimed\n**Staff:** ${interaction.user}`
        );

        return privateReply(interaction, "The ticket has been unclaimed.");
      }

      if (interaction.customId === "ticket_escalate") {
        const role = interaction.guild.roles.cache.get(ESCALATION_ROLE_ID);

        if (!role) {
          return privateReply(
            interaction,
            "The escalation role was not found in this server. Check the role ID in index.js."
          );
        }

        await interaction.channel.permissionOverwrites.edit(role.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });

        await interaction.channel.send({
          ...v2(
            "## Ticket Escalated",
            `This ticket has been escalated by ${interaction.user}.`
          ),
          content: `<@&${role.id}>`,
          allowedMentions: { roles: [role.id] },
        });

        await sendTicketLog(
          interaction.guild,
          ticket,
          `**Action:** Ticket escalated\n**Staff:** ${interaction.user}`
        );

        return privateReply(interaction, "The ticket has been escalated.");
      }
    }

    // ==============================================
    // RENAME TICKET MODAL
    // ==============================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "ticket_rename_modal"
    ) {
      const ticket = getTicket(interaction.channelId);

      if (!ticket || !isStaff(interaction)) {
        return privateReply(interaction, "You cannot rename this ticket.");
      }

      const newName = interaction.fields
        .getTextInputValue("new_name")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90);

      if (!newName) {
        return privateReply(interaction, "Please enter a valid channel name.");
      }

      await interaction.channel.setName(newName);

      await sendTicketLog(
        interaction.guild,
        ticket,
        `**Action:** Ticket renamed\n**New name:** ${newName}\n**Staff:** ${interaction.user}`
      );

      return privateReply(interaction, `Ticket renamed to **${newName}**.`);
    }
  } catch (error) {
    console.error("Interaction error:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(
          privateV2("Something went wrong. Please check the hosting logs.")
        );
      } else {
        await interaction.reply(
          privateV2("Something went wrong. Please check the hosting logs.")
        );
      }
    } catch (replyError) {
      console.error("Could not send error response:", replyError);
    }
  }
});

// Automatically end shifts and operations after one hour.
setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [guildId, shift] of Object.entries(data.shifts)) {
    if (shift && now - shift.startedAt >= 60 * 60 * 1000) {
      delete data.shifts[guildId];
      changed = true;
    }
  }

  for (const [guildId, operation] of Object.entries(data.operations)) {
    if (operation && now - operation.startedAt >= 60 * 60 * 1000) {
      delete data.operations[guildId];
      changed = true;
    }
  }

  if (changed) saveData();
}, 60 * 1000);

client.login(TOKEN);
