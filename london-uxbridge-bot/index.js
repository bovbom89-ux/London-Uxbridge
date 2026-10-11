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

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
}

const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// COMPONENTS V2 — no coloured accents.

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function separator() {
  return new SeparatorBuilder();
}

function makePanel(title, content, components = []) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`# ${title}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(content));

  if (components.length) {
    container.addActionRowComponents(...components);
  }

  return container;
}

async function sendPanel(interaction, title, content, components = []) {
  return interaction.reply({
    components: [makePanel(title, content, components)],
    flags: MessageFlags.IsComponentsV2,
  });
}

// COMMUNITY INFORMATION DROPDOWN

function informationMenu(selected = "information") {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("uxbridge_information_menu")
    .setPlaceholder("Choose a section...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      {
        label: "Information",
        description: "Learn about London, Uxbridge.",
        value: "information",
        default: selected === "information",
      },
      {
        label: "Server Rules",
        description: "Read our community Discord rules.",
        value: "server_rules",
        default: selected === "server_rules",
      },
      {
        label: "Game Rules",
        description: "Read our Roblox roleplay rules.",
        value: "game_rules",
        default: selected === "game_rules",
      },
      {
        label: "Departments",
        description: "View our departments and services.",
        value: "departments",
        default: selected === "departments",
      },
      {
        label: "Disclaimer",
        description: "Read our community disclaimer.",
        value: "disclaimer",
        default: selected === "disclaimer",
      }
    );

  return new ActionRowBuilder().addComponents(menu);
}

const informationPages = {
  information: {
    title: "Community Information",
    content:
      "Welcome to **London, Uxbridge**, a British Roblox roleplay community based in West London.\n\n" +
      "Our aim is to provide realistic, enjoyable and organised roleplay for civilians, emergency services, public services and military personnel.\n\n" +
      "Use the dropdown menu below to explore our community rules, game rules, departments and disclaimer.",
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
      "Keep your character's actions appropriate and realistic for the situation.\n\n" +
      "**2. Value Your Life**\n" +
      "React realistically to dangerous situations and credible threats.\n\n" +
      "**3. Respect Other Players**\n" +
      "Do not deliberately disrupt another player's roleplay.\n\n" +
      "**4. No Random Attacks**\n" +
      "Do not attack, arrest or harm players without a valid roleplay reason.\n\n" +
      "**5. No Unrealistic Driving**\n" +
      "Drive appropriately and do not use vehicles to disrupt roleplay.\n\n" +
      "**6. Follow Department Procedures**\n" +
      "If you belong to a department, follow its authorised procedures and instructions.\n\n" +
      "**7. No Exploits or Cheats**\n" +
      "Do not use scripts, cheats or glitches to gain an unfair advantage.\n\n" +
      "**8. Follow Session Hosts**\n" +
      "Follow reasonable instructions from authorised session hosts and staff.\n\n" +
      "*These are general game rules. You can replace them with your official Roblox game rules whenever they are finalised.*",
  },

  departments: {
    title: "Our Departments",
    content:
      "**Metropolitan Police Service (MET)**\n" +
      "Responsible for policing, public safety and law enforcement roleplay.\n\n" +
      "**London Fire Brigade (LFB)**\n" +
      "Responsible for fire and rescue roleplay.\n\n" +
      "**London Ambulance Service (LAS)**\n" +
      "Responsible for medical and ambulance roleplay.\n\n" +
      "**British Transport Police (BTP)**\n" +
      "Responsible for railway policing and transport safety roleplay.\n\n" +
      "**British Army**\n" +
      "Responsible for authorised military roleplay and operations.",
  },

  disclaimer: {
    title: "Community Disclaimer",
    content:
      "London, Uxbridge is a fictional Roblox roleplay community and is not affiliated with the UK Government, British Army or any real-world emergency service.\n\n" +
      "All departments, activities and operations are intended for fictional roleplay purposes only.\n\n" +
      "By remaining in the server, members agree to follow the community rules.",
  },
};

// SLASH COMMANDS

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is responding."),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Open the community information menu.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View commands and support information."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("View information about a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("The member to look up.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("staff-shift")
    .setDescription("Start or end a staff shift.")
    .addSubcommand(sub =>
      sub.setName("start").setDescription("Start a one-hour staff shift.")
        .addStringOption(option =>
          option.setName("information")
            .setDescription("Optional shift information.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("end").setDescription("End your active staff shift.")
    ),

  new SlashCommandBuilder()
    .setName("military-operation")
    .setDescription("Manage a military operation.")
    .addSubcommand(sub =>
      sub.setName("start").setDescription("Start a one-hour operation.")
        .addStringOption(option =>
          option.setName("name")
            .setDescription("Operation name.")
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName("information")
            .setDescription("Optional operation information.")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName("end").setDescription("End an active operation.")
    )
    .addSubcommand(sub =>
      sub.setName("status").setDescription("View the current operation.")
    ),

  new SlashCommandBuilder()
    .setName("training-session")
    .setDescription("Announce a training session.")
    .addStringOption(option =>
      option.setName("name")
        .setDescription("Training session name.")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("information")
        .setDescription("Additional session information.")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Record a warning for a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("user").setDescription("Member to warn.").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the warning.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("user").setDescription("Member to timeout.").setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("minutes").setDescription("Timeout duration in minutes.")
        .setMinValue(1).setMaxValue(40320).setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the timeout.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option.setName("user").setDescription("Member to kick.").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the kick.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName("user").setDescription("Member to ban.").setRequired(true)
    )
    .addStringOption(option =>
      option.setName("reason").setDescription("Reason for the ban.").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option =>
      option.setName("amount").setDescription("Number of messages to delete.")
        .setMinValue(1).setMaxValue(100).setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("View this bot's warning records.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName("user").setDescription("Member whose records to view.").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send a community announcement.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("message").setDescription("Announcement text.").setRequired(true)
    ),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
  console.log("Registering slash commands...");

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands.map(command => command.toJSON()) }
  );

  console.log(`Registered ${commands.length} slash commands.`);
}

// EVENT HELPERS

function eventKey(guildId, type, userId) {
  return `${guildId}:${type}:${userId}`;
}

function formatDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

function createEventEndMessage(type, name, hostId) {
  const label = type === "shift" ? "Staff Shift Ended" : "Military Operation Ended";

  return makePanel(
    label,
    `**${name}**\nHosted by <@${hostId}>\n\nThe scheduled one-hour session has ended.`
  );
}

const activeTimers = new Map();

function scheduleAutomaticEnd(guildId, channelId, type, userId, name) {
  const key = eventKey(guildId, type, userId);
  const existing = data.activeEvents[key];

  if (!existing) return;

  if (activeTimers.has(key)) {
    clearTimeout(activeTimers.get(key));
  }

  const delay = Math.max(0, existing.endsAt - Date.now());

  const timer = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(channelId);

      if (channel && channel.isTextBased()) {
        await channel.send({
          components: [
            createEventEndMessage(type, name, userId),
          ],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    } catch (error) {
      console.error("Could not send automatic end message:", error);
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
    return sendPanel(
      interaction,
      "Already Active",
      "You already have an active session of this type. End it before starting another."
    );
  }

  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  data.activeEvents[key] = {
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    type,
    userId: interaction.user.id,
    name,
    extraInfo,
    startedAt: start.getTime(),
    endsAt: end.getTime(),
  };

  saveData();

  const title = type === "shift" ? "Staff Shift Started" : "Military Operation Started";

  const content =
    `**${name}**\n\n` +
    `**Host:** ${interaction.user}\n` +
    `**Started:** ${formatDate(start)}\n` +
    `**Scheduled end:** ${formatDate(end)}\n` +
    `**Duration:** 1 hour` +
    (extraInfo ? `\n\n**Information:**\n${extraInfo}` : "");

  await interaction.reply({
    components: [makePanel(title, content)],
    flags: MessageFlags.IsComponentsV2,
  });

  scheduleAutomaticEnd(
    interaction.guildId,
    interaction.channelId,
    type,
    interaction.user.id,
    name
  );
}

async function endEvent(interaction, type) {
  const key = eventKey(interaction.guildId, type, interaction.user.id);
  const active = data.activeEvents[key];

  if (!active) {
    return sendPanel(
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

  const title = type === "shift" ? "Staff Shift Ended" : "Military Operation Ended";

  await sendPanel(
    interaction,
    title,
    `**${active.name}**\nHosted by ${interaction.user}\n\nThe session has been ended manually.`
  );
}

// READY

client.once("ready", async () => {
  console.log(`London, Uxbridge bot online as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Command registration failed:", error);
  }

  // Restore active one-hour timers after a restart.
  for (const [key, event] of Object.entries(data.activeEvents)) {
    scheduleAutomaticEnd(
      event.guildId,
      event.channelId,
      event.type,
      event.userId,
      event.name
    );
  }
});

// INTERACTIONS

client.on("interactionCreate", async interaction => {
  try {
    // Handle the community information dropdown.
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "uxbridge_information_menu"
    ) {
      const selected = interaction.values[0];
      const page = informationPages[selected];

      if (!page) {
        return interaction.reply({
          content: "That information section could not be found.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.update({
        components: [
          makePanel(
            page.title,
            page.content,
            [informationMenu(selected)]
          ),
        ],
      });
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === "ping") {
      return sendPanel(
        interaction,
        "Pong!",
        `Latency: **${client.ws.ping}ms**`
      );
    }

    if (commandName === "information") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "Only server administrators can use this command.",
          flags: MessageFlags.Ephemeral,
        });
      }

      return sendPanel(
        interaction,
        informationPages.information.title,
        informationPages.information.content,
        [informationMenu("information")]
      );
    }

    if (commandName === "help") {
      const supportButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Join Support Server")
          .setStyle(ButtonStyle.Link)
          .setURL(SUPPORT_URL)
      );

      return sendPanel(
        interaction,
        "London, Uxbridge Bot Help",
        "**General**\n" +
          "`/ping` — Check the bot\n" +
          "`/information` — Community information menu (administrators only)\n" +
          "`/help` — View commands and support\n" +
          "`/userinfo` — Member information\n\n" +
          "**Shifts and Operations**\n" +
          "`/staff-shift start` and `/staff-shift end`\n" +
          "`/military-operation start`, `/end` and `/status`\n" +
          "`/training-session` — Announce training\n\n" +
          "**Moderation**\n" +
          "`/warn`, `/timeout`, `/kick`, `/ban`, `/purge`, `/modlogs`, `/announce`",
        [supportButton]
      );
    }

    if (commandName === "userinfo") {
      const user = interaction.options.getUser("user") || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      const joined = member?.joinedAt
        ? formatDate(member.joinedAt)
        : "Not available";

      return sendPanel(
        interaction,
        "User Information",
        `**Username:** ${user.username}\n` +
          `**User ID:** ${user.id}\n` +
          `**Account created:** ${formatDate(user.createdAt)}\n` +
          `**Joined server:** ${joined}`
      );
    }

    if (commandName === "staff-shift") {
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

    if (commandName === "military-operation") {
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
        const active = Object.entries(data.activeEvents).find(
          ([key, event]) =>
            key.startsWith(`${interaction.guildId}:operation:`) &&
            event.guildId === interaction.guildId
        );

        if (!active) {
          return sendPanel(interaction, "No Active Operation", "There is no active military operation.");
        }

        const [key, event] = active;

        if (activeTimers.has(key)) {
          clearTimeout(activeTimers.get(key));
          activeTimers.delete(key);
        }

        delete data.activeEvents[key];
        saveData();

        return sendPanel(
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

      return sendPanel(
        interaction,
        "Military Operation Status",
        active
          ? `**Operation:** ${active.name}\n**Host:** <@${active.userId}>\n**Scheduled end:** <t:${Math.floor(active.endsAt / 1000)}:F>`
          : "There is no active military operation."
      );
    }

    if (commandName === "training-session") {
      const name = interaction.options.getString("name");
      const info = interaction.options.getString("information");

      return sendPanel(
        interaction,
        "Training Session",
        `**Session:** ${name}\n**Hosted by:** ${interaction.user}` +
          (info ? `\n\n**Information:**\n${info}` : "")
      );
    }

    if (commandName === "warn") {
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

      return sendPanel(
        interaction,
        "Warning Recorded",
        `**Member:** ${user}\n**Moderator:** ${interaction.user}\n**Reason:** ${reason}\n\nThis warning has been stored in this bot's records.`
      );
    }

    if (commandName === "timeout") {
      const user = interaction.options.getUser("user");
      const minutes = interaction.options.getInteger("minutes");
      const reason = interaction.options.getString("reason") || "No reason provided";

      const member = await interaction.guild.members.fetch(user.id);
      await member.timeout(minutes * 60 * 1000, reason);

      return sendPanel(
        interaction,
        "Member Timed Out",
        `**Member:** ${user}\n**Duration:** ${minutes} minutes\n**Reason:** ${reason}`
      );
    }

    if (commandName === "kick") {
      const user = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason provided";
      const member = await interaction.guild.members.fetch(user.id);

      await member.kick(reason);

      return sendPanel(
        interaction,
        "Member Kicked",
        `**Member:** ${user.username}\n**Reason:** ${reason}`
      );
    }

    if (commandName === "ban") {
      const user = interaction.options.getUser("user");
      const reason = interaction.options.getString("reason") || "No reason provided";

      await interaction.guild.members.ban(user.id, { reason });

      return sendPanel(
        interaction,
        "Member Banned",
        `**Member:** ${user.username}\n**Reason:** ${reason}`
      );
    }

    if (commandName === "purge") {
      const amount = interaction.options.getInteger("amount");

      const deleted = await interaction.channel.bulkDelete(amount, true);

      return sendPanel(
        interaction,
        "Messages Deleted",
        `Deleted **${deleted.size}** messages. Messages older than 14 days cannot be bulk-deleted.`
      );
    }

    if (commandName === "modlogs") {
      const user = interaction.options.getUser("user");
      const warnings = (data.warnings[user.id] || []).filter(
        warning => warning.guildId === interaction.guildId
      );

      const content = warnings.length
        ? warnings
            .slice(-10)
            .map((warning, index) =>
              `**${index + 1}.** ${warning.reason}\nModerator: <@${warning.moderatorId}> · <t:${Math.floor(warning.date / 1000)}:R>`
            )
            .join("\n\n")
        : "No warning records from this bot were found for that member.";

      return sendPanel(
        interaction,
        `Moderation Records — ${user.username}`,
        content
      );
    }

    if (commandName === "announce") {
      const message = interaction.options.getString("message");

      return sendPanel(
        interaction,
        "Community Announcement",
        message
      );
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const message = {
      content: "Something went wrong while processing that command. Check the bot logs.",
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
});

client.login(TOKEN);
