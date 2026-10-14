
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
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const BRAND_COLOR = 0x8B70C8;
const BRAND_NAME = "Rover";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Could not load saved data:", error);
  }

  return {};
}

const saved = loadData();

const data = {
  products: Array.isArray(saved.products) ? saved.products : [],
  giveaways: Array.isArray(saved.giveaways) ? saved.giveaways : [],
  nextProductId: Number(saved.nextProductId) || 1
};

function saveData() {
  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temporaryFile, DATA_FILE);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// All administrative commands require Discord Administrator permission.
function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

function makePanel(title, sections = []) {
  const container = new ContainerBuilder()
    .setAccentColor(BRAND_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${title}`)
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
    new TextDisplayBuilder().setContent(`-# ${BRAND_NAME} Official Store`)
  );

  return container;
}

function addRow(container, row) {
  container.addActionRowComponents(row);
  return container;
}

function informationPanel(section = "home") {
  const sections = {
    home: [
      "Welcome to **Rover**, your destination for digital assets.",
      "Browse the information below to learn about our products, purchasing process and policies.",
      "**Select an information category**"
    ],
    general: [
      "**General Information**",
      "Rover is a digital asset shop offering products described in our product listings. Available products, prices and delivery arrangements may vary.",
      "Please read each product listing carefully before making a purchase."
    ],
    rules: [
      "**Shop Rules**",
      "1. Treat customers and staff respectfully.",
      "2. Read product descriptions before purchasing.",
      "3. Do not exploit bugs, abuse giveaways or attempt to obtain products fraudulently.",
      "4. Do not redistribute or resell assets unless your licence permits it.",
      "5. Contact support if you experience an issue."
    ],
    purchase: [
      "**Purchasing Guide**",
      "1. Browse the available product listings.",
      "2. Review the product description, price and usage conditions.",
      "3. Follow the purchase instructions provided by Rover.",
      "4. Follow the delivery instructions supplied for your order.",
      "5. Contact staff if your product does not arrive or you need assistance."
    ],
    terms: [
      "**Terms of Service**",
      "By purchasing a product, you agree to the applicable product description and licence conditions.",
      "Do not redistribute, resell or claim ownership of assets unless expressly permitted.",
      "Refunds, cancellations and replacements are handled according to the published policy and applicable law."
    ],
    disclaimer: [
      "**Disclaimer**",
      "Rover provides digital products subject to the descriptions and permissions stated in their listings.",
      "Third-party names, trademarks and assets remain the property of their respective owners. Rover does not claim ownership of third-party material without authorisation.",
      "Customers are responsible for checking compatibility and permitted use before purchasing."
    ]
  };

  const menu = new StringSelectMenuBuilder()
    .setCustomId("rover_information")
    .setPlaceholder("Select an information category")
    .addOptions(
      {
        label: "General Information",
        value: "general",
        description: "Learn about Rover"
      },
      {
        label: "Shop Rules",
        value: "rules",
        description: "Read the shop rules"
      },
      {
        label: "Purchasing Guide",
        value: "purchase",
        description: "How purchasing and delivery work"
      },
      {
        label: "Terms of Service",
        value: "terms",
        description: "Review product terms"
      },
      {
        label: "Disclaimer",
        value: "disclaimer",
        description: "Ownership and responsibility"
      }
    );

  const container = makePanel(
    section === "home"
      ? "Rover Information"
      : "Rover Information",
    sections[section] || sections.home
  );

  return addRow(
    container,
    new ActionRowBuilder().addComponents(menu)
  );
}

function productById(id) {
  return data.products.find(product => product.id === id);
}

function productDescription(product) {
  return [
    `**Product:** ${product.name}`,
    `**Price:** ${product.price}`,
    `**Description:** ${product.description}`,
    product.asset
      ? `**Delivery information:** ${product.asset}`
      : "**Delivery information:** Contact the shop staff for delivery."
  ].join("\n");
}

function giveawayPanel(giveaway) {
  const ended = giveaway.endsAt <= Date.now();

  const container = makePanel(
    ended ? "Giveaway Ended" : "Rover Giveaway",
    [
      `**Prize:** ${giveaway.prize}`,
      `**Hosted by:** <@${giveaway.hostId}>`,
      `**Entries:** ${giveaway.entries.length}`,
      ended
        ? "This giveaway has ended."
        : `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:F>\n**Time remaining:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
      giveaway.winnerId
        ? `**Winner:** <@${giveaway.winnerId}>`
        : "Enter using the button below. One winner will be selected when the giveaway ends."
    ]
  );

  if (!ended) {
    addRow(
      container,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rover_giveaway_${giveaway.id}`)
          .setLabel("Enter Giveaway")
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  return container;
}

async function updateGiveawayMessage(giveaway) {
  if (!giveaway.channelId || !giveaway.messageId) return;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel?.isTextBased()) return;

    const message = await channel.messages.fetch(giveaway.messageId);

    await message.edit({
      components: [giveawayPanel(giveaway)],
      flags: MessageFlags.IsComponentsV2
    });
  } catch (error) {
    console.error(
      `Could not update giveaway ${giveaway.id}:`,
      error.message
    );
  }
}

async function finishGiveaway(giveaway) {
  if (giveaway.ended) return;

  giveaway.ended = true;

  let winner = null;

  if (giveaway.entries.length > 0) {
    const winnerId =
      giveaway.entries[
        Math.floor(Math.random() * giveaway.entries.length)
      ];

    giveaway.winnerId = winnerId;

    try {
      winner = await client.users.fetch(winnerId);
    } catch {
      winner = null;
    }
  }

  saveData();
  await updateGiveawayMessage(giveaway);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);

    if (channel?.isTextBased()) {
      await channel.send({
        components: [
          makePanel(
            "Giveaway Results",
            [
              `**Prize:** ${giveaway.prize}`,
              winner
                ? `Congratulations <@${winner.id}>! You won the giveaway.`
                : "The giveaway ended without any entries."
            ]
          )
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
          users: winner ? [winner.id] : []
        }
      });
    }
  } catch (error) {
    console.error("Could not announce giveaway results:", error);
  }
}

function scheduleGiveaway(giveaway) {
  if (giveaway.ended) return;

  const remaining = giveaway.endsAt - Date.now();

  if (remaining <= 0) {
    finishGiveaway(giveaway).catch(console.error);
    return;
  }

  // Keep timers within Node.js timer limits.
  setTimeout(() => {
    if (giveaway.endsAt <= Date.now()) {
      finishGiveaway(giveaway).catch(console.error);
    } else {
      scheduleGiveaway(giveaway);
    }
  }, Math.min(remaining, 2147483647));
}

const commands = [
  new SlashCommandBuilder()
    .setName("create-product")
    .setDescription("Create a Rover product listing")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("name")
        .setDescription("Product name")
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(option =>
      option.setName("description")
        .setDescription("Product description")
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addStringOption(option =>
      option.setName("price")
        .setDescription("Displayed price, for example £5.00")
        .setRequired(true)
        .setMaxLength(50)
    )
    .addStringOption(option =>
      option.setName("asset")
        .setDescription("Delivery URL or delivery instructions")
        .setRequired(false)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("delete-product")
    .setDescription("Delete a Rover product listing")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Product ID")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("give-product")
    .setDescription("Send a product to a customer")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName("customer")
        .setDescription("Customer receiving the product")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("id")
        .setDescription("Product ID")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a 24-hour asset giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName("prize")
        .setDescription("Giveaway prize")
        .setRequired(true)
        .setMaxLength(200)
    )
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Channel to publish the giveaway in")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Publish Rover's information panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Channel to publish the panel in")
        .setRequired(true)
    )
];

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log(`Registered ${commands.length} Rover commands.`);
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  for (const giveaway of data.giveaways) {
    if (!giveaway.ended) scheduleGiveaway(giveaway);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!interaction.inGuild()) {
        return interaction.reply({
          components: [
            makePanel("Server Required", [
              "Please use Rover commands inside a Discord server."
            ])
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
      }

      if (!isAdmin(interaction)) {
        return interaction.reply({
          components: [
            makePanel("Permission Denied", [
              "You need the **Administrator** permission to use this command."
            ])
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
      }

      switch (interaction.commandName) {
        case "create-product": {
          const name = interaction.options.getString("name", true);
          const description = interaction.options.getString("description", true);
          const price = interaction.options.getString("price", true);
          const asset = interaction.options.getString("asset") || "";

          const product = {
            id: data.nextProductId++,
            name,
            description,
            price,
            asset,
            createdBy: interaction.user.id,
            createdAt: Date.now()
          };

          data.products.push(product);
          saveData();

          return interaction.reply({
            components: [
              makePanel("Product Created", [
                `**Product ID:** ${product.id}`,
                productDescription(product),
                "The product has been saved."
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }

        case "delete-product": {
          const id = interaction.options.getInteger("id", true);
          const index = data.products.findIndex(product => product.id === id);

          if (index === -1) {
            return interaction.reply({
              components: [
                makePanel("Product Not Found", [
                  `No product with ID **${id}** exists.`
                ])
              ],
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
          }

          const [deleted] = data.products.splice(index, 1);
          saveData();

          return interaction.reply({
            components: [
              makePanel("Product Deleted", [
                `**${deleted.name}** (ID: ${deleted.id}) has been deleted.`
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }

        case "give-product": {
          const customer = interaction.options.getUser("customer", true);
          const id = interaction.options.getInteger("id", true);
          const product = productById(id);

          if (!product) {
            return interaction.reply({
              components: [
                makePanel("Product Not Found", [
                  `No product with ID **${id}** exists.`
                ])
              ],
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
          }

          try {
            await customer.send({
              components: [
                makePanel("Your Rover Product", [
                  `Hello ${customer.username}, a product has been issued to you by Rover staff.`,
                  productDescription(product)
                ])
              ],
              flags: MessageFlags.IsComponentsV2
            });
          } catch {
            return interaction.reply({
              components: [
                makePanel("Delivery Failed", [
                  `I could not DM ${customer}. They may have direct messages disabled. No product was delivered.`
                ])
              ],
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
          }

          return interaction.reply({
            components: [
              makePanel("Product Delivered", [
                `**Product:** ${product.name}`,
                `**Customer:** ${customer}`,
                "The product details were sent by direct message."
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }

        case "giveaway": {
          const prize = interaction.options.getString("prize", true);
          const channel = interaction.options.getChannel("channel", true);

          if (!channel.isTextBased() || !channel.isSendable()) {
            return interaction.reply({
              components: [
                makePanel("Invalid Channel", [
                  "Please select a channel where Rover can send messages."
                ])
              ],
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
          }

          const giveaway = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            prize,
            hostId: interaction.user.id,
            channelId: channel.id,
            messageId: null,
            entries: [],
            endsAt: Date.now() + 24 * 60 * 60 * 1000,
            ended: false,
            winnerId: null
          };

          const message = await channel.send({
            components: [giveawayPanel(giveaway)],
            flags: MessageFlags.IsComponentsV2
          });

          giveaway.messageId = message.id;
          data.giveaways.push(giveaway);
          saveData();
          scheduleGiveaway(giveaway);

          return interaction.reply({
            components: [
              makePanel("Giveaway Created", [
                `**Prize:** ${prize}`,
                `**Channel:** ${channel}`,
                `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:F>`,
                "The giveaway will automatically close after 24 hours."
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }

        case "information": {
          const channel = interaction.options.getChannel("channel", true);

          if (!channel.isTextBased() || !channel.isSendable()) {
            return interaction.reply({
              components: [
                makePanel("Invalid Channel", [
                  "Please select a channel where Rover can send messages."
                ])
              ],
              flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
          }

          await channel.send({
            components: [informationPanel()],
            flags: MessageFlags.IsComponentsV2
          });

          return interaction.reply({
            components: [
              makePanel("Information Panel Published", [
                `The Rover information panel has been posted in ${channel}.`
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === "rover_information") {
        const section = interaction.values[0];

        return interaction.update({
          components: [informationPanel(section)],
          flags: MessageFlags.IsComponentsV2
        });
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("rover_giveaway_")) {
        const giveawayId = interaction.customId.slice(
          "rover_giveaway_".length
        );

        const giveaway = data.giveaways.find(
          item => item.id === giveawayId
        );

        if (!giveaway || giveaway.ended || giveaway.endsAt <= Date.now()) {
          if (giveaway && !giveaway.ended) {
            await finishGiveaway(giveaway);
          }

          return interaction.reply({
            components: [
              makePanel("Giveaway Closed", [
                "This giveaway has ended or is no longer available."
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }

        if (giveaway.entries.includes(interaction.user.id)) {
          return interaction.reply({
            components: [
              makePanel("Already Entered", [
                "You have already entered this giveaway."
              ])
            ],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
          });
        }

        giveaway.entries.push(interaction.user.id);
        saveData();

        await interaction.update({
          components: [giveawayPanel(giveaway)],
          flags: MessageFlags.IsComponentsV2
        });
      }
    }
  } catch (error) {
    console.error("Interaction failed:", error);

    const response = {
      components: [
        makePanel("Something Went Wrong", [
          "The request could not be completed. Please check the bot console and permissions."
        ])
      ],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
