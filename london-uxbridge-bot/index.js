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
SeparatorBuilder
} = require("discord.js");

require("dotenv").config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID =
process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

const SUPPORT_URL = "https://discord.gg/DeuwuZFXN";
const FOOTER = "London, Uxbridge";

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
console.error("Missing required environment variables.");
process.exit(1);
}

const client = new Client({
intents: [GatewayIntentBits.Guilds]
});

// Temporary records reset when the bot restarts.
const shifts = new Map();
const warnings = new Map();
const modlogs = new Map();
const operations = new Map();

function makePanel(title, sections = []) {
const container = new ContainerBuilder();

container.addTextDisplayComponents(
new TextDisplayBuilder().setContent("# ${title}")
);

for (const section of sections) {
container.addSeparatorComponents(
new SeparatorBuilder().setDivider(true)
);
container.addTextDisplayComponents(
new TextDisplayBuilder().setContent(section)
);
}

container.addSeparatorComponents(
new SeparatorBuilder().setDivider(true)
);

container.addTextDisplayComponents(
new TextDisplayBuilder().setContent("-# ${FOOTER}")
);

return container;
}

async function panelReply(
interaction,
title,
sections = [],
ephemeral = false
) {
return interaction.reply({
components: [makePanel(title, sections)],
flags:
MessageFlags.IsComponentsV2 |
(ephemeral ? MessageFlags.Ephemeral : 0)
});
}

function recordAction(guildId, userId, action, reason, moderatorId) {
if (!modlogs.has(guildId)) modlogs.set(guildId, []);

modlogs.get(guildId).push({
userId,
action,
reason,
moderatorId,
date: Date.now()
});
}

const commands = [
new SlashCommandBuilder()
.setName("ping")
.setDescription("Check whether the bot is responding"),

new SlashCommandBuilder()
.setName("information")
.setDescription("View information about London, Uxbridge"),

new SlashCommandBuilder()
.setName("rules")
.setDescription("View the server rules"),

new SlashCommandBuilder()
.setName("help")
.setDescription("Get help and access the support server"),

new SlashCommandBuilder()
.setName("host-shift")
.setDescription("Start or end a hosted shift")
.addStringOption(option =>
option.setName("action")
.setDescription("Choose an action")
.setRequired(true)
.addChoices(
{ name: "Start shift", value: "start" },
{ name: "End shift", value: "end" }
)
),

new SlashCommandBuilder()
.setName("shift-stats")
.setDescription("View your shift statistics"),

new SlashCommandBuilder()
.setName("military-operation")
.setDescription("Manage a military operation")
.addStringOption(option =>
option.setName("action")
.setDescription("Choose an action")
.setRequired(true)
.addChoices(
{ name: "Start", value: "start" },
{ name: "End", value: "end" },
{ name: "Status", value: "status" }
)
)
.addStringOption(option =>
option.setName("name")
.setDescription("Operation name")
.setRequired(false)
),

new SlashCommandBuilder()
.setName("training-session")
.setDescription("Announce a training session")
.addStringOption(option =>
option.setName("details")
.setDescription("Training details and time")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("warn")
.setDescription("Warn a member")
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
.addUserOption(option =>
option.setName("user")
.setDescription("Member to warn")
.setRequired(true)
)
.addStringOption(option =>
option.setName("reason")
.setDescription("Reason for the warning")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("timeout")
.setDescription("Timeout a member")
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
.addUserOption(option =>
option.setName("user")
.setDescription("Member to timeout")
.setRequired(true)
)
.addIntegerOption(option =>
option.setName("minutes")
.setDescription("Duration in minutes")
.setRequired(true)
.setMinValue(1)
.setMaxValue(40320)
)
.addStringOption(option =>
option.setName("reason")
.setDescription("Reason for the timeout")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("kick")
.setDescription("Kick a member")
.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
.addUserOption(option =>
option.setName("user")
.setDescription("Member to kick")
.setRequired(true)
)
.addStringOption(option =>
option.setName("reason")
.setDescription("Reason for the kick")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("ban")
.setDescription("Ban a member")
.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
.addUserOption(option =>
option.setName("user")
.setDescription("Member to ban")
.setRequired(true)
)
.addStringOption(option =>
option.setName("reason")
.setDescription("Reason for the ban")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("purge")
.setDescription("Delete recent messages")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
.addIntegerOption(option =>
option.setName("amount")
.setDescription("Number of messages to delete")
.setRequired(true)
.setMinValue(1)
.setMaxValue(100)
),

new SlashCommandBuilder()
.setName("userinfo")
.setDescription("View information about a member")
.addUserOption(option =>
option.setName("user")
.setDescription("Member to inspect")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("modlogs")
.setDescription("View recorded moderation actions")
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
.addUserOption(option =>
option.setName("user")
.setDescription("Member to inspect")
.setRequired(true)
),

new SlashCommandBuilder()
.setName("announce")
.setDescription("Publish a server announcement")
.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
.addStringOption(option =>
option.setName("message")
.setDescription("Announcement text")
.setRequired(true)
)
];

client.once("clientReady", async () => {
console.log("Logged in as ${client.user.tag}");

try {
const rest = new REST({ version: "10" }).setToken(TOKEN);

console.log("Removing old global slash commands...");

await rest.put(
  Routes.applicationCommands(CLIENT_ID),
  { body: [] }
);

console.log("Registering current server commands...");

await rest.put(
  Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
  {
    body: commands.map(command => command.toJSON())
  }
);

console.log(
  `Successfully registered ${commands.length} slash commands.`
);

} catch (error) {
console.error("Slash command registration failed:", error);
}
});

client.on("interactionCreate", async interaction => {
if (!interaction.isChatInputCommand()) return;

const guild = interaction.guild;
const user = interaction.user;

try {
if (!guild) {
return panelReply(
interaction,
"Server required",
["Please use this command inside the server."],
true
);
}

switch (interaction.commandName) {
  case "ping":
    return panelReply(interaction, "Bot status", [
      `WebSocket latency: ${client.ws.ping} ms`
    ]);

  case "information":
    return panelReply(interaction, "London, Uxbridge", [
      "Welcome to London, Uxbridge.",
      "Please follow the server rules and treat everyone respectfully."
    ]);

  case "rules":
    return panelReply(interaction, "Server rules", [
      "**1. Respect**\nTreat other members respectfully.",
      "**2. Staff instructions**\nFollow legitimate staff instructions.",
      "**3. Conduct**\nDo not spam or disrupt the server.",
      "**4. Channels**\nUse the correct channels.",
      "**5. Discord**\nFollow Discord's Terms of Service."
    ]);

  case "help":
    return interaction.reply({
      content: `Need help? Join our support server: ${SUPPORT_URL}`
    });

  case "host-shift": {
    const action = interaction.options.getString("action");
    const key = `${guild.id}:${user.id}`;

    if (action === "start") {
      if (shifts.has(key)) {
        return panelReply(
          interaction,
          "Shift already active",
          ["You already have a shift in progress."],
          true
        );
      }

      shifts.set(key, { started: Date.now() });

      return panelReply(interaction, "Shift started", [
        `Host: ${user}`,
        `Started: <t:${Math.floor(Date.now() / 1000)}:F>`
      ]);
    }

    const shift = shifts.get(key);

    if (!shift) {
      return panelReply(
        interaction,
        "No active shift",
        ["You do not have a shift in progress."],
        true
      );
    }

    const minutes = Math.floor(
      (Date.now() - shift.started) / 60000
    );

    shifts.delete(key);

    return panelReply(interaction, "Shift ended", [
      `Host: ${user}`,
      `Duration: ${minutes} minutes`
    ]);
  }

  case "shift-stats": {
    const shift = shifts.get(`${guild.id}:${user.id}`);

    return panelReply(interaction, "Shift statistics", [
      `Member: ${user}`,
      shift
        ? `Current shift started <t:${Math.floor(shift.started / 1000)}:R>.`
        : "You have no active shift.",
      "Historical shift totals are not stored."
    ], true);
  }

  case "military-operation": {
    const action = interaction.options.getString("action");
    const name =
      interaction.options.getString("name") || "Untitled operation";

    if (action === "start") {
      if (operations.has(guild.id)) {
        return panelReply(
          interaction,
          "Operation already active",
          [`Current operation: ${operations.get(guild.id).name}`],
          true
        );
      }

      operations.set(guild.id, {
        name,
        leader: user.id,
        started: Date.now()
      });

      return panelReply(interaction, "Operation started", [
        `Name: ${name}`,
        `Leader: ${user}`,
        `Started: <t:${Math.floor(Date.now() / 1000)}:F>`
      ]);
    }

    if (action === "end") {
      const operation = operations.get(guild.id);

      if (!operation) {
        return panelReply(
          interaction,
          "No active operation",
          ["There is no operation to end."],
          true
        );
      }

      operations.delete(guild.id);

      return panelReply(interaction, "Operation ended", [
        `Name: ${operation.name}`,
        `Ended by: ${user}`
      ]);
    }

    const operation = operations.get(guild.id);

    return panelReply(interaction, "Operation status", [
      operation
        ? `Active operation: ${operation.name}\nLeader: <@${operation.leader}>`
        : "There is no active operation."
    ]);
  }

  case "training-session":
    return panelReply(interaction, "Training session", [
      `Organiser: ${user}`,
      interaction.options.getString("details")
    ]);

  case "warn": {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const key = `${guild.id}:${target.id}`;

    if (!warnings.has(key)) warnings.set(key, []);

    warnings.get(key).push({
      reason,
      moderatorId: user.id,
      date: Date.now()
    });

    recordAction(guild.id, target.id, "Warning", reason, user.id);

    return panelReply(interaction, "Warning recorded", [
      `Member: ${target}`,
      `Reason: ${reason}`,
      `Moderator: ${user}`
    ], true);
  }

  case "timeout": {
    const target = interaction.options.getUser("user");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason");
    const member = await guild.members.fetch(target.id);

    await member.timeout(minutes * 60000, reason);

    recordAction(guild.id, target.id, "Timeout", reason, user.id);

    return panelReply(interaction, "Member timed out", [
      `Member: ${target}`,
      `Duration: ${minutes} minutes`,
      `Reason: ${reason}`,
      `Moderator: ${user}`
    ], true);
  }

  case "kick": {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const member = await guild.members.fetch(target.id);

    await member.kick(reason);

    recordAction(guild.id, target.id, "Kick", reason, user.id);

    return panelReply(interaction, "Member kicked", [
      `Member: ${target.tag}`,
      `Reason: ${reason}`,
      `Moderator: ${user}`
    ], true);
  }

  case "ban": {
    const target = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");

    await guild.members.ban(target.id, { reason });

    recordAction(guild.id, target.id, "Ban", reason, user.id);

    return panelReply(interaction, "Member banned", [
      `Member: ${target.tag}`,
      `Reason: ${reason}`,
      `Moderator: ${user}`
    ], true);
  }

  case "purge": {
    const amount = interaction.options.getInteger("amount");

    if (!interaction.channel?.isTextBased()) {
      return panelReply(
        interaction,
        "Cannot purge messages",
        ["This command requires a text channel."],
        true
      );
    }

    const deleted = await interaction.channel.bulkDelete(amount, true);

    return panelReply(interaction, "Messages deleted", [
      `Deleted ${deleted.size} messages.`,
      "Messages older than 14 days cannot be bulk deleted."
    ], true);
  }

  case "userinfo": {
    const target = interaction.options.getUser("user");
    const member = await guild.members.fetch(target.id).catch(() => null);

    return panelReply(interaction, "User information", [
      `Username: ${target.tag}`,
      `User ID: ${target.id}`,
      `Account created: <t:${Math.floor(target.createdTimestamp / 1000)}:F>`,
      member
        ? `Joined server: <t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
        : "This user is not currently a server member."
    ]);
  }

  case "modlogs": {
    const target = interaction.options.getUser("user");
    const records = (modlogs.get(guild.id) || [])
      .filter(record => record.userId === target.id)
      .slice(-10);

    const lines = records.map(record =>
      `**${record.action}** — ${record.reason}\nModerator: <@${record.moderatorId}> · <t:${Math.floor(record.date / 1000)}:R>`
    );

    return panelReply(interaction, "Moderation records", [
      `Member: ${target}`,
      ...(lines.length
        ? lines
        : ["No moderation records found during this session."])
    ], true);
  }

  case "announce": {
    const message = interaction.options.getString("message");

    return panelReply(interaction, "Announcement", [
      message,
      `Published by ${user}`
    ]);
  }
}

} catch (error) {
console.error(
"Command /${interaction.commandName} failed:",
error
);

const response = {
  content: "The command failed. Check the bot console and permissions.",
  flags: MessageFlags.Ephemeral
};

if (interaction.replied || interaction.deferred) {
  await interaction.followUp(response).catch(() => {});
} else {
  await interaction.reply(response).catch(() => {});
}

}
});

client.login(TOKEN).catch(error => {
console.error("Discord login failed:", error);
process.exit(1);
});
