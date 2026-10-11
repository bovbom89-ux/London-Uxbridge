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
  MessageFlags,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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
  throw new Error(
    "Missing DISCORD_TOKEN or DISCORD_CLIENT_ID."
  );
}

const SUPPORT_ROLE_ID = "1558934432675790888";
const ESCALATION_ROLE_ID = "1558933872824287313";
const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Could not read bot-data.json:", error);
  }

  return {
    tickets: {},
    warnings: {},
    shifts: {},
    operations: {},
    ticketConfigs: {},
    nextTicketNumber: 1,
  };
}

const data = loadData();

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

// ==================================================
// COMPONENTS V2 HELPERS
// ==================================================

function panel(...lines) {
  const container = new ContainerBuilder();

  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      container.addSeparatorComponents(
        new SeparatorBuilder()
      );
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines[i])
    );
  }

  return container;
}

function v2(...lines) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel(...lines)],
  };
}

function privateV2(...lines) {
  return {
    flags:
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral,
    components: [panel(...lines)],
  };
}

async function replyV2(interaction, ...lines) {
  const payload = interaction.replied || interaction.deferred
    ? { ...v2(...lines), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }
    : privateV2(...lines);

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

function hasStaffRole(member) {
  return Boolean(
    member?.roles?.cache?.has(SUPPORT_ROLE_ID) ||
    member?.roles?.cache?.has(ESCALATION_ROLE_ID)
  );
}

function isStaff(interaction) {
  return (
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) ||
    hasStaffRole(interaction.member)
  );
}

function canManageTickets(interaction) {
  return isStaff(interaction);
}

function getTicket(channelId) {
  return data.tickets[channelId];
}

function getTicketConfig(guildId) {
  return data.ticketConfigs[guildId];
}

async function sendLog(guild, message) {
  const ticket = message.channel
    ? getTicket(message.channel.id)
    : null;

  const config = ticket
    ? getTicketConfig(ticket.guildId)
    : null;

  if (!config?.logsChannelId) return;

  const logChannel = guild.channels.cache.get(
    config.logsChannelId
  );

  if (!logChannel?.isTextBased()) return;

  await logChannel.send(
    v2("## London, Uxbridge | Ticket Log", message.text)
  ).catch(console.error);
}

function makeButton(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
}

function makeModal(customId, title, fieldId, label, placeholder) {
  const input = new TextInputBuilder()
    .setCustomId(fieldId)
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  if (placeholder) input.setPlaceholder(placeholder);

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(input)
    );
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
    .setDescription("Configure and post the ticket panel. (ONLY SUPPORT)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option
        .setName("panel_channel")
        .setDescription("Channel where the ticket panel will appear.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("ticket_category")
        .setDescription("Category for private ticket channels.")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("logs_channel")
        .setDescription("Channel where ticket logs will be sent.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the bot command list."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member.")
    .addUserOption(option =>
      option
        .setName("member")
        .setDescription("Member to inspect.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Manage staff shifts.")
    .addSubcommand(sub =>
      sub.setName("start").setDescription("Start your staff shift.")
    )
    .addSubcommand(sub =>
      sub.setName("end").setDescription("End your staff shift.")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage military operations.")
    .addSubcommand(sub =>
      sub.setName("start")
        .setDescription("Start an operation.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("Operation name.")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("end").setDescription("End the current operation.")
    )
    .addSubcommand(sub =>
      sub.setName("status").setDescription("View operation status.")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption(option =>
      option.setName("details")
        .setDescription("Training details.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to warn.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the warning.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to timeout.")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("minutes")
        .setDescription("Timeout duration in minutes.")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the timeout.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to kick.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the kick.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to ban.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason")
        .setDescription("Reason for the ban.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option.setName("amount")
        .setDescription("Number of messages to delete.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View a member's warning records.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("member")
        .setDescription("Member to inspect.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Announcement channel.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("message")
        .setDescription("Announcement text.")
        .setRequired(true)
    ),
].map(command => command.toJSON());

// ==================================================
// REGISTER GLOBAL COMMANDS
// ==================================================

client.once("ready", async () => {
  console.log(`London, Uxbridge bot online as ${client.user.tag}.`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    console.log("Registering global slash commands...");

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log(`${commands.length} global slash commands registered.`);
  } catch (error) {
    console.error("Global command registration failed:", error);
  }
});

// ==================================================
// AUTOMATIC SESSION ENDING
// ==================================================

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

// ==================================================
// INTERACTION HANDLER
// ==================================================

client.on("interactionCreate", async interaction => {
  try {
    // ----------------------------------------------
    // SLASH COMMANDS
    // ----------------------------------------------

    if (interaction.isChatInputCommand()) {
      const { commandName, guild, member, user } = interaction;

      if (!guild) {
        return replyV2(interaction, "This command must be used in a server.");
      }

      if (commandName === "ping") {
        return replyV2(interaction, "The bot is online and responding.");
      }

      if (commandName === "help") {
        return replyV2(
          interaction,
          "## London, Uxbridge Bot Commands",
          "**Information**\n/information — Post the community information panel.",
          "**Tickets**\n/ticket — Configure the ticket panel.",
          "**Staff**\n/staff-shift start\n/staff-shift end\n/training-session",
          "**Operations**\n/military-operation start\n/military-operation end\n/military-operation status",
          "**Moderation**\n/warn\n/timeout\n/kick\n/ban\n/purge\n/modlogs",
          "**Other**\n/ping\n/userinfo\n/announce"
        );
      }

      if (commandName === "information") {
        if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
          return replyV2(interaction, "Only administrators can post the information panel.");
        }

        const dropdown = new StringSelectMenuBuilder()
          .setCustomId("community_information")
          .setPlaceholder("Choose a community information section")
          .addOptions(
            {
              label: "Information",
              value: "information",
              description: "About the London, Uxbridge community",
            },
            {
              label: "Server Rules",
              value: "server_rules",
              description: "Read the community server rules",
            },
            {
              label: "Game Rules",
              value: "game_rules",
              description: "Read the roleplay game rules",
            },
            {
              label: "Departments",
              value: "departments",
              description: "Learn about community departments",
            },
            {
              label: "Disclaimer",
              value: "disclaimer",
              description: "Read the community disclaimer",
            }
          );

        await interaction.channel.send({
          ...v2(
            "## London, Uxbridge",
            "Welcome to London, Uxbridge, a British Roblox roleplay community based in West London. Our aim is to provide realistic, enjoyable and organised roleplay for civilians, emergency services, public services and the wider community.",
            "Use the dropdown menu below to view community information and rules."
          ),
          components: [
            panel(
              "## Community Information",
              "Select a section from the dropdown menu to read more."
            ),
            new ActionRowBuilder().addComponents(dropdown),
          ],
        });

        return replyV2(interaction, "The community information panel has been posted.");
      }

      if (commandName === "ticket") {
        if (!isStaff(interaction)) {
          return replyV2(interaction, "Only authorised support staff can configure the ticket system.");
        }

        const panelChannel = interaction.options.getChannel("panel_channel");
        const category = interaction.options.getChannel("ticket_category");
        const logsChannel = interaction.options.getChannel("logs_channel");

        data.ticketConfigs[guild.id] = {
          panelChannelId: panelChannel.id,
          categoryId: category.id,
          logsChannelId: logsChannel.id,
        };

        saveData();

        const menu = new StringSelectMenuBuilder()
          .setCustomId("open_ticket")
          .setPlaceholder("Choose a support option")
          .addOptions(
            {
              label: "Report a User",
              value: "user_report",
              description: "Report a member or incident",
            },
            {
              label: "Appeals",
              value: "appeal",
              description: "Submit an appeal",
            },
            {
              label: "Staff Report",
              value: "staff_report",
              description: "Report a staff member",
            },
            {
              label: "Enquiries",
              value: "enquiry",
              description: "Ask the support team a question",
            }
          );

        await panelChannel.send({
          ...v2(
            "## London, Uxbridge Support",
            "Need assistance? Select the appropriate option below to open a private support ticket.",
            "Please provide accurate information and explain your issue clearly. Unnecessary or abusive tickets may be closed."
          ),
          components: [
            panel(
              "## Open a Ticket",
              "Select the type of support you require."
            ),
            new ActionRowBuilder().addComponents(menu),
          ],
        });

        return replyV2(interaction, "The ticket panel has been configured and posted.");
      }

      if (commandName === "userinfo") {
        const target = interaction.options.getUser("member") || user;
        const targetMember = await guild.members.fetch(target.id).catch(() => null);

        return replyV2(
          interaction,
          "## Member Information",
          `**Username:** ${target.username}`,
          `**User ID:** ${target.id}`,
          `**Account Created:** <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
          `**Joined Server:** ${targetMember?.joinedTimestamp ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:F>` : "Unavailable"}`
        );
      }

      if (commandName === "staff-shift") {
        if (!isStaff(interaction)) {
          return replyV2(interaction, "You do not have permission to use staff shift commands.");
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "start") {
          if (data.shifts[guild.id]?.userId === user.id) {
            return replyV2(interaction, "You already have an active staff shift.");
          }

          data.shifts[guild.id] = {
            userId: user.id,
            startedAt: Date.now(),
          };

          saveData();

          return replyV2(
            interaction,
            "## Staff Shift Started",
            `**Staff member:** ${user}`,
            `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`
          );
        }

        if (subcommand === "end") {
          const shift = data.shifts[guild.id];

          if (!shift || shift.userId !== user.id) {
            return replyV2(interaction, "You do not have an active staff shift.");
          }

          const duration = Math.floor((Date.now() - shift.startedAt) / 1000);
          delete data.shifts[guild.id];
          saveData();

          return replyV2(
            interaction,
            "## Staff Shift Ended",
            `**Staff member:** ${user}`,
            `**Duration:** ${Math.floor(duration / 60)} minutes`
          );
        }
      }

      if (commandName === "military-operation") {
        if (!isStaff(interaction)) {
          return replyV2(interaction, "You do not have permission to manage operations.");
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "start") {
          if (data.operations[guild.id]) {
            return replyV2(interaction, "An operation is already active.");
          }

          const name = interaction.options.getString("name");

          data.operations[guild.id] = {
            name,
            startedAt: Date.now(),
            startedBy: user.id,
          };

          saveData();

          return replyV2(
            interaction,
            "## Military Operation Started",
            `**Operation:** ${name}`,
            `**Started by:** ${user}`,
            `**Time:** <t:${Math.floor(Date.now() / 1000)}:F>`
          );
        }

        if (subcommand === "end") {
          const operation = data.operations[guild.id];

          if (!operation) {
            return replyV2(interaction, "There is no active operation.");
          }

          delete data.operations[guild.id];
          saveData();

          return replyV2(
            interaction,
            "## Military Operation Ended",
            `**Operation:** ${operation.name}`,
            `**Ended by:** ${user}`
          );
        }

        if (subcommand === "status") {
          const operation = data.operations[guild.id];

          if (!operation) {
            return replyV2(interaction, "There is no active military operation.");
          }

          return replyV2(
            interaction,
            "## Military Operation Status",
            `**Operation:** ${operation.name}`,
            `**Started by:** <@${operation.startedBy}>`,
            `**Started:** <t:${Math.floor(operation.startedAt / 1000)}:R>`
          );
        }
      }

      if (commandName === "training-session") {
        if (!isStaff(interaction)) {
          return replyV2(interaction, "You do not have permission to announce a training session.");
        }

        const details = interaction.options.getString("details");

        await interaction.channel.send(
          v2(
            "## Training Session",
            `**Organiser:** ${user}`,
            `**Details:** ${details}`,
            "Please follow instructions from the session organiser."
          )
        );

        return replyV2(interaction, "The training session announcement has been posted.");
      }

      if (commandName === "warn") {
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

        return replyV2(
          interaction,
          "## Warning Recorded",
          `**Member:** ${target}`,
          `**Reason:** ${reason}`
        );
      }

      if (commandName === "timeout") {
        const target = interaction.options.getMember("member");
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!target) {
          return replyV2(interaction, "That member could not be found.");
        }

        if (!target.moderatable) {
          return replyV2(interaction, "I cannot timeout that member. Check my permissions and role position.");
        }

        await target.timeout(minutes * 60 * 1000, reason);

        return replyV2(
          interaction,
          "## Member Timed Out",
          `**Member:** ${target.user}`,
          `**Duration:** ${minutes} minutes`,
          `**Reason:** ${reason}`
        );
      }

      if (commandName === "kick") {
        const target = interaction.options.getMember("member");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!target) {
          return replyV2(interaction, "That member could not be found.");
        }

        if (!target.kickable) {
          return replyV2(interaction, "I cannot kick that member. Check my permissions and role position.");
        }

        await target.kick(reason);

        return replyV2(
          interaction,
          "## Member Kicked",
          `**Member:** ${target.user.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (commandName === "ban") {
        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason") || "No reason provided";

        const targetMember = await guild.members.fetch(target.id).catch(() => null);

        if (targetMember && !targetMember.bannable) {
          return replyV2(interaction, "I cannot ban that member. Check my permissions and role position.");
        }

        await guild.members.ban(target.id, { reason });

        return replyV2(
          interaction,
          "## Member Banned",
          `**Member:** ${target.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (commandName === "purge") {
        const amount = interaction.options.getInteger("amount");

        if (!interaction.channel?.bulkDelete) {
          return replyV2(interaction, "This command cannot be used in this channel.");
        }

        const deleted = await interaction.channel.bulkDelete(amount, true);

        return replyV2(
          interaction,
          "## Messages Deleted",
          `Deleted **${deleted.size}** messages. Messages older than 14 days cannot be bulk deleted.`
        );
      }

      if (commandName === "modlogs") {
        const target = interaction.options.getUser("member");
        const records = (data.warnings[target.id] || [])
          .filter(record => record.guildId === guild.id);

        if (!records.length) {
          return replyV2(interaction, "## Moderation Records", `No warnings recorded for ${target}.`);
        }

        const lines = records.slice(-10).map((record, index) =>
          `**${index + 1}.** ${record.reason}\nModerator: <@${record.moderatorId}> | <t:${Math.floor(record.timestamp / 1000)}:R>`
        );

        return replyV2(
          interaction,
          "## Moderation Records",
          `**Member:** ${target}`,
          lines.join("\n\n")
        );
      }

      if (commandName === "announce") {
        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");

        await channel.send(
          v2(
            "## London, Uxbridge Announcement",
            message,
            `**Posted by:** ${user}`
          )
        );

        return replyV2(interaction, "The announcement has been posted.");
      }
    }

    // ----------------------------------------------
    // INFORMATION DROPDOWN
    // ----------------------------------------------

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "community_information") {
        const sections = {
          information: [
            "## About Us",
            "Welcome to London, Uxbridge, a British Roblox roleplay community based in West London. Our aim is to provide realistic, enjoyable and organised roleplay for civilians, emergency services, public services and the wider community.",
          ],
          server_rules: [
            "## Community Server Rules",
            "1. Treat all members respectfully.",
            "2. Do not harass, threaten or discriminate against others.",
            "3. Do not spam or disrupt community channels.",
            "4. Follow staff instructions and use the correct channels.",
            "5. Do not share private information without permission.",
            "6. Do not advertise without authorisation.",
            "7. Use support tickets for reports and appeals.",
          ],
          game_rules: [
            "## Roleplay Game Rules",
            "1. Keep roleplay realistic and appropriate.",
            "2. Do not exploit, cheat or abuse game mechanics.",
            "3. Do not randomly attack or disrupt other players.",
            "4. Follow roleplay instructions and department procedures.",
            "5. Do not impersonate staff or emergency services.",
            "6. Respect other players and their roleplay.",
          ],
          departments: [
            "## Departments",
            "London, Uxbridge supports organised roleplay across civilian and public service roles.",
            "Department availability, applications and requirements are announced by authorised community staff.",
            "Please use the appropriate support option for department enquiries.",
          ],
          disclaimer: [
            "## Disclaimer",
            "London, Uxbridge is a Roblox roleplay community. It is not an official organisation of the real London Borough of Hillingdon, the Metropolitan Police Service, the London Fire Brigade, the NHS or any other real-world public authority.",
            "All roleplay activities are fictional and intended for entertainment.",
          ],
        };

        const selected = sections[interaction.values[0]];

        if (!selected) {
          return replyV2(interaction, "That information section could not be found.");
        }

        return replyV2(interaction, ...selected);
      }

      // --------------------------------------------
      // OPEN A TICKET
      // --------------------------------------------

      if (interaction.customId === "open_ticket") {
        const guild = interaction.guild;
        const user = interaction.user;
        const config = getTicketConfig(guild.id);

        if (!config) {
          return replyV2(interaction, "The ticket system has not been configured in this server.");
        }

        const category = guild.channels.cache.get(config.categoryId);

        if (!category || category.type !== ChannelType.GuildCategory) {
          return replyV2(interaction, "The configured ticket category is missing. Ask an administrator to run `/ticket` again.");
        }

        const existing = Object.values(data.tickets).find(ticket =>
          ticket.guildId === guild.id &&
          ticket.userId === user.id &&
          !ticket.closed
        );

        if (existing) {
          const existingChannel = guild.channels.cache.get(existing.channelId);

          if (existingChannel) {
            return replyV2(interaction, `You already have an open ticket: ${existingChannel}`);
          }
        }

        const ticketType = interaction.values[0];
        const ticketNumber = data.nextTicketNumber++;

        const channel = await guild.channels.create({
          name: `ticket-${String(ticketNumber).padStart(4, "0")}`,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `Ticket ${ticketNumber} | Opened by ${user.tag} | Type: ${ticketType}`,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [
                PermissionFlagsBits.ViewChannel,
              ],
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
              id: SUPPORT_ROLE_ID,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
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
          ],
        });

        data.tickets[channel.id] = {
          channelId: channel.id,
          guildId: guild.id,
          userId: user.id,
          ticketNumber,
          type: ticketType,
          createdAt: Date.now(),
          claimedBy: null,
          closed: false,
        };

        saveData();

        const buttons = new ActionRowBuilder().addComponents(
          makeButton("ticket_claim", "Claim Ticket", ButtonStyle.Primary),
          makeButton("ticket_close", "Close Ticket", ButtonStyle.Danger),
          makeButton("ticket_modpanel", "Mod Panel", ButtonStyle.Secondary)
        );

        await channel.send({
          ...v2(
            "## London, Uxbridge Support Ticket",
            `Welcome ${user}. A support team member will assist you as soon as possible.`,
            `**Ticket number:** ${ticketNumber}`,
            `**Category:** ${ticketType.replaceAll("_", " ")}`,
            "**Please explain your issue clearly and provide any relevant evidence.**"
          ),
          content: `<@${user.id}> <@&${SUPPORT_ROLE_ID}>`,
          allowedMentions: {
            users: [user.id],
            roles: [SUPPORT_ROLE_ID],
          },
          components: [
            panel(
              "## Ticket Controls",
              "Support staff can claim the ticket, close it, or open the moderation panel."
            ),
            buttons,
          ],
        });

        return replyV2(interaction, `Your ticket has been created: ${channel}`);
      }
    }

    // ----------------------------------------------
    // TICKET BUTTONS
    // ----------------------------------------------

    if (interaction.isButton()) {
      const ticket = getTicket(interaction.channelId);

      if (
        interaction.customId.startsWith("ticket_") &&
        !ticket
      ) {
        return replyV2(interaction, "This ticket could not be found in the bot's saved data.");
      }

      if (interaction.customId === "ticket_claim") {
        if (!canManageTickets(interaction)) {
          return replyV2(interaction, "Only authorised support staff can claim tickets.");
        }

        if (ticket.closed) {
          return replyV2(interaction, "This ticket has already been closed.");
        }

        if (ticket.claimedBy) {
          return replyV2(interaction, `This ticket has already been claimed by <@${ticket.claimedBy}>.`);
        }

        ticket.claimedBy = interaction.user.id;
        saveData();

        await interaction.channel.send(
          v2("## Ticket Claimed", `This ticket has been claimed by ${interaction.user}.`)
        );

        await sendLog(interaction.guild, {
          channel: interaction.channel,
          text: `**Action:** Ticket claimed\n**Ticket:** ${interaction.channel}\n**Staff:** ${interaction.user}`,
        });

        return replyV2(interaction, "You have claimed this ticket.");
      }

      if (interaction.customId === "ticket_close") {
        if (!canManageTickets(interaction)) {
          return replyV2(interaction, "Only authorised support staff can close tickets.");
        }

        if (ticket.closed) {
          return replyV2(interaction, "This ticket is already closed.");
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
            `This ticket was closed by ${interaction.user}.`,
            "The ticket remains visible for reference. Contact support if further assistance is required."
          )
        );

        await sendLog(interaction.guild, {
          channel: interaction.channel,
          text: `**Action:** Ticket closed\n**Ticket number:** ${ticket.ticketNumber}\n**Opened by:** <@${ticket.userId}>\n**Closed by:** ${interaction.user}`,
        });

        return replyV2(interaction, "The ticket has been closed.");
      }

      if (interaction.customId === "ticket_modpanel") {
        if (!canManageTickets(interaction)) {
          return replyV2(interaction, "Only authorised support staff can use the moderation panel.");
        }

        const controls = new ActionRowBuilder().addComponents(
          makeButton("ticket_rename", "Change Name", ButtonStyle.Secondary),
          makeButton("ticket_unclaim", "Unclaim", ButtonStyle.Secondary),
          makeButton("ticket_escalate", "Escalate", ButtonStyle.Primary)
        );

        return interaction.reply({
          ...privateV2(
            "## Ticket Moderation Panel",
            "Use the controls below to manage this ticket."
          ),
          components: [
            panel(
              "## Available Actions",
              "Change Name — rename the ticket channel.",
              "Unclaim — remove the current claim.",
              "Escalate — give the escalation team access."
            ),
            controls,
          ],
        });
      }

      if (interaction.customId === "ticket_rename") {
        if (!canManageTickets(interaction)) {
          return replyV2(interaction, "Only authorised support staff can rename tickets.");
        }

        const modal = makeModal(
          "ticket_rename_modal",
          "Rename Ticket",
          "new_name",
          "New channel name",
          "ticket-name"
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "ticket_unclaim") {
        if (!canManageTickets(interaction)) {
          return replyV2(interaction, "Only authorised support staff can unclaim tickets.");
        }

        ticket.claimedBy = null;
        saveData();

        await interaction.channel.send(
          v2("## Ticket Unclaimed", `${interaction.user} removed the ticket claim.`)
        );

        await sendLog(interaction.guild, {
          channel: interaction.channel,
          text: `**Action:** Ticket unclaimed\n**Ticket:** ${interaction.channel}\n**Staff:** ${interaction.user}`,
        });

        return replyV2(interaction, "The ticket has been unclaimed.");
      }

      if (interaction.customId === "ticket_escalate") {
        if (!canManageTickets(interaction)) {
          return replyV2(interaction, "Only authorised support staff can escalate tickets.");
        }

        await interaction.channel.permissionOverwrites.edit(ESCALATION_ROLE_ID, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });

        await interaction.channel.send({
          ...v2(
            "## Ticket Escalated",
            `This ticket has been escalated by ${interaction.user}. The escalation team has been given access.`
          ),
          content: `<@&${ESCALATION_ROLE_ID}>`,
          allowedMentions: { roles: [ESCALATION_ROLE_ID] },
        });

        await sendLog(interaction.guild, {
          channel: interaction.channel,
          text: `**Action:** Ticket escalated\n**Ticket:** ${interaction.channel}\n**Staff:** ${interaction.user}`,
        });

        return replyV2(interaction, "The ticket has been escalated.");
      }
    }

    // ----------------------------------------------
    // RENAME TICKET MODAL
    // ----------------------------------------------

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "ticket_rename_modal"
    ) {
      if (!canManageTickets(interaction)) {
        return replyV2(interaction, "Only authorised support staff can rename tickets.");
      }

      const newName = interaction.fields
        .getTextInputValue("new_name")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90);

      if (!newName) {
        return replyV2(interaction, "Please provide a valid channel name.");
      }

      await interaction.channel.setName(newName);

      await sendLog(interaction.guild, {
        channel: interaction.channel,
        text: `**Action:** Ticket renamed\n**New name:** ${newName}\n**Staff:** ${interaction.user}`,
      });

      return replyV2(interaction, `Ticket renamed to **${newName}**.`);
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message = "Something went wrong while processing that action. Check the hosting logs for details.";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(privateV2(message));
      } else {
        await interaction.reply(privateV2(message));
      }
    } catch (replyError) {
      console.error("Could not send error response:", replyError);
    }
  }
});

// ==================================================
// START BOT
// ==================================================

client.login(TOKEN);
