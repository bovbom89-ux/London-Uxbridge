
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
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID =
  process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ================================================
// DATA STORAGE
// ================================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { warnings: {}, activeEvents: {} };
  }
}

const data = loadData();
data.warnings ||= {};
data.activeEvents ||= {};

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ================================================
// COMPONENTS V2
// No coloured accents are used.
// ================================================

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

  if (rows.length > 0) {
    container.addActionRowComponents(...rows);
  }

  return container;
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
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
  });
}

async function sendPrivatePanel(interaction, title, content) {
  return interaction.reply({
    components: [makePanel(title, content)],
    flags:
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral,
  });
}

// ================================================
// COMMUNITY INFORMATION DROPDOWN
// ================================================

function informationMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("uxbridge_information_menu")
      .setPlaceholder("Choose an information section...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        {
          label: "Information",
          description: "About London, Uxbridge.",
          value: "information",
          emoji: "ℹ️",
        },
        {
          label: "Server Rules",
          description: "Read our community rules.",
          value: "server_rules",
          emoji: "📋",
        },
        {
          label: "Game Rules",
          description: "Read our Roblox roleplay rules.",
          value: "game_rules",
          emoji: "🎮",
        },
        {
          label: "Departments",
          description: "View our departments.",
          value: "departments",
          emoji: "🚔",
        },
        {
          label: "Disclaimer",
          description: "Read our community disclaimer.",
          value: "disclaimer",
          emoji: "⚠️",
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
      "Select an option from the menu below to learn more about our community.",
  },

  server_rules: {
    title: "Community Rules",
    content:
      "**1. Respect Everyone**\n" +
      "Harassment, bullying and discrimination are prohibited.\n\n" +
      "**2. Follow Staff Instructions**\n" +
      "Treat staff respectfully and follow reasonable instructions.\n\n" +
      "**3. No RDM or VDM**\n" +
      "Do not attack players or use vehicles to harm them without a valid roleplay reason.\n\n" +
      "**4. No Fail Roleplay**\n" +
      "Keep actions realistic and respect roleplay scenarios.\n\n" +
      "**5. No Metagaming or Powergaming**\n" +
      "Do not misuse out-of-character information or force actions on others.\n\n" +
      "**6. No Exploiting**\n" +
      "Cheating, hacking and exploiting glitches are prohibited.\n\n" +
      "**7. No Abuse of Authority**\n" +
      "Department members must act within their roleplay powers.\n\n" +
      "**8. No Spam or Advertising**\n" +
      "Use the correct channels and avoid unwanted promotions.\n\n" +
      "**9. No Impersonation**\n" +
      "Do not falsely claim staff positions, ranks or qualifications.\n\n" +
      "**10. No Unauthorised Operations**\n" +
      "Military operations and organised events must have an authorised host.\n\n" +
      "**Moderation**\n" +
      "Breaking the rules may result in a warning, removal from a session, timeout or ban, depending on the severity of the incident.",
  },

  game_rules: {
    title: "Roblox Game Rules",
    content:
      "**1. Realistic Roleplay**\n" +
      "Keep your character's actions realistic and appropriate for the situation.\n\n" +
      "**2. Value Your Life**\n" +
      "React realistically to danger and credible threats.\n\n" +
      "**3. Respect Other Players**\n" +
      "Do not deliberately disrupt another player's roleplay.\n\n" +
      "**4. No Random Attacks**\n" +
      "Do not attack or harm players without a valid roleplay reason.\n\n" +
      "**5. No Unrealistic Driving**\n" +
      "Drive appropriately and do not use vehicles to disrupt roleplay.\n\n" +
      "**6. Follow Department Procedures**\n" +
      "Follow the procedures of your authorised department.\n\n" +
      "**7. No Exploits or Cheats**\n" +
      "Do not use cheats, scripts or glitches to gain an unfair advantage.\n\n" +
      "**8. Follow Session Hosts**\n" +
      "Follow reasonable instructions from authorised session hosts and staff.\n\n" +
      "*These are suggested game rules. Update them if your Roblox game has additional official rules.*",
  },

  departments: {
    title: "Our Departments",
    content:
      "**Metropolitan Police Service (MET)**\n" +
      "Policing, public safety and law enforcement roleplay.\n\n" +
      "**London Fire Brigade (LFB)**\n" +
      "Fire and rescue roleplay.\n\n" +
      "**London Ambulance Service (LAS)**\n" +
      "Medical and ambulance roleplay.\n\n" +
      "**British Transport Police (BTP)**\n" +
      "Railway policing and transport safety roleplay.\n\n" +
      "**British Army**\n" +
      "Authorised military roleplay and operations.",
  },

  disclaimer: {
    title: "Community Disclaimer",
    content:
      "London, Uxbridge is a fictional Roblox roleplay community and is not affiliated with the UK Government, British Army or any real-world emergency service.\n\n" +
      "All departments, activities and operations are intended for fictional roleplay purposes only.\n\n" +
      "By remaining in the server, members agree to follow these rules.",
  },
};

// ================================================
// SLASH COMMANDS
// ================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is responding."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Post the community information menu.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel where the menu will be posted.")
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member whose records to view.")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a community announcement.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Announcement text.")
        .setRequired(true)
    ),
];

// ================================================
// REGISTER COMMANDS ON STARTUP
// ================================================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  console.log("Registering slash commands...");

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands.map(command => command.toJSON()) }
  );

  console.log(`Registered ${commands.length} slash commands.`);
}

// ================================================
// STAFF SHIFTS AND MILITARY OPERATIONS
// ================================================

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
      const channel = await client.channels.fetch(event.channelId);

      if (channel && channel.isTextBased() && channel.isSendable()) {
        const title =
          event.type === "shift"
            ? "Staff Shift Ended"
            : "Military Operation Ended";

        await channel.send({
          components: [
            makePanel(
              title,
              `**${event.name}**\nHosted by <@${event.userId}>\n\nThe one-hour session has ended.`
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (error) {
      console.error("Automatic event-end message failed:", error);
    }

    delete data.activeEvents[key];
    saveData();
    activeTimers.delete(key);
  }, Math.min(delay, 2147483647));

  activeTimers.set(key, timer);
}

async function startEvent(interaction, type, name, extraInfo = "") {
  const key = eventKey(interaction.guildId, type, interaction.user.id);

  if (data.activeEvents[key]) {
    return replyPanel(
      interaction,
      "Already Active",
      "You already have an active session of this type. End it before starting another.",
      [],
      true
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

  const title =
    type === "shift"
      ? "Staff Shift Started"
      : "Military Operation Started";

  const content =
    `**${name}**\n\n` +
    `**Host:** ${interaction.user}\n` +
    `**Started:** ${discordDate(startedAt)}\n` +
    `**Scheduled end:** ${discordDate(endsAt)}\n` +
    `**Duration:** 1 hour` +
    (extraInfo ? `\n\n**Information:**\n${extraInfo}` : "");

  return replyPanel(interaction, title, content);
}

async function endEvent(interaction, type) {
  const key = eventKey(interaction.guildId, type, interaction.user.id);
  const event = data.activeEvents[key];

  if (!event) {
    return replyPanel(
      interaction,
      "No Active Session",
      "You do not have an active session of this type.",
      [],
      true
    );
  }

  if (activeTimers.has(key)) {
    clearTimeout(activeTimers.get(key));
    activeTimers.delete(key);
  }

  delete data.activeEvents[key];
  saveData();

  const title =
    type === "shift"
      ? "Staff Shift Ended"
      : "Military Operation Ended";

  return replyPanel(
    interaction,
    title,
    `**${event.name}**\nEnded by ${interaction.user}.\n\nThe session has been ended manually.`
  );
}

// ================================================
// BOT READY
// ================================================

client.once("ready", async () => {
  console.log(`London, Uxbridge bot online as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  for (const [key, event] of Object.entries(data.activeEvents)) {
    scheduleAutomaticEnd(key, event);
  }
});

// ================================================
// INTERACTIONS
// ================================================

client.on("interactionCreate", async interaction => {
  try {
    // Dropdown responses are private.
    // The original public menu is never edited.
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "uxbridge_information_menu"
    ) {
      const page = informationPages[interaction.values[0]];

      if (!page) {
        return interaction.reply({
          content: "That information section could not be found.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        components: [
          makePanel(page.title, page.content),
        ],
        flags:
          MessageFlags.IsComponentsV2 |
          MessageFlags.Ephemeral,
      });
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

    // INFORMATION — ADMIN ONLY, POST TO CHOSEN CHANNEL
    if (command === "information") {
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content: "Only server administrators can use this command.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const channel = interaction.options.getChannel("channel");

      if (
        !channel ||
        !channel.isTextBased() ||
        !channel.isSendable()
      ) {
        return interaction.reply({
          content: "Please select a text channel where the bot can send messages.",
          flags: MessageFlags.Ephemeral,
        });
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

      return interaction.reply({
        content: `The information menu has been posted in ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // HELP
    if (command === "help") {
      const supportButton = new ActionRowBuilder().addComponents(
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
          "`/information` — Post the information menu (administrators only)\n" +
          "`/help` — Show help\n" +
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
        interaction.options.getUser("user") || interaction.user;

      const member = await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

      const joined = member?.joinedTimestamp
        ? discordDate(member.joinedTimestamp)
        : "Not available";

      return replyPanel(
        interaction,
        "User Information",
        `**Username:** ${user.username}\n` +
          `**User ID:** ${user.id}\n` +
          `**Account created:** ${discordDate(user.createdTimestamp)}\n` +
          `**Joined server:** ${joined}`
      );
    }

    // STAFF SHIFT
    if (command === "staff-shift") {
      const subcommand = interaction.options.getSubcommand();

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
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "start") {
        return startEvent(
          interaction,
          "operation",
          interaction.options.getString("name"),
          interaction.options.getString("information") || ""
        );
      }

      if (subcommand === "end") {
        const entry = Object.entries(data.activeEvents).find(
          ([, event]) =>
            event.guildId === interaction.guildId &&
            event.type === "operation" &&
            event.userId === interaction.user.id
        );

        if (!entry) {
          return replyPanel(
            interaction,
            "No Active Operation",
            "You do not have an active operation to end.",
            [],
            true
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

      const active = Object.values(data.activeEvents).find(
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
      const name = interaction.options.getString("name");
      const information =
        interaction.options.getString("information");

      return replyPanel(
        interaction,
        "Training Session",
        `**Session:** ${name}\n**Hosted by:** ${interaction.user}` +
          (information ? `\n\n**Information:**\n${information}` : "")
      );
    }

    // WARN
    if (command === "warn") {
      const user = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason");

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
      const user = interaction.options.getUser("user");
      const minutes = interaction.options.getInteger("minutes");
      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member = await interaction.guild.members.fetch(user.id);

      await member.timeout(minutes * 60 * 1000, reason);

      return replyPanel(
        interaction,
        "Member Timed Out",
        `**Member:** ${user}\n` +
          `**Duration:** ${minutes} minutes\n` +
          `**Reason:** ${reason}`
      );
    }

    // KICK
    if (command === "kick") {
      const user = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member = await interaction.guild.members.fetch(user.id);
      await member.kick(reason);

      return replyPanel(
        interaction,
        "Member Kicked",
        `**Member:** ${user.username}\n**Reason:** ${reason}`
      );
    }

    // BAN
    if (command === "ban") {
      const user = interaction.options.getUser("user");
      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      await interaction.guild.members.ban(user.id, { reason });

      return replyPanel(
        interaction,
        "Member Banned",
        `**Member:** ${user.username}\n**Reason:** ${reason}`
      );
    }

    // PURGE
    if (command === "purge") {
      const amount = interaction.options.getInteger("amount");

      const deleted = await interaction.channel.bulkDelete(amount, true);

      return replyPanel(
        interaction,
        "Messages Deleted",
        `Deleted **${deleted.size}** messages.\nMessages older than 14 days cannot be bulk-deleted.`
      );
    }

    // MODERATION LOGS
    if (command === "modlogs") {
      const user = interaction.options.getUser("user");

      const warnings = (data.warnings[user.id] || []).filter(
        warning => warning.guildId === interaction.guildId
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

    // ANNOUNCEMENT
    if (command === "announce") {
      const message = interaction.options.getString("message");

      return replyPanel(
        interaction,
        "Community Announcement",
        message
      );
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const errorMessage = {
      content:
        "Something went wrong. Check the bot's hosting logs for details.",
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errorMessage).catch(() => {});
    } else {
      await interaction.reply(errorMessage).catch(() => {});
    }
  }
});

// ================================================
// START BOT
// ================================================

client.login(TOKEN);
