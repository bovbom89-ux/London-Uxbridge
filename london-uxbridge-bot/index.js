
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits: P, MessageFlags, ChannelType, ContainerBuilder,
  TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
if (!TOKEN || !CLIENT_ID) throw new Error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID.");

const SUPPORT_ROLE_ID = "1558934432675790888";
const ESCALATION_ROLE_ID = "1558933872824287313";
const TICKET_BLACKLIST_ROLE_ID = "1559232249122136136";
const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error("Could not load saved data:", error.message);
    return {};
  }
}

const data = {
  tickets: {},
  shifts: {},
  operations: {},
  ticketConfigs: {},
  blacklistedUsers: {},
  nextTicketNumber: 1,
  ...loadData(),
};

for (const key of ["tickets", "shifts", "operations", "ticketConfigs", "blacklistedUsers"]) {
  data[key] ??= {};
}
data.nextTicketNumber ??= 1;
delete data.warnings;

function saveData() {
  const tempFile = `${DATA_FILE}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempFile, DATA_FILE);
  } catch (error) {
    console.error("Could not save bot data:", error.message);
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
    throw error;
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const setupSessions = new Map();

const TICKET_TYPES = {
  report: {
    label: "Report a User",
    slug: "report-a-user",
    button: "Report a User",
    description: "Report a member, behaviour or incident to the London, Uxbridge moderation team.",
    intro: "Use this ticket to report a user or incident. Describe what happened clearly and include dates, channel names and relevant evidence.",
    guidance: "Include the username or user ID, what happened, when and where it happened, and any screenshots or links that help staff review the report. Do not edit or fabricate evidence.",
  },
  appeal: {
    label: "Appeals",
    slug: "appeal",
    button: "Submit an Appeal",
    description: "Request a fair review of a moderation action or community decision.",
    intro: "Use this ticket to appeal a warning, timeout, kick, ban or another moderation decision. Staff will review the available information and your explanation.",
    guidance: "State the action you are appealing, when it happened, who issued it if known, and why you believe it should be reconsidered. Be honest and respectful.",
  },
  staff: {
    label: "Staff Report",
    slug: "staff-report",
    button: "Report a Staff Member",
    description: "Raise a concern about a staff member privately and respectfully.",
    intro: "Use this ticket to raise a concern about staff conduct. Reports should be based on what you personally observed.",
    guidance: "Name the staff member, describe the incident and when it happened, and attach relevant evidence. Do not use this option for unrelated disagreements.",
  },
  enquiries: {
    label: "Enquiries",
    slug: "enquiries",
    button: "Open an Enquiry",
    description: "Ask a question or request help with the London, Uxbridge community.",
    intro: "Use this ticket for general questions about the community, roleplay, joining, departments or how things work.",
    guidance: "Explain your question clearly and include any context staff need to help you. Check the information panel first where appropriate.",
  },
};

function container(...lines) {
  const result = new ContainerBuilder();
  lines.filter(x => x !== null && x !== undefined && String(x).length).forEach((line, i) => {
    if (i) result.addSeparatorComponents(new SeparatorBuilder());
    result.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(line)));
  });
  return result;
}

function v2(...lines) {
  return { flags: MessageFlags.IsComponentsV2, components: [container(...lines)] };
}

function v2WithRows(lines, rows = [], ephemeral = false) {
  const panel = container(...lines);
  for (const row of rows) panel.addActionRowComponents(row);
  return {
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    components: [panel],
  };
}

function privateV2(...lines) {
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    components: [container(...lines)],
  };
}

async function privateReply(i, ...lines) {
  const payload = privateV2(...lines);
  return i.replied || i.deferred ? i.followUp(payload) : i.reply(payload);
}

function isAdmin(i) {
  return Boolean(i.memberPermissions?.has(P.Administrator));
}

function hasSupportRole(i) {
  const roles = i.member?.roles?.cache;
  return Boolean(roles?.has(SUPPORT_ROLE_ID) || roles?.has(ESCALATION_ROLE_ID));
}

function isStaff(i) {
  return isAdmin(i) || hasSupportRole(i);
}

function hasPermission(i, permission) {
  return Boolean(i.memberPermissions?.has(permission) || isAdmin(i));
}

function makeButton(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function slugify(value) {
  return String(value || "member")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "member";
}

function getTicket(id) {
  return data.tickets[id];
}

function getConfig(id) {
  return data.ticketConfigs[id];
}

function isTicketBlacklisted(guildId, userId) {
  return Boolean(data.blacklistedUsers[guildId]?.[userId]);
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Post the London, Uxbridge community information panel.")
    .setDefaultMemberPermissions(P.Administrator),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Configure and publish private support ticket panels.")
    .setDefaultMemberPermissions(P.Administrator),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the available bot commands."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a server member.")
    .addUserOption(o => o.setName("member").setDescription("Member to inspect.").setRequired(false)),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Start your one-hour staff shift.")
    .addSubcommand(s => s.setName("start").setDescription("Start your staff shift.")),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Start a military operation.")
    .addSubcommand(s =>
      s.setName("start")
        .setDescription("Start an operation.")
        .addStringOption(o => o.setName("name").setDescription("Operation name.").setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Publish a training session announcement.")
    .addStringOption(o =>
      o.setName("details").setDescription("Date, time, department and other training details.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a member warning without storing warning history.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(o => o.setName("member").setDescription("Member to warn.").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the warning.").setRequired(true)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Temporarily prevent a member from interacting.")
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(o => o.setName("member").setDescription("Member to timeout.").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes.").setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the timeout.").setRequired(false)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Remove a member from the server.")
    .setDefaultMemberPermissions(P.KickMembers)
    .addUserOption(o => o.setName("member").setDescription("Member to kick.").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the kick.").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member from the server.")
    .setDefaultMemberPermissions(P.BanMembers)
    .addUserOption(o => o.setName("member").setDescription("Member to ban.").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the ban.").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remove a user's server ban by user ID.")
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption(o => o.setName("user_id").setDescription("The user's Discord ID.").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason for the unban.").setRequired(false)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages in this channel.")
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption(o => o.setName("amount").setDescription("Number of messages (1–100).").setMinValue(1).setMaxValue(100).setRequired(true)),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set the slowmode delay in this channel.")
    .setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption(o => o.setName("seconds").setDescription("Delay in seconds (0 disables slowmode).").setMinValue(0).setMaxValue(21600).setRequired(true)),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Prevent @everyone from sending messages in this channel.")
    .setDefaultMemberPermissions(P.ManageChannels),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Allow @everyone to send messages in this channel again.")
    .setDefaultMemberPermissions(P.ManageChannels),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Post an announcement in a selected channel.")
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption(o => o.setName("channel").setDescription("Announcement channel.").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Announcement text.").setRequired(true)),
].map(c => c.toJSON());

client.once("ready", async () => {
  console.log(`London, Uxbridge online as ${client.user.tag}`);
  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`${commands.length} global slash commands registered.`);
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) return privateReply(interaction, "Please use this command inside a server.");

      const guild = interaction.guild;
      const user = interaction.user;
      const name = interaction.commandName;

      if (name === "ping") {
        return privateReply(interaction, "## Pong!", "London, Uxbridge is online and responding.");
      }

      if (name === "help") {
        return privateReply(
          interaction,
          "## London, Uxbridge | Command Centre",
          "**Community:** `/information`, `/help`, `/ping`, `/userinfo`",
          "**Tickets:** `/ticket` — administrator setup",
          "**Staff:** `/staff-shift start`, `/training-session`, `/military-operation start`",
          "**Moderation:** `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/purge`, `/slowmode`, `/lock`, `/unlock`, `/announce`",
          `**Support server:** ${SUPPORT_URL}`
        );
      }

      if (name === "information") {
        if (!isAdmin(interaction)) {
          return privateReply(interaction, "Only administrators can post the information panel.");
        }

        const menu = new StringSelectMenuBuilder()
          .setCustomId("community_information")
          .setPlaceholder("Explore London, Uxbridge")
          .addOptions(
            { label: "About the Community", value: "information", description: "Our community, roleplay and aims" },
            { label: "Community Standards", value: "server_rules", description: "How we expect members to behave" },
            { label: "Roleplay Rules", value: "game_rules", description: "Keeping roleplay fair and immersive" },
            { label: "Departments & Opportunities", value: "departments", description: "Departments, applications and training" },
            { label: "Support & Getting Started", value: "getting_started", description: "Where to ask for help and how to begin" },
            { label: "Community Disclaimer", value: "disclaimer", description: "Important information about fictional roleplay" }
          );

        await interaction.channel.send(
          v2WithRows([
            "# Community Information",
            "Welcome to **London, Uxbridge**, a British Roblox roleplay community based in West London.",
            "Our aim is to provide realistic, enjoyable and organised roleplay for civilians, emergency services, public services and military personnel.",
            "Select an option from the menu below to learn more about our community."
          ], [new ActionRowBuilder().addComponents(menu)])
        );

        return privateReply(interaction, "The community information panel has been posted.");
      }

      if (name === "ticket") {
        if (!isAdmin(interaction)) {
          return privateReply(interaction, "Only server administrators can configure ticket panels.");
        }

        const key = `${guild.id}:${user.id}`;
        setupSessions.set(key, {
          guildId: guild.id,
          userId: user.id,
          type: null,
          panelChannelId: null,
          categoryId: null,
          createdAt: Date.now()
        });

        const typeMenu = new StringSelectMenuBuilder()
          .setCustomId("ticket_setup_type")
          .setPlaceholder("1. Choose a ticket panel type")
          .addOptions(...Object.entries(TICKET_TYPES).map(([value, type]) => ({
            label: type.label,
            value,
            description: type.description.slice(0, 100)
          })));

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

        return interaction.reply(v2WithRows([
          "## London, Uxbridge | Ticket Setup",
          "Configure one ticket panel at a time. Nothing is published until you press **Confirm Setup**.",
          "**1 — Panel type:** Choose Report a User, Appeals, Staff Report or Enquiries.",
          "**2 — Panel channel:** The public channel where members will see the panel.",
          "**3 — Ticket category:** The category where private ticket channels will be created.",
          "**4 — Confirm:** Check your selections, then publish the panel. The bot needs View Channel, Send Messages and Manage Channels permissions."
        ], [
          new ActionRowBuilder().addComponents(typeMenu),
          new ActionRowBuilder().addComponents(panelMenu),
          new ActionRowBuilder().addComponents(categoryMenu),
          new ActionRowBuilder().addComponents(
            makeButton("ticket_setup_confirm", "Confirm Setup", ButtonStyle.Success),
            makeButton("ticket_setup_cancel", "Cancel", ButtonStyle.Danger)
          )
        ], true));
      }

      if (name === "userinfo") {
        const target = interaction.options.getUser("member") || user;
        const member = await guild.members.fetch(target.id).catch(() => null);

        return privateReply(
          interaction,
          "## Member Information",
          `**Username:** ${target.tag || target.username}`,
          `**User ID:** ${target.id}`,
          `**Account created:** <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
          `**Joined server:** ${member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : "Unknown"}`,
          "**Member status:** Information only; moderation details are not stored by this bot."
        );
      }

      if (name === "staff-shift") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "You do not have permission to manage staff shifts.");
        }

        const shift = data.shifts[guild.id];

        if (shift) {
          return privateReply(
            interaction,
            shift.userId === user.id ? "You already have an active shift." : `A staff shift is already active for <@${shift.userId}>.`
          );
        }

        data.shifts[guild.id] = {
          userId: user.id,
          startedAt: Date.now(),
          channelId: interaction.channelId
        };
        saveData();

        return privateReply(
          interaction,
          "## Staff Shift Started",
          `**Staff member:** ${user}`,
          `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`,
          "Your shift will automatically end after one hour. The timer runs silently in the background."
        );
      }

      if (name === "military-operation") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "You do not have permission to start operations.");
        }

        if (data.operations[guild.id]) {
          return privateReply(interaction, "A military operation is already active.");
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
          "## Military Operation Started",
          `**Operation:** ${operationName}`,
          `**Leader:** ${user}`,
          `**Started:** <t:${Math.floor(Date.now() / 1000)}:F>`,
          "The operation will automatically expire after one hour."
        );
      }

      if (name === "training-session") {
        if (!isStaff(interaction)) {
          return privateReply(interaction, "You do not have permission to announce training.");
        }

        const details = interaction.options.getString("details");

        await interaction.channel.send({
          ...v2(
            "## London, Uxbridge | Training Session",
            `**Organiser:** ${user}`,
            `**Details:** ${details}`,
            "Please follow the organiser's instructions and arrive prepared."
          ),
          allowedMentions: { parse: [] }
        });

        return privateReply(interaction, "The training announcement has been posted.");
      }

      if (name === "warn") {
        if (!hasPermission(interaction, P.ModerateMembers)) {
          return privateReply(interaction, "You need the **Moderate Members** permission to warn users.");
        }

        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason");

        if (target.id === user.id) return privateReply(interaction, "You cannot warn yourself.");

        const member = await guild.members.fetch(target.id).catch(() => null);
        const moderator = await guild.members.fetch(user.id);

        if (member && member.roles.highest.position >= moderator.roles.highest.position && !isAdmin(interaction)) {
          return privateReply(interaction, "You cannot warn a member with an equal or higher role than yours.");
        }

        await target.send(privateV2(
          "## Warning Received",
          `**Server:** ${guild.name}`,
          `**Moderator:** ${user.tag}`,
          `**Reason:** ${reason}`,
          "Please review the server rules and contact staff through the support system if you have questions."
        )).catch(() => {});

        return privateReply(
          interaction,
          "## Warning Issued",
          `**Member:** ${target}`,
          `**Reason:** ${reason}`,
          "No warning history is stored by this bot."
        );
      }

      if (name === "timeout") {
        if (!hasPermission(interaction, P.ModerateMembers)) {
          return privateReply(interaction, "You need the **Moderate Members** permission to timeout users.");
        }

        const target = await guild.members.fetch(interaction.options.getUser("member").id).catch(() => null);
        const minutes = interaction.options.getInteger("minutes");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!target) return privateReply(interaction, "That member is not in this server.");

        const moderator = await guild.members.fetch(user.id);
        if (!target.moderatable || (target.roles.highest.position >= moderator.roles.highest.position && !isAdmin(interaction))) {
          return privateReply(interaction, "I cannot timeout that member. Check role hierarchy and permissions.");
        }

        await target.timeout(minutes * 60000, reason);
        await target.send(privateV2(
          "## Timeout Notice",
          `**Server:** ${guild.name}`,
          `**Duration:** ${minutes} minutes`,
          `**Reason:** ${reason}`
        )).catch(() => {});

        return privateReply(
          interaction,
          "## Member Timed Out",
          `**Member:** ${target.user.tag}`,
          `**Duration:** ${minutes} minutes`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "kick") {
        if (!hasPermission(interaction, P.KickMembers)) {
          return privateReply(interaction, "You need the **Kick Members** permission to kick users.");
        }

        const target = await guild.members.fetch(interaction.options.getUser("member").id).catch(() => null);
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!target) return privateReply(interaction, "That member is not in this server.");

        const moderator = await guild.members.fetch(user.id);
        if (!target.kickable || (target.roles.highest.position >= moderator.roles.highest.position && !isAdmin(interaction))) {
          return privateReply(interaction, "I cannot kick that member. Check role hierarchy and permissions.");
        }

        await target.send(privateV2(
          "## Kick Notice",
          `**Server:** ${guild.name}`,
          `**Reason:** ${reason}`
        )).catch(() => {});

        await target.kick(reason);

        return privateReply(
          interaction,
          "## Member Kicked",
          `**Member:** ${target.user.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "ban") {
        if (!hasPermission(interaction, P.BanMembers)) {
          return privateReply(interaction, "You need the **Ban Members** permission to ban users.");
        }

        const target = interaction.options.getUser("member");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const member = await guild.members.fetch(target.id).catch(() => null);

        if (member) {
          const moderator = await guild.members.fetch(user.id);
          if (!member.bannable || (member.roles.highest.position >= moderator.roles.highest.position && !isAdmin(interaction))) {
            return privateReply(interaction, "I cannot ban that member. Check role hierarchy and permissions.");
          }
        }

        await target.send(privateV2(
          "## Ban Notice",
          `**Server:** ${guild.name}`,
          `**Reason:** ${reason}`
        )).catch(() => {});

        await guild.members.ban(target.id, { reason });

        return privateReply(
          interaction,
          "## Member Banned",
          `**Member:** ${target.tag}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "unban") {
        if (!hasPermission(interaction, P.BanMembers)) {
          return privateReply(interaction, "You need the **Ban Members** permission to unban users.");
        }

        const id = interaction.options.getString("user_id").trim();
        const reason = interaction.options.getString("reason") || `Unbanned by ${user.tag}`;

        if (!/^\d{17,20}$/.test(id)) {
          return privateReply(interaction, "That does not look like a valid Discord user ID.");
        }

        await guild.members.unban(id, reason);

        return privateReply(
          interaction,
          "## Member Unbanned",
          `**User ID:** ${id}`,
          `**Reason:** ${reason}`
        );
      }

      if (name === "purge") {
        if (!hasPermission(interaction, P.ManageMessages)) {
          return privateReply(interaction, "You need the **Manage Messages** permission to purge messages.");
        }

        const amount = interaction.options.getInteger("amount");
        if (!interaction.channel?.bulkDelete) return privateReply(interaction, "This command cannot be used in this channel.");

        const messages = await interaction.channel.bulkDelete(amount, true);

        return privateReply(
          interaction,
          "## Messages Deleted",
          `Deleted **${messages.size}** messages. Discord cannot bulk-delete messages older than 14 days.`
        );
      }

      if (name === "slowmode") {
        if (!hasPermission(interaction, P.ManageChannels)) {
          return privateReply(interaction, "You need the **Manage Channels** permission to change slowmode.");
        }

        const seconds = interaction.options.getInteger("seconds");
        if (!interaction.channel?.setRateLimitPerUser) return privateReply(interaction, "Slowmode cannot be changed in this channel.");

        await interaction.channel.setRateLimitPerUser(seconds, `Changed by ${user.tag}`);

        return privateReply(
          interaction,
          "## Slowmode Updated",
          seconds === 0 ? "Slowmode has been disabled." : `Members must wait **${seconds} second(s)** between messages.`
        );
      }

      if (name === "lock" || name === "unlock") {
        if (!hasPermission(interaction, P.ManageChannels)) {
          return privateReply(interaction, "You need the **Manage Channels** permission to lock or unlock channels.");
        }

        const channel = interaction.channel;
        if (!channel?.permissionOverwrites) return privateReply(interaction, "This channel cannot be locked or unlocked.");

        const locked = name === "lock";

        await channel.permissionOverwrites.edit(
          guild.roles.everyone,
          {
            SendMessages: locked ? false : null,
            AddReactions: locked ? false : null
          },
          { reason: `${locked ? "Locked" : "Unlocked"} by ${user.tag}` }
        );

        await channel.send(v2(
          locked ? "## Channel Locked" : "## Channel Unlocked",
          locked
            ? `This channel has been locked by ${user}. Members cannot send messages until it is unlocked.`
            : `This channel has been unlocked by ${user}. Normal channel permissions now apply.`
        ));

        return privateReply(interaction, `This channel has been ${locked ? "locked" : "unlocked"}.`);
      }

      if (name === "announce") {
        if (!hasPermission(interaction, P.ManageGuild)) {
          return privateReply(interaction, "You need the **Manage Server** permission to post announcements.");
        }

        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");
        const me = await guild.members.fetchMe();

        if (!channel.permissionsFor(me)?.has([P.ViewChannel, P.SendMessages])) {
          return privateReply(interaction, "I cannot post in that channel. Give me View Channel and Send Messages permissions.");
        }

        await channel.send({
          ...v2("## London, Uxbridge | Community Announcement", message, `**Posted by:** ${user}`),
          allowedMentions: { parse: [] }
        });

        return privateReply(interaction, `The announcement has been posted in <#${channel.id}>.`);
      }
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "community_information") {
      const sections = {
        information: [
          "## About London, Uxbridge",
          "London, Uxbridge is a British Roblox roleplay community based in West London. Our aim is to provide realistic, organised and enjoyable roleplay for civilians, emergency services, public services and military personnel.",
          "The community brings members together through everyday civilian roleplay, structured public-service scenarios, training, hosted events and fictional operations. We value teamwork, fairness, professionalism, creativity and respectful communication.",
          "Members are encouraged to learn the rules, participate constructively, help new arrivals and raise concerns through the appropriate channels. Staff help organise the community, support members and apply the rules consistently.",
          "**What you can expect:**\n• Organised roleplay sessions and community activities.\n• Opportunities to learn and develop roleplay skills.\n• Clear standards for conduct and fair participation.\n• Support routes for questions, reports and appeals.",
          "All scenarios are fictional and take place for entertainment. A role or rank in this community does not grant real-world authority or qualifications."
        ],
        server_rules: [
          "## Community Standards & Moderation Policy",
          "These standards apply across text channels, voice channels, tickets, events and community-related activities. Members are responsible for reading and following them.",
          "**1. Respect others.** Harassment, bullying, threats, hate speech and discrimination are not permitted.\n**2. Keep content appropriate.** Do not post explicit, graphic, hateful or otherwise unsuitable content.\n**3. No spam or disruption.** Do not flood chats, repeatedly ping members, advertise without permission or deliberately disrupt channels.\n**4. Follow legitimate staff instructions.** If you disagree with a decision, remain calm and use the appropriate appeal or support route.\n**5. Protect privacy.** Do not publish personal information, private messages or confidential staff discussions without permission.\n**6. Use channels correctly.** Keep messages relevant and follow channel descriptions and pinned instructions.\n**7. No impersonation or deception.** Do not pretend to be staff, fabricate evidence or misrepresent announcements, permissions or decisions.\n**8. No exploits or malicious activity.** Cheating, malicious links, scams and attempts to compromise or disrupt the server are prohibited.\n**9. Keep disagreements civil.** Do not organise pile-ons, encourage harassment or target members over personal disputes.\n**10. Report concerns properly.** Use the relevant ticket type and provide clear, honest information instead of arguing publicly.",
          "**Moderation policy:** Staff may issue warnings, timeouts, kicks, bans or other restrictions depending on the seriousness of an incident, its context, evidence and any repeated behaviour. Serious breaches may require immediate action. Moderation decisions should be handled respectfully and can be raised through the appeal route where available. Do not retaliate against someone for making a good-faith report."
        ],
        game_rules: [
          "## Roblox Roleplay Rules",
          "Roleplay should be immersive, fair and enjoyable. Give other participants a reasonable chance to respond and contribute to a scenario.",
          "**1. Stay in character when required.** Use designated out-of-character channels or the host's procedure when necessary.\n**2. Do not disrupt scenarios.** Avoid trolling, random violence, deliberate derailment or behaviour intended to ruin another member's experience.\n**3. No exploiting or cheating.** Do not abuse glitches, external tools or game mechanics to gain an unfair advantage.\n**4. Follow session leadership.** Listen to authorised hosts and follow reasonable scenario instructions.\n**5. Respect department procedures.** Follow applicable training, uniform, equipment and conduct requirements for your role.\n**6. Do not fake authority.** Never claim a real-world position or a community role you have not been awarded.\n**7. Keep roleplay appropriate.** Sexual, graphic or otherwise unsuitable scenarios are not allowed.\n**8. Do not force outcomes.** Do not dictate another person's actions or make yourself invulnerable without an agreed mechanic.\n**9. Be honest with evidence.** Do not fabricate or edit evidence to mislead staff.\n**10. Raise disputes properly.** Avoid derailing live sessions; report concerns through support when practical.",
          "Hosts may pause, adjust or end a scenario when necessary to keep it fair, organised and appropriate. Follow game-specific instructions and platform rules as well."
        ],
        departments: [
          "## Departments & Opportunities",
          "The community may feature fictional roleplay inspired by British public services and defence. Department availability, ranks, entry requirements and recruitment dates depend on current community arrangements; not every department is necessarily open for recruitment.",
          "**Metropolitan Police Service (MET):** Fictional policing scenarios may include patrols, traffic incidents, community safety and coordinated responses. Members should follow community training and roleplay procedures and must not represent themselves as real police officers.",
          "**London Fire Brigade (LFB):** Fire and rescue roleplay may involve incident response, fire safety scenarios and cooperation with other fictional services. Follow the host's instructions and relevant in-game procedures.",
          "**London Ambulance Service (LAS):** Medical roleplay may include patient care, ambulance responses and coordination with other departments. All medical scenarios are fictional and do not provide real medical training or qualifications.",
          "**British Transport Police (BTP):** Transport-related policing scenarios may include railway or station safety and fictional incidents within transport settings. Follow the community's rules and any session-specific boundaries.",
          "**British Army:** Military roleplay may include fictional training, teamwork exercises and organised operations. Ranks, commands and activities are for roleplay only and do not represent the actual British Army.",
          "**Civilian roleplay and community staff:** Civilian participation helps create everyday stories and scenarios. Staff opportunities may include member support, moderation and event organisation when recruitment is open.",
          "For current vacancies, application instructions and training dates, check official announcements or ask through the appropriate ticket route. Never pay for a role, claim an appointment you have not received or misrepresent your experience."
        ],
        getting_started: [
          "## Support & Getting Started",
          "**If you are new:** Read the community standards and roleplay rules, review channel descriptions, and check announcements for current events and instructions.",
          "**If you want to join a department:** Check whether recruitment is open, read the requirements, submit the requested application and attend training if required. Be honest in applications and treat recruiters respectfully.",
          "**If you need help:** Use the ticket panel and choose the closest matching option:\n• **Report a User** — report behaviour or an incident.\n• **Appeals** — ask for a review of a moderation action.\n• **Staff Report** — raise a concern about staff conduct.\n• **Enquiries** — ask general questions about the community.",
          "**Make your ticket useful:** Explain what happened, when it happened, who was involved and what assistance you need. Include relevant screenshots or links where appropriate, but do not alter evidence or share unnecessary personal information. Avoid opening duplicate tickets for the same issue.",
          `**Support server:** ${SUPPORT_URL}`,
          "Never share your password, login codes or recovery details. Staff do not need your account password to help you. Response times may vary depending on staff availability."
        ],
        disclaimer: [
          "## Community Disclaimer",
          "London, Uxbridge is an independent fictional Roblox roleplay community. It is not affiliated with, endorsed by, or operated by the Metropolitan Police Service, London Fire Brigade, London Ambulance Service, British Transport Police, British Army, the UK Government, the London Borough of Hillingdon or any other real-world public authority.",
          "Department names and concepts may be used as inspiration for fictional roleplay. Characters, ranks, uniforms, incidents, operations and procedures within the community do not confer real-world authority, employment, qualifications or permission to act on behalf of any real organisation.",
          "Roblox and Discord are separate platforms with their own terms, policies and safety requirements. Members must comply with those requirements as well as these community rules. Roblox, Discord and third-party organisation names and marks belong to their respective owners.",
          "The community may update its rules, departments, procedures and activities as it develops. Official status or partnership should not be assumed unless confirmed by the relevant organisation through an authentic, verifiable announcement.",
          "This server is not an emergency service. For a real emergency, contact the appropriate real-world emergency service rather than using roleplay channels or tickets."
        ]
      };

      const selected = sections[interaction.values[0]];
      if (!selected) {
        return privateReply(interaction, "That information section could not be found. Please select an option from the menu again.");
      }

      return privateReply(interaction, ...selected);
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "ticket_setup_type") {
      if (!isAdmin(interaction)) return privateReply(interaction, "Only administrators can configure ticket panels.");

      const session = setupSessions.get(`${interaction.guildId}:${interaction.user.id}`);
      if (!session) return privateReply(interaction, "Your setup session expired. Run `/ticket` again.");

      session.type = interaction.values[0];
      return privateReply(interaction, `Selected panel type: **${TICKET_TYPES[session.type].label}**. Continue by selecting the panel channel and ticket category.`);
    }

    if (interaction.isChannelSelectMenu() && ["ticket_setup_panel_channel", "ticket_setup_category"].includes(interaction.customId)) {
      if (!isAdmin(interaction)) return privateReply(interaction, "Only administrators can configure ticket panels.");

      const session = setupSessions.get(`${interaction.guildId}:${interaction.user.id}`);
      if (!session) return privateReply(interaction, "Your setup session expired. Run `/ticket` again.");

      if (interaction.customId === "ticket_setup_panel_channel") session.panelChannelId = interaction.values[0];
      if (interaction.customId === "ticket_setup_category") session.categoryId = interaction.values[0];

      const labels = {
        ticket_setup_panel_channel: "Panel channel",
        ticket_setup_category: "Ticket category"
      };

      return privateReply(interaction, `**${labels[interaction.customId]} selected:** <#${interaction.values[0]}>`);
    }

    if (interaction.isButton() && ["ticket_setup_confirm", "ticket_setup_cancel"].includes(interaction.customId)) {
      if (!isAdmin(interaction)) return privateReply(interaction, "Only administrators can configure ticket panels.");

      const key = `${interaction.guildId}:${interaction.user.id}`;
      const session = setupSessions.get(key);

      if (!session) return privateReply(interaction, "Your setup session expired. Run `/ticket` again.");

      if (interaction.customId === "ticket_setup_cancel") {
        setupSessions.delete(key);
        return privateReply(interaction, "Ticket setup cancelled. No panel was published.");
      }

      if (!session.type || !session.panelChannelId || !session.categoryId) {
        return privateReply(interaction, "Setup is incomplete. Choose the panel type, panel channel and ticket category before confirming.");
      }

      const guild = interaction.guild;
      const panelChannel = await guild.channels.fetch(session.panelChannelId).catch(() => null);
      const category = await guild.channels.fetch(session.categoryId).catch(() => null);

      if (!panelChannel || panelChannel.type !== ChannelType.GuildText || !category || category.type !== ChannelType.GuildCategory) {
        return privateReply(interaction, "A selected channel is unavailable. Run `/ticket` again and choose valid channels.");
      }

      const me = await guild.members.fetchMe();
      const perms = panelChannel.permissionsFor(me);

      if (!perms?.has([P.ViewChannel, P.SendMessages])) {
        return privateReply(interaction, "I cannot post in that panel channel. Give me View Channel and Send Messages permissions.");
      }

      const type = TICKET_TYPES[session.type];

      try {
        await panelChannel.send(v2WithRows([
          `# ${type.label}`,
          "**LONDON, UXBRIDGE | ONLY SUPPORT SERVER**",
          "This panel is for support requests relating to the London, Uxbridge community only. Please choose the ticket type that best matches your issue.",
          type.description,
          "### Before opening a ticket",
          type.guidance,
          "### What happens next?",
          "A private channel will be created for you and the authorised support team. Please keep the discussion relevant, provide accurate information and allow staff time to respond.",
          "Do not open duplicate tickets for the same issue, use tickets to spam staff, or share passwords and verification codes. Reports and appeals should be handled respectfully and with appropriate evidence.",
          "Select the button below when you are ready to open your ticket."
        ], [
          new ActionRowBuilder().addComponents(
            makeButton(`ticket_open_${session.type}`, type.button, ButtonStyle.Primary)
          )
        ]));
      } catch (error) {
        console.error("Could not post ticket panel:", error);
        return privateReply(interaction, "I could not post the panel. Check my permissions in the selected channel and the hosting console.");
      }

      data.ticketConfigs[guild.id] ??= {};
      data.ticketConfigs[guild.id][session.type] = {
        panelChannelId: session.panelChannelId,
        categoryId: session.categoryId
      };
      saveData();
      setupSessions.delete(key);

      return privateReply(
        interaction,
        "## Ticket Setup Complete",
        `**Panel:** ${type.label}`,
        `**Panel channel:** <#${panelChannel.id}>`,
        `**Ticket category:** <#${category.id}>`,
        "No ticket logs are created or sent.",
        "Your panel has been published. Run `/ticket` again to configure another ticket type."
      );
    }

    if (interaction.isButton() && interaction.customId.startsWith("ticket_open_")) {
      const guild = interaction.guild;
      const user = interaction.user;
      const typeKey = interaction.customId.replace("ticket_open_", "");
      const type = TICKET_TYPES[typeKey];
      const config = getConfig(guild.id)?.[typeKey];
      const openerMember = await guild.members.fetch(user.id).catch(() => null);

      if (isTicketBlacklisted(guild.id, user.id) || openerMember?.roles.cache.has(TICKET_BLACKLIST_ROLE_ID)) {
        return privateReply(interaction, "You cannot open tickets in this server because your account is ticket-blacklisted. If you believe this is a mistake, contact the server administration team.");
      }

      if (!type || !config) {
        return privateReply(interaction, "This ticket panel is not configured correctly. Ask an administrator to run `/ticket` again.");
      }

      const existing = Object.values(data.tickets).find(t => t.guildId === guild.id && t.userId === user.id && !t.closed);

      if (existing) {
        const existingChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
        if (existingChannel) return privateReply(interaction, `You already have an open ticket: <#${existingChannel.id}>`);
        delete data.tickets[existing.channelId];
        saveData();
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });

      const category = await guild.channels.fetch(config.categoryId).catch(() => null);
      if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.editReply(privateV2("The configured ticket category no longer exists. Ask an administrator to run `/ticket` again."));
      }

      const ticketNumber = data.nextTicketNumber++;
      const baseName = `${type.slug}-${slugify(user.username)}`.slice(0, 90);
      let ticketName = baseName;
      let suffix = 2;

      while (guild.channels.cache.some(c => c.parentId === category.id && c.name === ticketName)) {
        ticketName = `${baseName.slice(0, 85)}-${suffix++}`;
      }

      const overwrites = [
        { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
        { id: user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks] },
        { id: client.user.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels, P.ManageMessages] }
      ];

      const supportRole = guild.roles.cache.get(SUPPORT_ROLE_ID);
      const escalationRole = guild.roles.cache.get(ESCALATION_ROLE_ID);

      if (supportRole) {
        overwrites.push({
          id: supportRole.id,
          allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles]
        });
      }

      if (escalationRole) {
        overwrites.push({
          id: escalationRole.id,
          allow: [P.ViewChannel, P.ReadMessageHistory],
          deny: [P.SendMessages]
        });
      }

      let channel;

      try {
        channel = await guild.channels.create({
          name: ticketName,
          type: ChannelType.GuildText,
          parent: category.id,
          topic: `Ticket #${ticketNumber} | ${type.label} | Opened by ${user.tag}`,
          permissionOverwrites: overwrites
        });
      } catch (error) {
        console.error("Ticket channel creation failed:", error);
        return interaction.editReply(privateV2("I couldn't create the private ticket. Check my Manage Channels permission and the category permissions."));
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
        lastAction: "Ticket opened"
      };

      data.tickets[channel.id] = ticket;
      saveData();

      const controls = new ActionRowBuilder().addComponents(
        makeButton("ticket_claim", "Claim Ticket", ButtonStyle.Primary),
        makeButton("ticket_close", "Close Ticket", ButtonStyle.Danger),
        makeButton("ticket_modpanel", "Staff Tools", ButtonStyle.Secondary)
      );

      await channel.send({
        ...v2WithRows([
          `# ${type.label}`,
          `## Welcome, ${user.username}`,
          "Your private London, Uxbridge support ticket is now open. An authorised member of the support team will assist when available.",
          `**Ticket number:** #${ticketNumber}`,
          "**Support route:** London, Uxbridge community only",
          "### What happens next?",
          type.intro,
          "### Information to include",
          type.guidance,
          "Keep discussion and evidence in this channel. Please be patient, do not open duplicate tickets and never share passwords or verification codes.",
          `**Ticket owner:** <@${user.id}>`
        ], [controls]),
        allowedMentions: { users: [user.id] }
      });

      if (supportRole) {
        await channel.send({
          ...v2(`Support team notification: <@&${supportRole.id}>`),
          allowedMentions: { roles: [supportRole.id] }
        }).catch(console.error);
      }

      return interaction.editReply(privateV2(
        `Your **${type.label}** ticket has been created.`,
        `Continue here: <#${channel.id}>.`
      ));
    }

    if (interaction.isButton() && [
      "ticket_claim", "ticket_close", "ticket_close_confirm", "ticket_close_cancel",
      "ticket_modpanel", "ticket_rename", "ticket_unclaim", "ticket_escalate",
      "ticket_blacklist"
    ].includes(interaction.customId)) {
      const ticket = getTicket(interaction.channelId);

      if (!ticket || ticket.guildId !== interaction.guildId) {
        return privateReply(interaction, "This ticket could not be found.");
      }

      if (!isStaff(interaction)) {
        return privateReply(interaction, "Only authorised support staff can use these controls.");
      }

      if (interaction.customId === "ticket_claim") {
        if (ticket.closed) return privateReply(interaction, "This ticket is closed.");
        if (ticket.claimedBy) return privateReply(interaction, `This ticket is already claimed by <@${ticket.claimedBy}>.`);

        ticket.claimedBy = interaction.user.id;
        ticket.updatedAt = Date.now();
        saveData();

        await interaction.channel.send(v2("## Ticket Claimed", `This ticket has been claimed by ${interaction.user}.`));
        return privateReply(interaction, "You have claimed this ticket.");
      }

      if (interaction.customId === "ticket_close") {
        if (ticket.closed) return privateReply(interaction, "This ticket is already being closed.");

        const confirmRow = new ActionRowBuilder().addComponents(
          makeButton("ticket_close_confirm", "Yes, Delete Ticket", ButtonStyle.Danger),
          makeButton("ticket_close_cancel", "Cancel", ButtonStyle.Secondary)
        );

        return interaction.reply(v2WithRows([
          "## Delete This Ticket?",
          "This permanently deletes the ticket channel and its messages. This action cannot be undone.",
          "Are you sure you want to continue?"
        ], [confirmRow], true));
      }

      if (interaction.customId === "ticket_close_cancel") {
        return privateReply(interaction, "Ticket deletion cancelled. The ticket remains open.");
      }

      if (interaction.customId === "ticket_close_confirm") {
        await interaction.reply(privateV2("Deleting this ticket channel now…"));
        delete data.tickets[interaction.channelId];
        saveData();
        await interaction.channel.delete(`Ticket #${ticket.ticketNumber} deleted by ${interaction.user.tag}`);
        return;
      }

      if (interaction.customId === "ticket_modpanel") {
        const controls = new ActionRowBuilder().addComponents(
          makeButton("ticket_rename", "Rename Ticket"),
          makeButton("ticket_unclaim", "Unclaim"),
          makeButton("ticket_escalate", "Escalate", ButtonStyle.Primary),
          makeButton("ticket_blacklist", "Blacklist Ticket Owner", ButtonStyle.Danger)
        );

        return interaction.reply(v2WithRows([
          "## Ticket Staff Tools",
          "Choose an action. These controls are only available to authorised support staff.",
          "**Rename:** Give the ticket a clearer channel name.\n**Unclaim:** Make the ticket available for another staff member.\n**Escalate:** Give the escalation team access.\n**Blacklist:** Prevent the ticket owner from opening future tickets and try to assign the blacklist role."
        ], [controls], true));
      }

      if (interaction.customId === "ticket_rename") {
        const modal = new ModalBuilder()
          .setCustomId("ticket_rename_modal")
          .setTitle("Rename Ticket")
          .addComponents(new ActionRowBuilder().addComponents(
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
        if (ticket.closed) return privateReply(interaction, "This ticket is closed.");

        ticket.claimedBy = null;
        ticket.updatedAt = Date.now();
        saveData();

        return privateReply(interaction, "The ticket has been unclaimed.");
      }

      if (interaction.customId === "ticket_blacklist") {
        const guild = interaction.guild;
        const ownerId = ticket.userId;

        data.blacklistedUsers[guild.id] ??= {};
        data.blacklistedUsers[guild.id][ownerId] = {
          moderatorId: interaction.user.id,
          timestamp: Date.now(),
          ticketChannelId: ticket.channelId
        };
        saveData();

        const blacklistRole = guild.roles.cache.get(TICKET_BLACKLIST_ROLE_ID);
        const ownerMember = await guild.members.fetch(ownerId).catch(() => null);

        if (blacklistRole && ownerMember) {
          try {
            const me = await guild.members.fetchMe();

            if (!me.permissions.has(P.ManageRoles) || blacklistRole.position >= me.roles.highest.position) {
              return privateReply(interaction, "The owner is now blacklisted in saved data, so they cannot open future tickets. I could not assign the blacklist role: give me Manage Roles and move my bot role above the blacklist role.");
            }

            await ownerMember.roles.add(blacklistRole, `Ticket-blacklisted by ${interaction.user.tag}`);
          } catch (error) {
            console.error("Could not assign ticket blacklist role:", error);
            return privateReply(interaction, "The owner is now blacklisted in saved data and cannot open future tickets, but I could not assign the blacklist role. Check the bot's Manage Roles permission and role hierarchy.");
          }
        }

        return privateReply(
          interaction,
          `The ticket owner <@${ownerId}> has been blacklisted from opening future tickets.`,
          blacklistRole
            ? "The blacklist role has been assigned if the member was available."
            : "The configured blacklist role was not found, but the saved blacklist is active."
        );
      }

      if (interaction.customId === "ticket_escalate") {
        if (ticket.closed) return privateReply(interaction, "This ticket is closed. Reopen it before escalating.");

        const role = interaction.guild.roles.cache.get(ESCALATION_ROLE_ID);
        if (!role) return privateReply(interaction, "The escalation role was not found. Check the role ID in index.js.");

        await interaction.channel.permissionOverwrites.edit(role.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });

        ticket.escalated = true;
        ticket.updatedAt = Date.now();
        saveData();

        await interaction.channel.send(v2(
          "## Ticket Escalated",
          `This ticket has been escalated by ${interaction.user}.`
        ));

        await interaction.channel.send({
          ...v2(`Escalation team notified: <@&${role.id}>`),
          allowedMentions: { roles: [role.id] }
        }).catch(console.error);

        return privateReply(interaction, "The ticket has been escalated.");
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === "ticket_rename_modal") {
      const ticket = getTicket(interaction.channelId);
      if (!ticket || !isStaff(interaction)) return privateReply(interaction, "You cannot rename this ticket.");

      const newName = slugify(interaction.fields.getTextInputValue("new_name")).slice(0, 90);
      if (!newName) return privateReply(interaction, "Please enter a valid channel name.");

      await interaction.channel.setName(newName);
      return privateReply(interaction, `Ticket renamed to **${newName}**.`);
    }
  } catch (error) {
    console.error("Interaction error:", error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(privateV2("Something went wrong while processing that action. Please check the hosting console for details."));
      } else {
        await interaction.reply(privateV2("Something went wrong while processing that action. Please check the hosting console for details."));
      }
    } catch (replyError) {
      console.error("Could not send error response:", replyError);
    }
  }
});

// The countdown is internal. The shift-end announcement is visible after one hour.
setInterval(async () => {
  const now = Date.now();
  let changed = false;

  for (const [guildId, shift] of Object.entries(data.shifts)) {
    if (!shift || now - shift.startedAt < 60 * 60 * 1000) continue;

    delete data.shifts[guildId];
    changed = true;

    try {
      if (shift.channelId) {
        const channel = await client.channels.fetch(shift.channelId).catch(() => null);

        if (channel?.isTextBased() && channel.send) {
          await channel.send({
            ...v2(
              "## Staff Shift Ended Automatically",
              `**Staff member:** <@${shift.userId}>`,
              "The one-hour staff shift has now ended."
            ),
            allowedMentions: { users: [shift.userId] }
          });
        }
      }
    } catch (error) {
      console.error("Could not announce automatic staff shift end:", error);
    }
  }

  for (const [guildId, operation] of Object.entries(data.operations)) {
    if (operation && now - operation.startedAt >= 60 * 60 * 1000) {
      delete data.operations[guildId];
      changed = true;
    }
  }

  if (changed) saveData();
}, 15 * 1000);

client.login(TOKEN);
