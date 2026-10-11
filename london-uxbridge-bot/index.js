
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
const GUILD_ID =
  process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";

const SUPPORT_ROLE_ID = "1558934432675790888";
const ESCALATION_ROLE_ID = "1558933872824287313";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ==================================================
// DATA STORAGE
// ==================================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

const data = loadData();

data.warnings ||= {};
data.activeEvents ||= {};
data.ticketConfigs ||= {};
data.tickets ||= {};

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ==================================================
// COMPONENTS V2 HELPERS
// ==================================================

function makeText(content) {
  return new TextDisplayBuilder().setContent(content);
}

function makePanel(title, content, rows = []) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      makeText(`# ${title}`)
    )
    .addSeparatorComponents(
      new SeparatorBuilder()
    )
    .addTextDisplayComponents(
      makeText(content)
    );

  if (rows.length) {
    container.addActionRowComponents(...rows);
  }

  return container;
}

function v2Flags(ephemeral = false) {
  return (
    MessageFlags.IsComponentsV2 |
    (ephemeral ? MessageFlags.Ephemeral : 0)
  );
}

async function replyPanel(
  interaction,
  title,
  content,
  rows = [],
  ephemeral = false
) {
  return interaction.reply({
    components: [makePanel(title, content, rows)],
    flags: v2Flags(ephemeral),
  });
}

async function privatePanel(
  interaction,
  title,
  content,
  rows = []
) {
  return interaction.reply({
    components: [makePanel(title, content, rows)],
    flags: v2Flags(true),
  });
}

// ==================================================
// INFORMATION MENU
// ==================================================

function informationMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("uxbridge_information_menu")
      .setPlaceholder("Choose an information section...")
      .addOptions(
        {
          label: "Information",
          description: "About London, Uxbridge.",
          value: "information",
        },
        {
          label: "Server Rules",
          description: "Read the community rules.",
          value: "server_rules",
        },
        {
          label: "Game Rules",
          description: "Read the Roblox roleplay rules.",
          value: "game_rules",
        },
        {
          label: "Departments",
          description: "View our departments.",
          value: "departments",
        },
        {
          label: "Disclaimer",
          description: "Read the community disclaimer.",
          value: "disclaimer",
        }
      )
  );
}

const informationPages = {
  information: {
    title: "Community Information",
    content:
      "Welcome to **London, Uxbridge**, a British Roblox roleplay community based in West London.\n\n" +
      "Our aim is to provide realistic, enjoyable and organised roleplay for civilians, emergency services, public services and military personnel.\n\n" +
      "Use the dropdown below to explore our rules, departments and disclaimer.",
  },

  server_rules: {
    title: "Community Rules",
    content:
      "**1. Respect Everyone**\nHarassment, bullying and discrimination are prohibited.\n\n" +
      "**2. Follow Staff Instructions**\nTreat staff respectfully and follow reasonable instructions.\n\n" +
      "**3. No RDM or VDM**\nDo not attack players or use vehicles to harm them without a valid roleplay reason.\n\n" +
      "**4. No Fail Roleplay**\nKeep actions realistic and respect roleplay scenarios.\n\n" +
      "**5. No Metagaming or Powergaming**\nDo not misuse out-of-character information or force actions on others.\n\n" +
      "**6. No Exploiting**\nCheating, hacking and exploiting glitches are prohibited.\n\n" +
      "**7. No Abuse of Authority**\nDepartment members must act within their roleplay powers.\n\n" +
      "**8. No Spam or Advertising**\nUse the correct channels and avoid unwanted promotions.\n\n" +
      "**9. No Impersonation**\nDo not falsely claim staff positions, ranks or qualifications.\n\n" +
      "**10. No Unauthorised Operations**\nMilitary operations and organised events must have an authorised host.\n\n" +
      "**Moderation**\nBreaking the rules may result in a warning, removal from a session, timeout or ban, depending on the severity of the incident.",
  },

  game_rules: {
    title: "Roblox Game Rules",
    content:
      "**1. Realistic Roleplay**\nKeep your character's actions realistic and appropriate.\n\n" +
      "**2. Value Your Life**\nReact realistically to danger and credible threats.\n\n" +
      "**3. Respect Other Players**\nDo not deliberately disrupt another player's roleplay.\n\n" +
      "**4. No Random Attacks**\nDo not harm players without a valid roleplay reason.\n\n" +
      "**5. No Unrealistic Driving**\nDrive appropriately and do not disrupt roleplay with vehicles.\n\n" +
      "**6. Follow Department Procedures**\nFollow the procedures of your authorised department.\n\n" +
      "**7. No Exploits or Cheats**\nDo not use cheats, scripts or glitches to gain an unfair advantage.\n\n" +
      "**8. Follow Session Hosts**\nFollow reasonable instructions from authorised hosts and staff.\n\n" +
      "*These are suggested game rules. Update them to match your official game rules if needed.*",
  },

  departments: {
    title: "Our Departments",
    content:
      "**Metropolitan Police Service (MET)**\nPolicing and law enforcement roleplay.\n\n" +
      "**London Fire Brigade (LFB)**\nFire and rescue roleplay.\n\n" +
      "**London Ambulance Service (LAS)**\nMedical and ambulance roleplay.\n\n" +
      "**British Transport Police (BTP)**\nRailway policing and transport safety roleplay.\n\n" +
      "**British Army**\nAuthorised military roleplay and operations.",
  },

  disclaimer: {
    title: "Community Disclaimer",
    content:
      "London, Uxbridge is a fictional Roblox roleplay community and is not affiliated with the UK Government, British Army or any real-world emergency service.\n\n" +
      "All departments, activities and operations are intended for fictional roleplay purposes only.\n\n" +
      "By remaining in the server, members agree to follow these rules.",
  },
};

// ==================================================
// TICKET SYSTEM
// ==================================================

const ticketTypes = {
  report_user: {
    label: "Report a User",
    description: "Report a member of the community.",
    prefix: "report",
  },
  appeals: {
    label: "Appeals",
    description: "Appeal a moderation action.",
    prefix: "appeal",
  },
  staff_report: {
    label: "Staff Report",
    description: "Report a concern about a staff member.",
    prefix: "staff-report",
  },
  enquiries: {
    label: "Enquiries",
    description: "Ask a question or contact the team.",
    prefix: "enquiry",
  },
};

function ticketMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("uxbridge_ticket_create")
      .setPlaceholder("Choose a ticket type...")
      .addOptions(
        Object.entries(ticketTypes).map(
          ([value, type]) => ({
            label: type.label,
            description: type.description,
            value,
          })
        )
      )
  );
}

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel("Claim")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_modpanel")
      .setLabel("Mod Panel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function modPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_rename")
      .setLabel("Change Name")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_unclaim")
      .setLabel("Unclaim")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_escalate")
      .setLabel("Escalate")
      .setStyle(ButtonStyle.Secondary)
  );
}

function getTicket(channelId) {
  return data.tickets[channelId] || null;
}

function isAdministrator(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function hasRole(interaction, roleId) {
  return Boolean(
    interaction.member?.roles?.cache?.has(roleId)
  );
}

function canManageTicket(interaction) {
  return (
    isAdministrator(interaction) ||
    hasRole(interaction, SUPPORT_ROLE_ID) ||
    hasRole(interaction, ESCALATION_ROLE_ID)
  );
}

async function requireTicketStaff(interaction) {
  if (!canManageTicket(interaction)) {
    await privatePanel(
      interaction,
      "Staff Only",
      "You need the support role or administrator permissions to use this ticket control."
    );

    return false;
  }

  return true;
}

async function logTicket(
  guild,
  ticket,
  action,
  staffId = null
) {
  const config = data.ticketConfigs[guild.id];

  if (!config?.logsChannelId) return;

  try {
    const logsChannel = await guild.channels.fetch(
      config.logsChannelId
    );

    if (!logsChannel || !logsChannel.isTextBased()) {
      return;
    }

    const details =
      `**Ticket:** ${ticket.channelName || ticket.typeLabel}\n` +
      `**Ticket ID:** ${ticket.channelId}\n` +
      `**Type:** ${ticket.typeLabel}\n` +
      `**Opened by:** <@${ticket.userId}>\n` +
      (ticket.claimedBy
        ? `**Claimed by:** <@${ticket.claimedBy}>\n`
        : "") +
      (staffId
        ? `**Action by:** <@${staffId}>\n`
        : "") +
      `**Action:** ${action}\n` +
      `**Opened:** <t:${Math.floor(ticket.createdAt / 1000)}:F>\n` +
      `**Logged:** <t:${Math.floor(Date.now() / 1000)}:F>`;

    await logsChannel.send({
      components: [
        makePanel("Ticket Log", details),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error("Ticket logging failed:", error);
  }
}

async function createTicket(interaction, typeKey) {
  const config = data.ticketConfigs[interaction.guildId];
  const type = ticketTypes[typeKey];

  if (!type) {
    return privatePanel(
      interaction,
      "Invalid Ticket Type",
      "Please select one of the available ticket types."
    );
  }

  if (
    !config ||
    !config.categoryId ||
    !config.logsChannelId
  ) {
    return privatePanel(
      interaction,
      "Tickets Not Configured",
      "An administrator needs to run `/ticket` to configure the ticket system."
    );
  }

  const existing = Object.values(data.tickets).find(
    ticket =>
      ticket.guildId === interaction.guildId &&
      ticket.userId === interaction.user.id &&
      !ticket.closed
  );

  if (existing) {
    const existingChannel =
      await interaction.guild.channels.fetch(
        existing.channelId
      ).catch(() => null);

    if (existingChannel) {
      return privatePanel(
        interaction,
        "You Already Have a Ticket",
        `You already have an open ticket: ${existingChannel}. Please use it before opening another.`
      );
    }

    delete data.tickets[existing.channelId];
    saveData();
  }

  const category = await interaction.guild.channels.fetch(
    config.categoryId
  ).catch(() => null);

  if (
    !category ||
    category.type !== ChannelType.GuildCategory
  ) {
    return privatePanel(
      interaction,
      "Ticket Category Missing",
      "The configured ticket category no longer exists. Ask an administrator to run `/ticket` again."
    );
  }

  const channelName =
    `${type.prefix}-${interaction.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 90);

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
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
  ];

  let channel;

  try {
    channel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites,
      reason: `Ticket opened by ${interaction.user.tag}: ${type.label}`,
    });
  } catch (error) {
    console.error("Ticket channel creation failed:", error);

    return privatePanel(
      interaction,
      "Ticket Could Not Be Created",
      "The bot couldn't create the ticket channel. Check its Manage Channels permission and the category permissions."
    );
  }

  const ticket = {
    channelId: channel.id,
    channelName: channel.name,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    typeKey,
    typeLabel: type.label,
    createdAt: Date.now(),
    claimedBy: null,
    escalated: false,
    closed: false,
  };

  data.tickets[channel.id] = ticket;
  saveData();

  try {
    await channel.send({
      content:
        `<@${interaction.user.id}> <@&${SUPPORT_ROLE_ID}>`,
      allowedMentions: {
        users: [interaction.user.id],
        roles: [SUPPORT_ROLE_ID],
      },
      components: [
        makePanel(
          `${type.label} Ticket`,
          `Welcome, <@${interaction.user.id}>!\n\n` +
            `Your **${type.label}** ticket has been created.\n\n` +
            "Please explain your enquiry and provide any relevant information. A member of staff will assist you as soon as possible.\n\n" +
            "**Ticket controls**\n" +
            "Use the buttons below to claim, close or manage this ticket.",
          [ticketButtons()]
        ),
      ],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    console.error("Ticket welcome message failed:", error);
  }

  await logTicket(
    interaction.guild,
    ticket,
    "Ticket opened"
  );

  return privatePanel(
    interaction,
    "Ticket Created",
    `Your **${type.label}** ticket is ready: ${channel}`
  );
}

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is responding."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Post the community information menu.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where the menu will be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Configure and post the ticket panel. (ONLY SUPPORT)")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addChannelOption(option =>
      option
        .setName("panel_channel")
        .setDescription("Channel where the ticket panel will be posted.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("ticket_category")
        .setDescription("Category where new tickets will be created.")
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
    .setDescription("View the bot commands and support link."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member to look up.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Start or end a staff shift.")
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("Start a one-hour staff shift.")
        .addStringOption(option =>
          option
            .setName("information")
            .setDescription("Optional shift information.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("end")
        .setDescription("End your active staff shift.")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage a military operation.")
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("Start a one-hour operation.")
        .addStringOption(option =>
          option
            .setName("name")
            .setDescription("Operation name.")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("information")
            .setDescription("Optional operation information.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("end")
        .setDescription("End your active operation.")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("View the active operation.")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Training session name.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("information")
        .setDescription("Additional session information.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Record a warning for a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member to warn.")
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
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member to timeout.")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("minutes")
        .setDescription("Duration in minutes.")
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
        .setDescription("Member to kick.")
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
        .setDescription("Member to ban.")
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
    .setDescription("Delete recent messages.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Number of messages to delete.")
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View warning records stored by this bot.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member whose records to view.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a community announcement.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Announcement text.")
        .setRequired(true)
    ),
];

// ==================================================
// STAFF SHIFTS AND OPERATIONS
// ==================================================

const activeTimers = new Map();

function eventKey(guildId, type, userId) {
  return `${guildId}:${type}:${userId}`;
}

function discordDate(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:F>`;
}

function scheduleAutomaticEnd(key, event) {
  if (activeTimers.has(key)) {
    clearTimeout(activeTimers.get(key));
  }

  const delay = Math.max(0, event.endsAt - Date.now());

  const timer = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(
        event.channelId
      );

      if (channel?.isTextBased() && channel.isSendable()) {
        await channel.send({
          components: [
            makePanel(
              event.type === "shift"
                ? "Staff Shift Ended"
                : "Military Operation Ended",
              `**${event.name}**\nHosted by <@${event.userId}>\n\nThe one-hour session has ended.`
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (error) {
      console.error(
        "Automatic event-end message failed:",
        error
      );
    }

    delete data.activeEvents[key];
    saveData();
    activeTimers.delete(key);
  }, Math.min(delay, 2147483647));

  activeTimers.set(key, timer);
}

async function startEvent(
  interaction,
  type,
  name,
  extraInfo = ""
) {
  const key = eventKey(
    interaction.guildId,
    type,
    interaction.user.id
  );

  if (data.activeEvents[key]) {
    return privatePanel(
      interaction,
      "Already Active",
      "You already have an active session of this type. End it before starting another."
    );
  }

  const startedAt = Date.now();
  const endsAt = startedAt + 60 * 60 * 1000;

  const event = {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    type,
    userId: interaction.user.id,
    name,
    startedAt,
    endsAt,
  };

  data.activeEvents[key] = event;
  saveData();
  scheduleAutomaticEnd(key, event);

  return replyPanel(
    interaction,
    type === "shift"
      ? "Staff Shift Started"
      : "Military Operation Started",
    `**${name}**\n\n` +
      `**Host:** ${interaction.user}\n` +
      `**Started:** ${discordDate(startedAt)}\n` +
      `**Scheduled end:** ${discordDate(endsAt)}\n` +
      `**Duration:** 1 hour` +
      (extraInfo
        ? `\n\n**Information:**\n${extraInfo}`
        : "")
  );
}

async function endEvent(interaction, type) {
  const key = eventKey(
    interaction.guildId,
    type,
    interaction.user.id
  );

  const event = data.activeEvents[key];

  if (!event) {
    return privatePanel(
      interaction,
      "No Active Session",
      "You do not have an active session of this type."
    );
  }

  if (activeTimers.has(key)) {
    clearTimeout(activeTimers.get(key));
    activeTimers.delete(key);
  }

  delete data.activeEvents[key];
  saveData();

  return replyPanel(
    interaction,
    type === "shift"
      ? "Staff Shift Ended"
      : "Military Operation Ended",
    `**${event.name}**\nEnded by ${interaction.user}.\n\nThe session has been ended manually.`
  );
}

// ==================================================
// REGISTER COMMANDS ON STARTUP
// ==================================================

client.once("ready", async () => {
  console.log(
    `London, Uxbridge bot online as ${client.user.tag}`
  );

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands.map(command => command.toJSON()),
      }
    );

    console.log(
      `Registered ${commands.length} slash commands.`
    );
  } catch (error) {
    console.error(
      "Slash command registration failed:",
      error
    );
  }

  for (const [key, event] of Object.entries(
    data.activeEvents
  )) {
    scheduleAutomaticEnd(key, event);
  }
});

// ==================================================
// INTERACTION HANDLER
// ==================================================

client.on("interactionCreate", async interaction => {
  try {
    // INFORMATION DROPDOWN
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "uxbridge_information_menu"
    ) {
      const page = informationPages[
        interaction.values[0]
      ];

      if (!page) {
        return privatePanel(
          interaction,
          "Section Not Found",
          "That information section could not be found."
        );
      }

      return interaction.reply({
        components: [
          makePanel(page.title, page.content),
        ],
        flags: v2Flags(true),
      });
    }

    // TICKET DROPDOWN
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "uxbridge_ticket_create"
    ) {
      return createTicket(
        interaction,
        interaction.values[0]
      );
    }

    // TICKET BUTTONS
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("ticket_")
    ) {
      const ticket = getTicket(interaction.channelId);

      if (!ticket) {
        return privatePanel(
          interaction,
          "Ticket Not Found",
          "This channel is not registered as an active ticket."
        );
      }

      if (ticket.closed) {
        return privatePanel(
          interaction,
          "Ticket Closed",
          "This ticket has already been closed."
        );
      }

      // CLAIM
      if (interaction.customId === "ticket_claim") {
        if (!(await requireTicketStaff(interaction))) {
          return;
        }

        if (
          ticket.claimedBy &&
          ticket.claimedBy !== interaction.user.id
        ) {
          return privatePanel(
            interaction,
            "Already Claimed",
            `This ticket is already claimed by <@${ticket.claimedBy}>.`
          );
        }

        if (ticket.claimedBy === interaction.user.id) {
          return privatePanel(
            interaction,
            "Already Claimed",
            "You have already claimed this ticket."
          );
        }

        ticket.claimedBy = interaction.user.id;
        saveData();

        await logTicket(
          interaction.guild,
          ticket,
          "Ticket claimed",
          interaction.user.id
        );

        return privatePanel(
          interaction,
          "Ticket Claimed",
          `You have claimed **${ticket.typeLabel}**.`
        );
      }

      // CLOSE
      if (interaction.customId === "ticket_close") {
        if (!(await requireTicketStaff(interaction))) {
          return;
        }

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;

        saveData();

        await logTicket(
          interaction.guild,
          ticket,
          "Ticket closed",
          interaction.user.id
        );

        await interaction.channel.permissionOverwrites
          .edit(ticket.userId, {
            ViewChannel: true,
            SendMessages: false,
            ReadMessageHistory: true,
          })
          .catch(() => {});

        await interaction.channel.setName(
          `closed-${interaction.channel.name}`.slice(
            0,
            100
          )
        ).catch(() => {});

        return interaction.reply({
          components: [
            makePanel(
              "Ticket Closed",
              `This ticket was closed by ${interaction.user}.\n\nThe channel is now locked for the ticket opener. Staff can still view the channel.`
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }

      // MOD PANEL
      if (
        interaction.customId === "ticket_modpanel"
      ) {
        if (!(await requireTicketStaff(interaction))) {
          return;
        }

        return privatePanel(
          interaction,
          "Ticket Mod Panel",
          `**Ticket:** ${interaction.channel.name}\n` +
            `**Opened by:** <@${ticket.userId}>\n` +
            `**Claimed by:** ${
              ticket.claimedBy
                ? `<@${ticket.claimedBy}>`
                : "Nobody"
            }\n\n` +
            "Choose a ticket management action below.",
          [modPanelButtons()]
        );
      }

      // CHANGE TICKET NAME
      if (
        interaction.customId === "ticket_rename"
      ) {
        if (!(await requireTicketStaff(interaction))) {
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId("ticket_rename_modal")
          .setTitle("Change Ticket Name");

        const nameInput = new TextInputBuilder()
          .setCustomId("ticket_new_name")
          .setLabel("New channel name")
          .setStyle(TextInputStyle.Short)
          .setMinLength(2)
          .setMaxLength(90)
          .setRequired(true)
          .setValue(interaction.channel.name);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            nameInput
          )
        );

        return interaction.showModal(modal);
      }

      // UNCLAIM
      if (
        interaction.customId === "ticket_unclaim"
      ) {
        if (!(await requireTicketStaff(interaction))) {
          return;
        }

        if (!ticket.claimedBy) {
          return privatePanel(
            interaction,
            "Not Claimed",
            "This ticket is not currently claimed."
          );
        }

        ticket.claimedBy = null;
        saveData();

        await logTicket(
          interaction.guild,
          ticket,
          "Ticket unclaimed",
          interaction.user.id
        );

        return privatePanel(
          interaction,
          "Ticket Unclaimed",
          "The ticket is now available for another staff member to claim."
        );
      }

      // ESCALATE
      if (
        interaction.customId === "ticket_escalate"
      ) {
        if (!(await requireTicketStaff(interaction))) {
          return;
        }

        try {
          await interaction.channel.permissionOverwrites.edit(
            ESCALATION_ROLE_ID,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
            }
          );
        } catch (error) {
          console.error(
            "Could not grant escalation role access:",
            error
          );

          return privatePanel(
            interaction,
            "Escalation Failed",
            "The bot could not give the escalation role access. Check its Manage Channels permission and make sure the role exists."
          );
        }

        ticket.escalated = true;
        ticket.escalatedBy = interaction.user.id;
        ticket.escalatedAt = Date.now();
        saveData();

        await interaction.channel.send({
          content: `<@&${ESCALATION_ROLE_ID}>`,
          allowedMentions: {
            roles: [ESCALATION_ROLE_ID],
          },
          components: [
            makePanel(
              "Ticket Escalated",
              `This ticket has been escalated by ${interaction.user}.\n\nThe escalation team has been given access to assist further.`
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });

        await logTicket(
          interaction.guild,
          ticket,
          "Ticket escalated",
          interaction.user.id
        );

        return privatePanel(
          interaction,
          "Ticket Escalated",
          "The escalation role has been notified and granted access to this ticket."
        );
      }
    }

    // RENAME MODAL SUBMISSION
    if (
      interaction.isModalSubmit() &&
      interaction.customId === "ticket_rename_modal"
    ) {
      const ticket = getTicket(interaction.channelId);

      if (!ticket || ticket.closed) {
        return privatePanel(
          interaction,
          "Ticket Unavailable",
          "This ticket could not be found or has already been closed."
        );
      }

      if (!canManageTicket(interaction)) {
        return privatePanel(
          interaction,
          "Staff Only",
          "You need the support role or administrator permissions to rename tickets."
        );
      }

      const newName = interaction.fields
        .getTextInputValue("ticket_new_name")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 90);

      if (!newName) {
        return privatePanel(
          interaction,
          "Invalid Name",
          "Please enter a valid channel name."
        );
      }

      await interaction.channel.setName(newName);
      ticket.channelName = newName;
      saveData();

      await logTicket(
        interaction.guild,
        ticket,
        `Ticket renamed to ${newName}`,
        interaction.user.id
      );

      return privatePanel(
        interaction,
        "Ticket Renamed",
        `The ticket channel is now named **${newName}**.`
      );
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    // PING
    if (command === "ping") {
      return replyPanel(
        interaction,
        "Pong!",
        `Bot latency: **${client.ws.ping}ms**`
      );
    }

    // INFORMATION
    if (command === "information") {
      if (!isAdministrator(interaction)) {
        return privatePanel(
          interaction,
          "Administrator Only",
          "Only server administrators can use this command."
        );
      }

      const channel =
        interaction.options.getChannel("channel");

      if (
        !channel?.isTextBased() ||
        !channel.isSendable()
      ) {
        return privatePanel(
          interaction,
          "Invalid Channel",
          "Choose a text channel where the bot can send messages."
        );
      }

      await channel.send({
        components: [
          makePanel(
            informationPages.information.title,
            informationPages.information.content,
            [informationMenu()]
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
      });

      return privatePanel(
        interaction,
        "Information Panel Posted",
        `The panel has been posted in ${channel}.`
      );
    }

    // TICKET SETUP
    if (command === "ticket") {
      if (!isAdministrator(interaction)) {
        return privatePanel(
          interaction,
          "Administrator Only",
          "Only server administrators can configure the ticket system."
        );
      }

      const panelChannel =
        interaction.options.getChannel("panel_channel");

      const category =
        interaction.options.getChannel("ticket_category");

      const logsChannel =
        interaction.options.getChannel("logs_channel");

      if (
        !panelChannel?.isTextBased() ||
        !panelChannel.isSendable() ||
        category?.type !== ChannelType.GuildCategory ||
        !logsChannel?.isTextBased() ||
        !logsChannel.isSendable()
      ) {
        return privatePanel(
          interaction,
          "Invalid Configuration",
          "Select a text channel for the panel, a category for tickets and a text channel for logs."
        );
      }

      data.ticketConfigs[interaction.guildId] = {
        panelChannelId: panelChannel.id,
        categoryId: category.id,
        logsChannelId: logsChannel.id,
        configuredBy: interaction.user.id,
        configuredAt: Date.now(),
      };

      saveData();

      try {
        await panelChannel.send({
          components: [
            makePanel(
              "London, Uxbridge — Support Centre",
              "Welcome to the London, Uxbridge support centre.\n\n" +
                "Select the appropriate ticket type from the dropdown below. Please provide accurate information and remain respectful when communicating with staff.\n\n" +
                "**Report a User** — Report a community member.\n" +
                "**Appeals** — Appeal a moderation action.\n" +
                "**Staff Report** — Report a concern about a staff member.\n" +
                "**Enquiries** — Ask a question or make a general enquiry.",
              [ticketMenu()]
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (error) {
        console.error(
          "Ticket panel could not be posted:",
          error
        );

        return privatePanel(
          interaction,
          "Panel Could Not Be Posted",
          "The settings were saved, but the bot could not post in that channel. Check its View Channel and Send Messages permissions."
        );
      }

      return privatePanel(
        interaction,
        "Ticket System Configured",
        `**Panel channel:** ${panelChannel}\n` +
          `**Ticket category:** ${category.name}\n` +
          `**Logs channel:** ${logsChannel}\n\n` +
          "The ticket panel has been posted. Running `/ticket` again will post another panel."
      );
    }

    // HELP
    if (command === "help") {
      const supportButton =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel("Join Support Server")
            .setStyle(ButtonStyle.Link)
            .setURL(SUPPORT_URL)
        );

      return replyPanel(
        interaction,
        "London, Uxbridge Bot Help",
        "**General**\n" +
          "`/ping` — Check the bot\n" +
          "`/information` — Post community information\n" +
          "`/ticket` — Configure and post the ticket panel\n" +
          "`/help` — View help\n" +
          "`/userinfo` — View member information\n\n" +
          "**Sessions**\n" +
          "`/staff-shift start` and `/staff-shift end`\n" +
          "`/military-operation start`, `/end` and `/status`\n" +
          "`/training-session` — Announce training\n\n" +
          "**Moderation**\n" +
          "`/warn`, `/timeout`, `/kick`, `/ban`, `/purge`, `/modlogs`, `/announce`",
        [supportButton]
      );
    }

    // USER INFO
    if (command === "userinfo") {
      const user =
        interaction.options.getUser("user") ||
        interaction.user;

      const member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

      return replyPanel(
        interaction,
        "User Information",
        `**Username:** ${user.username}\n` +
          `**User ID:** ${user.id}\n` +
          `**Account created:** ${discordDate(user.createdTimestamp)}\n` +
          `**Joined server:** ${
            member?.joinedTimestamp
              ? discordDate(member.joinedTimestamp)
              : "Not available"
          }`
      );
    }

    // STAFF SHIFT
    if (command === "staff-shift") {
      const subcommand =
        interaction.options.getSubcommand();

      if (subcommand === "start") {
        return startEvent(
          interaction,
          "shift",
          "Staff Shift",
          interaction.options.getString("information") || ""
        );
      }

      return endEvent(interaction, "shift");
    }

    // MILITARY OPERATION
    if (command === "military-operation") {
      const subcommand =
        interaction.options.getSubcommand();

      if (subcommand === "start") {
        return startEvent(
          interaction,
          "operation",
          interaction.options.getString("name"),
          interaction.options.getString("information") || ""
        );
      }

      if (subcommand === "end") {
        const entry = Object.entries(
          data.activeEvents
        ).find(
          ([, event]) =>
            event.guildId === interaction.guildId &&
            event.type === "operation" &&
            event.userId === interaction.user.id
        );

        if (!entry) {
          return privatePanel(
            interaction,
            "No Active Operation",
            "You do not have an active operation to end."
          );
        }

        const [key, event] = entry;

        if (activeTimers.has(key)) {
          clearTimeout(activeTimers.get(key));
          activeTimers.delete(key);
        }

        delete data.activeEvents[key];
        saveData();

        return replyPanel(
          interaction,
          "Military Operation Ended",
          `**${event.name}**\nEnded by ${interaction.user}.`
        );
      }

      const active = Object.values(
        data.activeEvents
      ).find(
        event =>
          event.guildId === interaction.guildId &&
          event.type === "operation"
      );

      return replyPanel(
        interaction,
        "Military Operation Status",
        active
          ? `**Operation:** ${active.name}\n**Host:** <@${active.userId}>\n**Scheduled end:** ${discordDate(active.endsAt)}`
          : "There is no active military operation."
      );
    }

    // TRAINING SESSION
    if (command === "training-session") {
      const name =
        interaction.options.getString("name");

      const information =
        interaction.options.getString("information");

      return replyPanel(
        interaction,
        "Training Session",
        `**Session:** ${name}\n**Hosted by:** ${interaction.user}` +
          (information
            ? `\n\n**Information:**\n${information}`
            : "")
      );
    }

    // WARN
    if (command === "warn") {
      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason");

      data.warnings[user.id] ||= [];

      data.warnings[user.id].push({
        guildId: interaction.guildId,
        moderatorId: interaction.user.id,
        reason,
        date: Date.now(),
      });

      saveData();

      return replyPanel(
        interaction,
        "Warning Recorded",
        `**Member:** ${user}\n` +
          `**Moderator:** ${interaction.user}\n` +
          `**Reason:** ${reason}\n\n` +
          "The warning has been stored in this bot's records."
      );
    }

    // TIMEOUT
    if (command === "timeout") {
      const user =
        interaction.options.getUser("user");

      const minutes =
        interaction.options.getInteger("minutes");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member =
        await interaction.guild.members.fetch(user.id);

      await member.timeout(
        minutes * 60 * 1000,
        reason
      );

      return replyPanel(
        interaction,
        "Member Timed Out",
        `**Member:** ${user}\n**Duration:** ${minutes} minutes\n**Reason:** ${reason}`
      );
    }

    // KICK
    if (command === "kick") {
      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member =
        await interaction.guild.members.fetch(user.id);

      await member.kick(reason);

      return replyPanel(
        interaction,
        "Member Kicked",
        `**Member:** ${user.username}\n**Reason:** ${reason}`
      );
    }

    // BAN
    if (command === "ban") {
      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      await interaction.guild.members.ban(user.id, {
        reason,
      });

      return replyPanel(
        interaction,
        "Member Banned",
        `**Member:** ${user.username}\n**Reason:** ${reason}`
      );
    }

    // PURGE
    if (command === "purge") {
      const amount =
        interaction.options.getInteger("amount");

      const deleted =
        await interaction.channel.bulkDelete(amount, true);

      return replyPanel(
        interaction,
        "Messages Deleted",
        `Deleted **${deleted.size}** messages.\nMessages older than 14 days cannot be bulk-deleted.`
      );
    }

    // MODERATION LOGS
    if (command === "modlogs") {
      const user =
        interaction.options.getUser("user");

      const warnings = (
        data.warnings[user.id] || []
      ).filter(
        warning =>
          warning.guildId === interaction.guildId
      );

      const content = warnings.length
        ? warnings
            .slice(-10)
            .map(
              (warning, index) =>
                `**${index + 1}.** ${warning.reason}\n` +
                `Moderator: <@${warning.moderatorId}>\n` +
                `Date: <t:${Math.floor(warning.date / 1000)}:F>`
            )
            .join("\n\n")
        : "No warning records from this bot were found for that member.";

      return replyPanel(
        interaction,
        `Moderation Records — ${user.username}`,
        content
      );
    }

    // ANNOUNCE
    if (command === "announce") {
      const message =
        interaction.options.getString("message");

      return replyPanel(
        interaction,
        "Community Announcement",
        message
      );
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const errorContent =
      "Something went wrong while processing that action. Check the bot hosting logs for details.";

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          components: [
            makePanel("Action Failed", errorContent),
          ],
          flags: v2Flags(true),
        }).catch(() => {});
      } else {
        await interaction.reply({
          components: [
            makePanel("Action Failed", errorContent),
          ],
          flags: v2Flags(true),
        }).catch(() => {});
      }
    }
  }
});

// ==================================================
// START BOT
// ==================================================

client.login(TOKEN);
