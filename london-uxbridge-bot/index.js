require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits: P,
  ChannelType,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
} = require("discord.js");

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || "";

const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";
const SUPPORT_ROLE_ID = "1558934432675790888";
const ESCALATION_ROLE_ID = "1558933872824287313";
const TICKET_BLACKLIST_ROLE_ID = "1559232249122136136";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
  try {
    return fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
      : {};
  } catch {
    return {};
  }
}

const data = {
  tickets: {},
  ticketConfigs: {},
  warnings: {},
  shifts: {},
  operations: {},
  blacklistedUsers: {},
  nextTicketNumber: 1,
  ...loadData(),
};

for (const key of [
  "tickets",
  "ticketConfigs",
  "warnings",
  "shifts",
  "operations",
  "blacklistedUsers",
]) {
  data[key] ??= {};
}

data.nextTicketNumber ??= 1;

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const setupSessions = new Map();

const TICKET_TYPES = {
  report: {
    label: "Report a User",
    description: "Report a user or incident.",
    slug: "report",
  },
  appeal: {
    label: "Appeals",
    description: "Appeal a moderation decision.",
    slug: "appeal",
  },
  staff: {
    label: "Staff Report",
    description: "Report a concern about staff conduct.",
    slug: "staff-report",
  },
  enquiries: {
    label: "Enquiries",
    description: "Ask a question or request assistance.",
    slug: "enquiry",
  },
};

// --------------------------------------------------
// PANEL HELPERS
// --------------------------------------------------

function makePanel(...lines) {
  const panel = new ContainerBuilder();

  lines.filter(Boolean).forEach((line, index) => {
    if (index) {
      panel.addSeparatorComponents(new SeparatorBuilder());
    }

    panel.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(line))
    );
  });

  return panel;
}

function response(...lines) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [makePanel(...lines)],
  };
}

function privateResponse(...lines) {
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [makePanel(...lines)],
  };
}

async function replyPrivate(interaction, ...lines) {
  const payload = privateResponse(...lines);

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style);
}

function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(P.Administrator)
  );
}

function isStaff(interaction) {
  const roles = interaction.member?.roles?.cache;

  return (
    isAdmin(interaction) ||
    roles?.has(SUPPORT_ROLE_ID) ||
    roles?.has(ESCALATION_ROLE_ID)
  );
}

function hasPermission(interaction, permission) {
  return Boolean(
    interaction.memberPermissions?.has(permission)
  );
}

function slugify(value) {
  return (
    String(value || "member")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 85) || "member"
  );
}

function ticketFor(channelId) {
  return data.tickets[channelId];
}

function warningRecords(guildId, userId) {
  return (data.warnings[userId] || []).filter(
    (record) => record.guildId === guildId
  );
}

// --------------------------------------------------
// SLASH COMMANDS
// --------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the bot command list."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Post community information.")
    .setDefaultMemberPermissions(P.Administrator),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Configure a support ticket panel.")
    .setDefaultMemberPermissions(P.Administrator),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member.")
    .addUserOption((o) =>
      o.setName("member")
        .setDescription("Member to inspect.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Start or end a staff shift.")
    .addSubcommand((s) =>
      s.setName("start").setDescription("Start your shift.")
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End your shift.")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage a military operation.")
    .addSubcommand((s) =>
      s.setName("start")
        .setDescription("Start an operation.")
        .addStringOption((o) =>
          o.setName("name")
            .setDescription("Operation name.")
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName("end").setDescription("End the operation.")
    )
    .addSubcommand((s) =>
      s.setName("status").setDescription("View operation status.")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption((o) =>
      o.setName("details")
        .setDescription("Training details, date and time.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to warn.").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to timeout.").setRequired(true)
    )
    .addIntegerOption((o) =>
      o.setName("minutes")
        .setDescription("Duration in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDefaultMemberPermissions(P.KickMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to kick.").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDefaultMemberPermissions(P.BanMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to ban.").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user by Discord ID.")
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) =>
      o.setName("user_id").setDescription("Discord user ID.").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("reason").setDescription("Reason.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages.")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) =>
      o.setName("amount")
        .setDescription("Number of messages, 1–100.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View a member's warning records.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to inspect.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Clear a member's warnings.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) =>
      o.setName("member").setDescription("Member to clear.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Change channel slowmode.")
    .setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption((o) =>
      o.setName("seconds")
        .setDescription("Seconds; use 0 to disable.")
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock this channel.")
    .setDefaultMemberPermissions(P.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock this channel.")
    .setDefaultMemberPermissions(P.ManageChannels),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Publish an announcement.")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) =>
      o.setName("channel")
        .setDescription("Announcement channel.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("message")
        .setDescription("Announcement message.")
        .setRequired(true)
    ),
].map((command) => command.toJSON());

// --------------------------------------------------
// REGISTER COMMANDS AND START BOT
// --------------------------------------------------

client.once("ready", async () => {
  console.log(`London, Uxbridge online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      : Routes.applicationCommands(CLIENT_ID);

    await rest.put(route, { body: commands });

    console.log(`Registered ${commands.length} slash commands.`);
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

// --------------------------------------------------
// SLASH COMMAND HANDLERS
// --------------------------------------------------

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.guild) {
      if (interaction.isRepliable()) {
        return replyPrivate(
          interaction,
          "Please use this command inside a server."
        );
      }
      return;
    }

    const guild = interaction.guild;
    const user = interaction.user;

    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      if (name === "ping") {
        return replyPrivate(
          interaction,
          "## Bot Status",
          "London, Uxbridge is online.",
          `**Latency:** ${client.ws.ping} ms`
        );
      }

      if (name === "help") {
        return replyPrivate(
          interaction,
          "## London, Uxbridge Commands",
          "**Community:** `/information`, `/help`, `/ping`, `/userinfo`",
          "**Tickets:** `/ticket`",
          "**Staff:** `/staff-shift`, `/training-session`",
          "**Operations:** `/military-operation`",
          "**Moderation:** `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/modlogs`, `/clearwarns`, `/slowmode`, `/lock`, `/unlock`",
          "**Announcements:** `/announce`",
          `**Support:** ${SUPPORT_URL}`
        );
      }

      if (name === "information") {
        if (!isAdmin(interaction)) {
          return replyPrivate(interaction, "Administrator permission is required.");
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("community_info")
          .setPlaceholder("Choose an information section")
          .addOptions(
            { label: "About the Community", value: "about" },
            { label: "Community Rules", value: "rules" },
            { label: "Roleplay Rules", value: "roleplay" },
            { label: "Departments", value: "departments" },
            { label: "Support", value: "support" },
            { label: "Disclaimer", value: "disclaimer" }
          );

        const panel = makePanel(
          "# London, Uxbridge",
          "Welcome to our British Roblox roleplay community.",
          "Use the menu below to explore community information, rules, departments and support."
        );

        panel.addActionRowComponents(
          new ActionRowBuilder().addComponents(menu)
        );

        await interaction.channel.send({
          flags: MessageFlags.IsComponentsV2,
          components: [panel],
        });

        return replyPrivate(interaction, "Information panel published.");
      }

      if (name === "ticket") {
        if (!isAdmin(interaction)) {
          return replyPrivate(interaction, "Administrator permission is required.");
        }

        setupSessions.set(`${guild.id}:${user.id}`, {});

        const typeMenu = new StringSelectMenuBuilder()
          .setCustomId("setup_ticket_type")
          .setPlaceholder("Choose a ticket type")
          .addOptions(
            Object.entries(TICKET_TYPES).map(([value, type]) => ({
              label: type.label,
              value,
              description: type.description,
            }))
          );

        const panelMenu = new ChannelSelectMenuBuilder()
          .setCustomId("setup_panel_channel")
          .setPlaceholder("Select the public panel channel")
          .setChannelTypes(ChannelType.GuildText);

        const categoryMenu = new ChannelSelectMenuBuilder()
          .setCustomId("setup_category")
          .setPlaceholder("Select the ticket category")
          .setChannelTypes(ChannelType.GuildCategory);

        const logsMenu = new ChannelSelectMenuBuilder()
          .setCustomId("setup_logs")
          .setPlaceholder("Select the ticket logs channel")
          .setChannelTypes(ChannelType.GuildText);

        const controls = new ActionRowBuilder().addComponents(
          button("setup_publish", "Publish Panel", ButtonStyle.Success),
          button("setup_cancel", "Cancel", ButtonStyle.Danger)
        );

        const panel = makePanel(
          "# Ticket Setup",
          "1. Select a ticket type.",
          "2. Select the public panel channel.",
          "3. Select the category for private tickets.",
          "4. Select the logs channel.",
          "5. Press Publish Panel.",
          "The bot needs permission to manage channels and send messages."
        );

        panel.addActionRowComponents(
          new ActionRowBuilder().addComponents(typeMenu)
        );
        panel.addActionRowComponents(
          new ActionRowBuilder().addComponents(panelMenu)
        );
        panel.addActionRowComponents(
          new ActionRowBuilder().addComponents(categoryMenu)
        );
        panel.addActionRowComponents(
          new ActionRowBuilder().addComponents(logsMenu)
        );
        panel.addActionRowComponents(controls);

        return interaction.reply({
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          components: [panel],
        });
      }

      if (name === "userinfo") {
        const target = interaction.options.getUser("member") || user;
        const member = await guild.members.fetch(target.id).catch(() => null);

        return replyPrivate(
          interaction,
          "## Member Information",
          `**Username:** ${target.tag}`,
          `**User ID:** ${target.id}`,
          `**Account created:** <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
          `**Joined server:** ${
            member?.joinedTimestamp
              ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
              : "Not a current member"
          }`
        );
      }

      if (name === "staff-shift") {
        if (!isStaff(interaction)) {
          return replyPrivate(interaction, "Only authorised staff can use shift tracking.");
        }

        const action = interaction.options.getSubcommand();
        const key = `${guild.id}:${user.id}`;

        if (action === "start") {
          if (data.shifts[key]) {
            return replyPrivate(interaction, "You already have an active shift.");
          }

          data.shifts[key] = { startedAt: Date.now() };
          saveData();

          return replyPrivate(
            interaction,
            "## Shift Started",
            `**Staff member:** ${user}`,
            `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`
          );
        }

        if (action === "end") {
          const shift = data.shifts[key];

          if (!shift) {
            return replyPrivate(interaction, "You do not have an active shift.");
          }

          const minutes = Math.floor((Date.now() - shift.startedAt) / 60000);
          delete data.shifts[key];
          saveData();

          return replyPrivate(
            interaction,
            "## Shift Ended",
            `**Staff member:** ${user}`,
            `**Duration:** ${minutes} minutes`
          );
        }
      }

      if (name === "military-operation") {
        if (!isStaff(interaction)) {
          return replyPrivate(interaction, "Only authorised staff can manage operations.");
        }

        const action = interaction.options.getSubcommand();

        if (action === "start") {
          if (data.operations[guild.id]) {
            return replyPrivate(interaction, "An operation is already active.");
          }

          const operationName = interaction.options.getString("name");

          data.operations[guild.id] = {
            name: operationName,
            leaderId: user.id,
            startedAt: Date.now(),
          };
          saveData();

          return interaction.reply(
            response(
              "## Operation Started",
              `**Name:** ${operationName}`,
              `**Leader:** ${user}`,
              `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`
            )
          );
        }

        if (action === "end") {
          const operation = data.operations[guild.id];

          if (!operation) {
            return replyPrivate(interaction, "There is no active operation.");
          }

          delete data.operations[guild.id];
          saveData();

          return interaction.reply(
            response(
              "## Operation Ended",
              `**Name:** ${operation.name}`,
              `**Ended by:** ${user}`
            )
          );
        }

        const operation = data.operations[guild.id];

        return replyPrivate(
          interaction,
          "## Operation Status",
          operation
            ? `**Name:** ${operation.name}\n**Leader:** <@${operation.leaderId}>\n**Started:** <t:${Math.floor(operation.startedAt / 1000)}:R>`
            : "There is no active operation."
        );
      }

      if (name === "training-session") {
        if (!isStaff(interaction)) {
          return replyPrivate(interaction, "Only authorised staff can announce training.");
        }

        return interaction.reply(
          response(
            "# London, Uxbridge | Training Session",
            `**Organiser:** ${user}`,
            interaction.options.getString("details")
          )
        );
      }

      if (name === "warn") {
        if (!hasPermission(interaction, P.ModerateMembers)) {
          return replyPrivate(interaction, "You need Moderate Members permission.");
        }

        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason");

        data.warnings[target.id] ??= [];
        data.warnings[target.id].push({
          guildId: guild.id,
          reason,
          moderatorId: user.id,
          timestamp: Date.now(),
        });
        saveData();

        return replyPrivate(
          interaction,
          "## Warning Recorded",
          `**Member:** ${target.tag}`,
          `**Reason:** ${reason}`,
          `**Moderator:** ${user}`
        );
      }

      if (name === "timeout") {
        if (!hasPermission(interaction, P.ModerateMembers)) {
          return replyPrivate(interaction, "You need Moderate Members permission.");
        }

        const targetUser = interaction.options.getUser("member");
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const member = await guild.members.fetch(targetUser.id);

        if (!member.moderatable) {
          return replyPrivate(interaction, "I cannot timeout that member. Check role hierarchy.");
        }

        await member.timeout(minutes * 60000, reason);

        await targetUser.send(
          response(
            "## Timeout Notice",
            `**Server:** ${guild.name}`,
            `**Duration:** ${minutes} minutes`,
            `**Reason:** ${reason}`
          )
        ).catch(() => {});

        return replyPrivate(
          interaction,
          "## Member Timed Out",
          `**Member:** ${targetUser.tag}`,
          `**Duration:** ${minutes} minutes`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "kick") {
        if (!hasPermission(interaction, P.KickMembers)) {
          return replyPrivate(interaction, "You need Kick Members permission.");
        }

        const targetUser = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const member = await guild.members.fetch(targetUser.id).catch(() => null);

        if (!member || !member.kickable) {
          return replyPrivate(interaction, "I cannot kick that member. Check role hierarchy.");
        }

        await member.kick(reason);

        return replyPrivate(
          interaction,
          "## Member Kicked",
          `**Member:** ${targetUser.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "ban") {
        if (!hasPermission(interaction, P.BanMembers)) {
          return replyPrivate(interaction, "You need Ban Members permission.");
        }

        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const member = await guild.members.fetch(target.id).catch(() => null);

        if (member && !member.bannable) {
          return replyPrivate(interaction, "I cannot ban that member. Check role hierarchy.");
        }

        await guild.members.ban(target.id, { reason });

        return replyPrivate(
          interaction,
          "## Member Banned",
          `**Member:** ${target.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "unban") {
        if (!hasPermission(interaction, P.BanMembers)) {
          return replyPrivate(interaction, "You need Ban Members permission.");
        }

        const id = interaction.options.getString("user_id").trim();
        const reason = interaction.options.getString("reason") || `Unbanned by ${user.tag}`;

        if (!/^\d{17,20}$/.test(id)) {
          return replyPrivate(interaction, "That is not a valid-looking Discord user ID.");
        }

        await guild.members.unban(id, reason);

        return replyPrivate(
          interaction,
          "## Member Unbanned",
          `**User ID:** ${id}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "purge") {
        if (!hasPermission(interaction, P.ManageMessages)) {
          return replyPrivate(interaction, "You need Manage Messages permission.");
        }

        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.bulkDelete) {
          return replyPrivate(interaction, "This channel does not support bulk deletion.");
        }

        const deleted = await interaction.channel.bulkDelete(amount, true);

        return replyPrivate(
          interaction,
          "## Messages Deleted",
          `Deleted ${deleted.size} messages.`,
          "Discord cannot bulk-delete messages older than 14 days."
        );
      }

      if (name === "modlogs") {
        if (!hasPermission(interaction, P.ModerateMembers)) {
          return replyPrivate(interaction, "You need Moderate Members permission.");
        }

        const target = interaction.options.getUser("member");
        const records = warningRecords(guild.id, target.id);

        if (!records.length) {
          return replyPrivate(interaction, "No warnings are recorded for that member.");
        }

        return replyPrivate(
          interaction,
          "## Moderation Records",
          `**Member:** ${target.tag}`,
          `**Warnings:** ${records.length}`,
          records.slice(-10).map((r, i) =>
            `**${i + 1}.** ${r.reason}\nModerator: <@${r.moderatorId}> · <t:${Math.floor(r.timestamp / 1000)}:R>`
          ).join("\n\n")
        );
      }

      if (name === "clearwarns") {
        if (!hasPermission(interaction, P.ModerateMembers)) {
          return replyPrivate(interaction, "You need Moderate Members permission.");
        }

        const target = interaction.options.getUser("member");
        const records = data.warnings[target.id] || [];
        const removed = records.filter((r) => r.guildId === guild.id).length;

        data.warnings[target.id] = records.filter((r) => r.guildId !== guild.id);
        saveData();

        return replyPrivate(
          interaction,
          "## Warnings Cleared",
          `Removed ${removed} warning records for ${target.tag}.`
        );
      }

      if (name === "slowmode") {
        if (!hasPermission(interaction, P.ManageChannels)) {
          return replyPrivate(interaction, "You need Manage Channels permission.");
        }

        const seconds = interaction.options.getInteger("seconds");

        await interaction.channel.setRateLimitPerUser(seconds);

        return replyPrivate(
          interaction,
          "## Slowmode Updated",
          seconds === 0 ? "Slowmode disabled." : `Slowmode set to ${seconds} seconds.`
        );
      }

      if (name === "lock" || name === "unlock") {
        if (!hasPermission(interaction, P.ManageChannels)) {
          return replyPrivate(interaction, "You need Manage Channels permission.");
        }

        const locked = name === "lock";

        await interaction.channel.permissionOverwrites.edit(
          guild.roles.everyone,
          {
            SendMessages: locked ? false : null,
            AddReactions: locked ? false : null,
          }
        );

        return interaction.reply(
          response(
            locked ? "## Channel Locked" : "## Channel Unlocked",
            locked
              ? "Members cannot send messages in this channel."
              : "Normal channel permissions have been restored."
          )
        );
      }

      if (name === "announce") {
        if (!hasPermission(interaction, P.ManageGuild)) {
          return replyPrivate(interaction, "You need Manage Server permission.");
        }

        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");

        await channel.send(
          response(
            "# London, Uxbridge | Announcement",
            message,
            `**Published by:** ${user}`
          )
        );

        return replyPrivate(interaction, `Announcement posted in <#${channel.id}>.`);
      }
    }

    // --------------------------------------------------
    // INFORMATION MENU
    // --------------------------------------------------

    if (interaction.isStringSelectMenu() && interaction.customId === "community_info") {
      const sections = {
        about: [
          "## About London, Uxbridge",
          "London, Uxbridge is a fictional British Roblox roleplay community focused on organised, enjoyable roleplay.",
          "We encourage teamwork, respectful behaviour and fair play.",
        ],
        rules: [
          "## Community Rules",
          "1. Respect all members.",
          "2. No harassment, hate speech or bullying.",
          "3. Do not spam or disrupt channels.",
          "4. Follow legitimate staff instructions.",
          "5. Do not share private or personal information.",
          "6. Use the correct channels.",
          "7. Do not impersonate staff.",
          "8. Report concerns through support tickets.",
        ],
        roleplay: [
          "## Roleplay Rules",
          "1. Keep scenarios fair and enjoyable.",
          "2. Do not exploit or cheat.",
          "3. Follow authorised session hosts.",
          "4. Do not deliberately ruin other people's roleplay.",
          "5. Keep scenarios appropriate.",
          "6. Accept moderation and raise disputes respectfully.",
        ],
        departments: [
          "## Departments",
          "The community may include civilian, emergency services, public services, military and staff roleplay.",
          "Availability and recruitment requirements can change. Check official announcements for current opportunities.",
        ],
        support: [
          "## Support",
          "For assistance, use the appropriate ticket panel.",
          "Provide accurate information and relevant evidence.",
          `**Support server:** ${SUPPORT_URL}`,
          "Never share your password or verification codes.",
        ],
        disclaimer: [
          "## Community Disclaimer",
          "London, Uxbridge is an independent fictional Roblox roleplay community.",
          "It is not an official representative of any real-world public authority or emergency service.",
          "Roleplay scenarios are fictional and do not represent real-world operations.",
        ],
      };

      const selected = sections[interaction.values[0]];

      if (!selected) {
        return replyPrivate(interaction, "Please select a valid section.");
      }

      return replyPrivate(interaction, ...selected);
    }

    // --------------------------------------------------
    // TICKET SETUP MENUS
    // --------------------------------------------------

    if (interaction.isStringSelectMenu() && interaction.customId === "setup_ticket_type") {
      if (!isAdmin(interaction)) {
        return replyPrivate(interaction, "Administrator permission is required.");
      }

      const session = setupSessions.get(`${guild.id}:${user.id}`);

      if (!session) {
        return replyPrivate(interaction, "Setup expired. Run `/ticket` again.");
      }

      session.type = interaction.values[0];

      return replyPrivate(
        interaction,
        `Ticket type selected: **${TICKET_TYPES[session.type].label}**.`
      );
    }

    if (interaction.isChannelSelectMenu()) {
      if (!isAdmin(interaction)) {
        return replyPrivate(interaction, "Administrator permission is required.");
      }

      const session = setupSessions.get(`${guild.id}:${user.id}`);

      if (!session) {
        return replyPrivate(interaction, "Setup expired. Run `/ticket` again.");
      }

      const fieldMap = {
        setup_panel_channel: "panelChannelId",
        setup_category: "categoryId",
        setup_logs: "logsChannelId",
      };

      const field = fieldMap[interaction.customId];

      if (field) {
        session[field] = interaction.values[0];

        return replyPrivate(
          interaction,
          `Selected channel: <#${interaction.values[0]}>`
        );
      }
    }

    if (interaction.isButton() && interaction.customId === "setup_cancel") {
      setupSessions.delete(`${guild.id}:${user.id}`);

      return replyPrivate(interaction, "Ticket setup cancelled.");
    }

    if (interaction.isButton() && interaction.customId === "setup_publish") {
      if (!isAdmin(interaction)) {
        return replyPrivate(interaction, "Administrator permission is required.");
      }

      const key = `${guild.id}:${user.id}`;
      const session = setupSessions.get(key);

      if (
        !session ||
        !session.type ||
        !session.panelChannelId ||
        !session.categoryId ||
        !session.logsChannelId
      ) {
        return replyPrivate(
          interaction,
          "Setup is incomplete. Select the type, panel channel, category and logs channel."
        );
      }

      const panelChannel = await guild.channels.fetch(session.panelChannelId).catch(() => null);
      const category = await guild.channels.fetch(session.categoryId).catch(() => null);
      const logsChannel = await guild.channels.fetch(session.logsChannelId).catch(() => null);

      if (
        !panelChannel ||
        panelChannel.type !== ChannelType.GuildText ||
        !category ||
        category.type !== ChannelType.GuildCategory ||
        !logsChannel ||
        logsChannel.type !== ChannelType.GuildText
      ) {
        return replyPrivate(interaction, "One of the selected channels is invalid.");
      }

      const type = TICKET_TYPES[session.type];
      const panelButton = button(
        `ticket_open_${session.type}`,
        type.label,
        ButtonStyle.Primary
      );

      const panel = makePanel(
        `# ${type.label}`,
        "London, Uxbridge Support",
        type.description,
        "Click below to create a private ticket with the support team.",
        "Please provide accurate information and do not open duplicate tickets."
      );

      panel.addActionRowComponents(
        new ActionRowBuilder().addComponents(panelButton)
      );

      await panelChannel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [panel],
      });

      data.ticketConfigs[guild.id] ??= {};
      data.ticketConfigs[guild.id][session.type] = {
        categoryId: category.id,
        logsChannelId: logsChannel.id,
      };

      saveData();
      setupSessions.delete(key);

      return replyPrivate(
        interaction,
        "## Ticket Setup Complete",
        `**Panel:** <#${panelChannel.id}>`,
        `**Category:** <#${category.id}>`,
        `**Logs:** <#${logsChannel.id}>`
      );
    }

    // --------------------------------------------------
    // OPEN TICKETS
    // --------------------------------------------------

    if (interaction.isButton() && interaction.customId.startsWith("ticket_open_")) {
      const typeKey = interaction.customId.replace("ticket_open_", "");
      const type = TICKET_TYPES[typeKey];
      const config = data.ticketConfigs[guild.id]?.[typeKey];

      if (!type || !config) {
        return replyPrivate(interaction, "This ticket panel is not configured.");
      }

      if (
        data.blacklistedUsers[guild.id]?.[user.id] ||
        interaction.member.roles.cache.has(TICKET_BLACKLIST_ROLE_ID)
      ) {
        return replyPrivate(interaction, "You cannot open tickets in this server.");
      }

      const existing = Object.values(data.tickets).find(
        (ticket) =>
          ticket.guildId === guild.id &&
          ticket.userId === user.id &&
          !ticket.closed
      );

      if (existing) {
        const existingChannel = await guild.channels.fetch(existing.channelId).catch(() => null);

        if (existingChannel) {
          return replyPrivate(interaction, `You already have an open ticket: <#${existingChannel.id}>`);
        }

        delete data.tickets[existing.channelId];
      }

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });

      const category = await guild.channels.fetch(config.categoryId).catch(() => null);

      if (!category) {
        return interaction.editReply(
          privateResponse(interaction, "The ticket category no longer exists.")
        );
      }

      const number = data.nextTicketNumber++;
      const channelName = `${type.slug}-${slugify(user.username)}`.slice(0, 95);

      const overwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [P.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            P.ViewChannel,
            P.SendMessages,
            P.ReadMessageHistory,
            P.AttachFiles,
            P.EmbedLinks,
          ],
        },
        {
          id: client.user.id,
          allow: [
            P.ViewChannel,
            P.SendMessages,
            P.ReadMessageHistory,
            P.ManageChannels,
            P.ManageMessages,
          ],
        },
      ];

      for (const roleId of [SUPPORT_ROLE_ID, ESCALATION_ROLE_ID]) {
        if (guild.roles.cache.has(roleId)) {
          overwrites.push({
            id: roleId,
            allow: [
              P.ViewChannel,
              P.SendMessages,
              P.ReadMessageHistory,
            ],
          });
        }
      }

      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: `Ticket #${number} | ${type.label} | Owner ${user.tag}`,
        permissionOverwrites: overwrites,
      });

      const ticket = {
        channelId: channel.id,
        guildId: guild.id,
        userId: user.id,
        number,
        type: typeKey,
        createdAt: Date.now(),
        closed: false,
        claimedBy: null,
      };

      data.tickets[channel.id] = ticket;
      saveData();

      const controls = new ActionRowBuilder().addComponents(
        button("ticket_claim", "Claim", ButtonStyle.Primary),
        button("ticket_close", "Close", ButtonStyle.Danger),
        button("ticket_staff", "Staff Tools")
      );

      const panel = makePanel(
        `# ${type.label}`,
        `Welcome, ${user.username}.`,
        `**Ticket number:** #${number}`,
        type.description,
        "Please explain your issue clearly and include any relevant evidence.",
        "Do not share passwords or verification codes."
      );

      panel.addActionRowComponents(controls);

      await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [panel],
        allowedMentions: { users: [user.id] },
      });

      const logChannel = await guild.channels.fetch(config.logsChannelId).catch(() => null);

      if (logChannel) {
        await logChannel.send(
          response(
            "## Ticket Opened",
            `**Ticket:** #${number}`,
            `**Owner:** <@${user.id}>`,
            `**Type:** ${type.label}`,
            `**Channel:** <#${channel.id}>`
          )
        );
      }

      return interaction.editReply(
        privateResponse(
          "## Ticket Created",
          `Your ticket is ready: <#${channel.id}>`
        )
      );
    }

    // --------------------------------------------------
    // TICKET STAFF BUTTONS
    // --------------------------------------------------

    if (
      interaction.isButton() &&
      ["ticket_claim", "ticket_close", "ticket_staff", "ticket_unclaim", "ticket_escalate"].includes(interaction.customId)
    ) {
      const ticket = ticketFor(interaction.channelId);

      if (!ticket || ticket.guildId !== guild.id) {
        return replyPrivate(interaction, "This is not a registered ticket channel.");
      }

      if (!isStaff(interaction)) {
        return replyPrivate(interaction, "Only authorised support staff can use these controls.");
      }

      if (interaction.customId === "ticket_claim") {
        if (ticket.closed) {
          return replyPrivate(interaction, "This ticket is closed.");
        }

        if (ticket.claimedBy) {
          return replyPrivate(interaction, `Already claimed by <@${ticket.claimedBy}>.`);
        }

        ticket.claimedBy = user.id;
        saveData();

        await interaction.channel.send(
          response("## Ticket Claimed", `Claimed by ${user}.`)
        );

        return replyPrivate(interaction, "You claimed this ticket.");
      }

      if (interaction.customId === "ticket_close") {
        if (ticket.closed) {
          return replyPrivate(interaction, "This ticket is already closed.");
        }

        ticket.closed = true;
        ticket.closedBy = user.id;
        ticket.closedAt = Date.now();
        saveData();

        await interaction.channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false,
          ViewChannel: true,
        });

        await interaction.channel.setName(
          `closed-${ticket.type}-${ticket.number}`.slice(0, 95)
        );

        await interaction.channel.send(
          response(
            "## Ticket Closed",
            `Closed by ${user}.`,
            "The ticket owner can no longer send messages."
          )
        );

        const config = data.ticketConfigs[guild.id]?.[ticket.type];
        const logChannel = config
          ? await guild.channels.fetch(config.logsChannelId).catch(() => null)
          : null;

        if (logChannel) {
          await logChannel.send(
            response(
              "## Ticket Closed",
              `**Ticket:** #${ticket.number}`,
              `**Owner:** <@${ticket.userId}>`,
              `**Closed by:** ${user}`,
              `**Channel:** <#${ticket.channelId}>`
            )
          );
        }

        return replyPrivate(interaction, "Ticket closed.");
      }

      if (interaction.customId === "ticket_staff") {
        const row = new ActionRowBuilder().addComponents(
          button("ticket_unclaim", "Unclaim"),
          button("ticket_escalate", "Escalate", ButtonStyle.Primary)
        );

        const panel = makePanel(
          "## Ticket Staff Tools",
          "Choose a staff action below."
        );

        panel.addActionRowComponents(row);

        return interaction.reply({
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
          components: [panel],
        });
      }

      if (interaction.customId === "ticket_unclaim") {
        ticket.claimedBy = null;
        saveData();

        return replyPrivate(interaction, "Ticket unclaimed.");
      }

      if (interaction.customId === "ticket_escalate") {
        if (ticket.closed) {
          return replyPrivate(interaction, "A closed ticket cannot be escalated.");
        }

        const role = guild.roles.cache.get(ESCALATION_ROLE_ID);

        if (!role) {
          return replyPrivate(interaction, "The escalation role was not found.");
        }

        await interaction.channel.permissionOverwrites.edit(role.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });

        await interaction.channel.send(
          response("## Ticket Escalated", `Escalated by ${user}.`)
        );

        return replyPrivate(interaction, "Ticket escalated.");
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      const message = "Something went wrong. Check the hosting console and bot permissions.";

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: message,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  }
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

client.login(TOKEN).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
