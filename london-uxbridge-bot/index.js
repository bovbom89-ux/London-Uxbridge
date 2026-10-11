const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

// Read configuration from the hosting provider.
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID =
  process.env.DISCORD_GUILD_ID || process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing required environment variables.");
  console.error("Required: DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const COLOUR = 0x1F4E79;
const FOOTER = "London, Uxbridge";

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(COLOUR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
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
    .setDescription("View available commands")
];

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log(`Successfully registered ${commands.length} slash commands.`);
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "ping":
        await interaction.reply({
          embeds: [
            makeEmbed(
              "Bot Status",
              `Latency: ${client.ws.ping} ms`
            )
          ]
        });
        break;

      case "information":
        await interaction.reply({
          embeds: [
            makeEmbed(
              "London, Uxbridge",
              "Welcome to London, Uxbridge. Please follow the server rules and treat everyone respectfully."
            )
          ]
        });
        break;

      case "rules":
        await interaction.reply({
          embeds: [
            makeEmbed(
              "Server Rules",
              "1. Treat everyone respectfully.\n2. Follow staff instructions.\n3. Do not spam or disrupt the server.\n4. Use the correct channels.\n5. Follow Discord's Terms of Service."
            )
          ]
        });
        break;

      case "help":
        await interaction.reply({
          embeds: [
            makeEmbed(
              "Command Directory",
              commands.map(command => `/${command.name}`).join("\n")
            )
          ],
          ephemeral: true
        });
        break;
    }
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);

    const response = {
      content: "The command failed. Please check the bot console.",
      ephemeral: true
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
