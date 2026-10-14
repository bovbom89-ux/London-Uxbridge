
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
  ButtonStyle,
  ChannelType
} = require("discord.js");

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const BRAND_NAME = "Rover";
const BRAND_COLOR = 0x8B70C8;
const GIVEAWAY_DURATION = 24 * 60 * 60 * 1000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// --------------------------------------------------
// SAVED DATA
// --------------------------------------------------

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Failed to load saved data:", error);
  }

  return {};
}

const saved = loadData();

const data = {
  products: Array.isArray(saved.products) ? saved.products : [],
  giveaways: Array.isArray(saved.giveaways)
    ? saved.giveaways.map(g => ({
        ...g,
        entries: Array.isArray(g.entries) ? g.entries : [],
        ended: Boolean(g.ended)
      }))
    : [],
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

// --------------------------------------------------
// DISCORD CLIENT
// --------------------------------------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const ADMIN = PermissionFlagsBits.Administrator;

function isAdmin(interaction) {
  return Boolean(interaction.memberPermissions?.has(ADMIN));
}

function ephemeralFlags() {
  return MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
}

// --------------------------------------------------
// COMPONENTS V2 PANELS
// --------------------------------------------------

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
    new TextDisplayBuilder().setContent("-# Rover Official Store")
  );

  return container;
}

async function privatePanel(interaction, title, sections) {
  return interaction.reply({
    components: [makePanel(title, sections)],
    flags: ephemeralFlags()
  });
}

function safeText(value, maximum = 1000) {
  return String(value ?? "")
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere")
    .slice(0, maximum);
}

// --------------------------------------------------
// INFORMATION CENTRE
// --------------------------------------------------

const INFORMATION = {
  general: {
    title: "General Information",
    sections: [
      "**Welcome to Rover**",
      "Rover is a digital asset shop where customers can browse available products, review product descriptions and follow the relevant purchasing instructions.",
      "**Our products**\nEach listing explains what is included, the displayed price and any applicable usage conditions. Product availability may change over time.",
      "**Need assistance?**\nIf you have a question about a product, check its listing first and contact the shop team through the support arrangements provided by Rover.",
      "**Please note**\nSubmitting a purchase request or opening a checkout link does not, by itself, confirm that a payment has been completed."
    ]
  },

  rules: {
    title: "Shop Rules",
    sections: [
      "**1. Respect**\nTreat customers, staff and other community members respectfully.",
      "**2. Honest purchases**\nDo not attempt to obtain products through fraudulent payments, false claims or exploitation of technical errors.",
      "**3. Product licences**\nRespect the permissions and licence conditions supplied with every asset.",
      "**4. Distribution**\nDo not redistribute, resell or publicly share purchased files unless the relevant licence expressly allows it.",
      "**5. Support**\nProvide accurate information when asking staff for assistance.",
      "**6. Enforcement**\nSerious or repeated abuse may result in access to shop services being restricted."
    ]
  },

  purchase: {
    title: "Purchasing Guide",
    sections: [
      "**Step 1 — Browse**\nUse `/products` to view available products and their descriptions.",
      "**Step 2 — Review**\nCheck the product ID, price, contents, compatibility and usage restrictions before proceeding.",
      "**Step 3 — Purchase**\nUse `/purchase-product` with the relevant product ID. If the listing has a checkout URL, Rover will provide it privately.",
      "**Step 4 — Complete checkout**\nFollow the payment provider's instructions. Rover does not process or verify payments automatically in this version.",
      "**Step 5 — Delivery**\nFollow the product's delivery instructions or contact the shop team if delivery assistance is required.",
      "**Problems?**\nKeep your order confirmation and any relevant transaction reference when contacting support."
    ]
  },

  terms: {
    title: "Terms of Service",
    sections: [
      "**Product descriptions**\nCustomers should review the listing, price, included files and licence before purchasing.",
      "**Digital products**\nDigital assets may be subject to individual usage restrictions. Purchasing an asset does not automatically transfer copyright or unrestricted ownership.",
      "**Payment and delivery**\nA purchase link or purchase request is not proof of payment. Orders must be confirmed through the applicable payment or fulfilment process.",
      "**Refunds and cancellations**\nRefunds, cancellations and replacements are handled according to the shop's published policy and applicable consumer law. Any policy should be reviewed before checkout.",
      "**Misuse**\nFraudulent transactions, unauthorised redistribution and deliberate abuse of shop systems are prohibited.",
      "**Changes**\nProduct availability and terms may change. Applicable consumer rights remain unaffected."
    ]
  },

  disclaimer: {
    title: "Disclaimer",
    sections: [
      "**Digital assets**\nRover lists digital products according to the descriptions and permissions provided for each listing.",
      "**Third-party rights**\nNames, logos, trademarks and third-party assets remain the property of their respective owners. Rover does not claim ownership of material it is not authorised to own.",
      "**Compatibility**\nCustomers should check compatibility and requirements before purchasing.",
      "**External links**\nCheckout links may lead to third-party services. Review the destination and its terms before providing payment information.",
      "**No automatic payment verification**\nThis version of Rover does not independently verify payments made through external checkout links."
    ]
  }
};

function informationPanel() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("rover_information")
    .setPlaceholder("Select an information category")
    .addOptions(
      {
        label: "General Information",
        value: "general",
        description: "Learn about Rover and its products"
      },
      {
        label: "Shop Rules",
        value: "rules",
        description: "Read the shop rules"
      },
      {
        label: "Purchasing Guide",
        value: "purchase",
        description: "Learn how to purchase products"
      },
      {
        label: "Terms of Service",
        value: "terms",
        description: "Review purchase conditions"
      },
      {
        label: "Disclaimer",
        value: "disclaimer",
        description: "Asset ownership and responsibility"
      }
    );

  const container = makePanel("Rover Information", [
    "**Official Store Information**",
    "Welcome to **Rover**, your destination for digital assets.",
    "Browse the information below to learn about our products, purchasing process and policies.",
    "**Select an information category**\nChoose an option below to receive a detailed, private information message."
  ]);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(menu)
  );

  return container;
}

// --------------------------------------------------
// PRODUCT UTILITIES
// --------------------------------------------------

function getProduct(id) {
  return data.products.find(product => product.id === id);
}

function formatProduct(product) {
  return [
    `**Product ID:** ${product.id}`,
    `**Product:** ${safeText(product.name, 100)}`,
    `**Price:** ${safeText(product.price, 50)}`,
    `**Description:**\n${safeText(product.description, 1000)}`,
    product.purchaseUrl
      ? `**Purchase link:** ${product.purchaseUrl}`
      : "**Purchase link:** Contact the shop team for purchasing instructions.",
    product.asset
      ? `**Delivery information:** ${safeText(product.asset, 500)}`
      : null
  ].filter(Boolean);
}

function validateUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

// --------------------------------------------------
// GIVEAWAYS
// --------------------------------------------------

function giveawayPanel(giveaway) {
  const ended = giveaway.ended || giveaway.endsAt <= Date.now();

  const container = makePanel(
    ended ? "Giveaway Ended" : "Rover Giveaway",
    [
      `**Prize:** ${safeText(giveaway.prize, 200)}`,
      `**Hosted by:** <@${giveaway.hostId}>`,
      `**Entries:** ${giveaway.entries.length}`,
      ended
        ? "This giveaway has ended."
        : `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:F>\n**Remaining:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
      giveaway.winnerId
        ? `**Winner:** <@${giveaway.winnerId}>`
        : ended
          ? "The giveaway is closed."
          : "Select the button below to enter. A winner will be selected when the giveaway ends."
    ]
  );

  if (!ended) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rover_enter_${giveaway.id}`)
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
      components: [giveawayPanel(giveaway)]
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

  if (giveaway.entries.length > 0) {
    giveaway.winnerId =
      giveaway.entries[
        Math.floor(Math.random() * giveaway.entries.length)
      ];
  }

  saveData();
  await updateGiveawayMessage(giveaway);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);

    if (channel?.isTextBased()) {
      const winnerMessage = giveaway.winnerId
        ? `Congratulations <@${giveaway.winnerId}>! You won the giveaway.`
        : "The giveaway ended without any entries.";

      await channel.send({
        components: [
          makePanel("Giveaway Results", [
            `**Prize:** ${safeText(giveaway.prize, 200)}`,
            winnerMessage
          ])
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
          users: giveaway.winnerId ? [giveaway.winnerId] : []
        }
      });
    }
  } catch (error) {
    console.error("Could not publish giveaway results:", error);
  }
}

function scheduleGiveaway(giveaway) {
  if (giveaway.ended) return;

  const remaining = giveaway.endsAt - Date.now();

  if (remaining <= 0) {
    finishGiveaway(giveaway).catch(console.error);
    return;
  }

  setTimeout(() => {
    if (giveaway.endsAt <= Date.now()) {
      finishGiveaway(giveaway).catch(console.error);
    } else {
      scheduleGiveaway(giveaway);
    }
  }, Math.min(remaining, 2147483647));
}

// --------------------------------------------------
// SLASH COMMANDS
// --------------------------------------------------

const commands = [
  new SlashCommandBuilder()
    .setName("create-product")
    .setDescription("Create a Rover product listing")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o =>
      o.setName("name")
        .setDescription("Product name")
        .setRequired(true)
        .setMaxLength(100)
    )
    .addStringOption(o =>
      o.setName("description")
        .setDescription("Product description")
        .setRequired(true)
        .setMaxLength(1000)
    )
    .addStringOption(o =>
      o.setName("price")
        .setDescription("Displayed price, for example £5.00")
        .setRequired(true)
        .setMaxLength(50)
    )
    .addStringOption(o =>
      o.setName("purchase_url")
        .setDescription("HTTPS checkout or purchase link")
        .setRequired(false)
        .setMaxLength(500)
    )
    .addStringOption(o =>
      o.setName("delivery")
        .setDescription("Delivery details or instructions")
        .setRequired(false)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("delete-product")
    .setDescription("Delete a Rover product listing")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Product ID")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("give-product")
    .setDescription("Send product details to a customer")
    .setDefaultMemberPermissions(ADMIN)
    .addUserOption(o =>
      o.setName("customer")
        .setDescription("Customer receiving the product")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Product ID")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a 24-hour asset giveaway")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o =>
      o.setName("prize")
        .setDescription("Giveaway prize")
        .setRequired(true)
        .setMaxLength(200)
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel to publish the giveaway")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Publish Rover's information panel")
    .setDefaultMemberPermissions(ADMIN)
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel to publish the panel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("products")
    .setDescription("Browse Rover's available products"),

  new SlashCommandBuilder()
    .setName("purchase-product")
    .setDescription("View purchasing information for a product")
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Product ID")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("edit-product")
    .setDescription("Edit an existing product listing")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(o =>
      o.setName("id")
        .setDescription("Product ID")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription("New product name")
        .setRequired(false)
        .setMaxLength(100)
    )
    .addStringOption(o =>
      o.setName("description")
        .setDescription("New product description")
        .setRequired(false)
        .setMaxLength(1000)
    )
    .addStringOption(o =>
      o.setName("price")
        .setDescription("New displayed price")
        .setRequired(false)
        .setMaxLength(50)
    )
    .addStringOption(o =>
      o.setName("purchase_url")
        .setDescription("New HTTPS checkout link")
        .setRequired(false)
        .setMaxLength(500)
    )
    .addStringOption(o =>
      o.setName("delivery")
        .setDescription("New delivery instructions")
        .setRequired(false)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName("end-giveaway")
    .setDescription("End a Rover giveaway early")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o =>
      o.setName("id")
        .setDescription("Giveaway ID shown when it is created")
        .setRequired(true)
        .setMaxLength(100)
    ),

  new SlashCommandBuilder()
    .setName("shop-info")
    .setDescription("View Rover shop statistics")
    .setDefaultMemberPermissions(ADMIN)
];

// --------------------------------------------------
// READY AND REGISTRATION
// --------------------------------------------------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log("Registering Rover guild commands...");

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      {
        body: commands.map(command => command.toJSON())
      }
    );

    console.log(`Registered ${commands.length} Rover commands.`);
    console.log(`Guild ID: ${GUILD_ID}`);
    console.log(`Application ID: ${CLIENT_ID}`);
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  for (const giveaway of data.giveaways) {
    if (!giveaway.ended) scheduleGiveaway(giveaway);
  }
});

// --------------------------------------------------
// INTERACTIONS
// --------------------------------------------------

client.on("interactionCreate", async interaction => {
  try {
    // ----------------------------------------------
    // INFORMATION DROPDOWN
    // Send detailed private replies; keep public panel.
    // ----------------------------------------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "rover_information"
    ) {
      const section = INFORMATION[interaction.values[0]];

      if (!section) {
        return privatePanel(
          interaction,
          "Information Unavailable",
          ["Please select a valid information category."]
        );
      }

      return privatePanel(
        interaction,
        section.title,
        section.sections
      );
    }

    // ----------------------------------------------
    // GIVEAWAY BUTTON
    // ----------------------------------------------

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("rover_enter_")
    ) {
      const id = interaction.customId.slice("rover_enter_".length);

      const giveaway = data.giveaways.find(g => g.id === id);

      if (!giveaway || giveaway.ended || giveaway.endsAt <= Date.now()) {
        if (giveaway && !giveaway.ended) {
          await finishGiveaway(giveaway);
        }

        return privatePanel(
          interaction,
          "Giveaway Closed",
          ["This giveaway has ended or is unavailable."]
        );
      }

      if (giveaway.entries.includes(interaction.user.id)) {
        return privatePanel(
          interaction,
          "Already Entered",
          ["You have already entered this giveaway."]
        );
      }

      giveaway.entries.push(interaction.user.id);
      saveData();

      await interaction.update({
        components: [giveawayPanel(giveaway)]
      });

      return interaction.followUp({
        components: [
          makePanel("Entry Confirmed", [
            "Your entry has been recorded. Good luck!"
          ])
        ],
        flags: ephemeralFlags()
      });
    }

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.inGuild()) {
      return privatePanel(
        interaction,
        "Server Required",
        ["Please use this command inside a Discord server."]
      );
    }

    const commandName = interaction.commandName;

    const adminCommands = [
      "create-product",
      "delete-product",
      "give-product",
      "giveaway",
      "information",
      "edit-product",
      "end-giveaway",
      "shop-info"
    ];

    if (adminCommands.includes(commandName) && !isAdmin(interaction)) {
      return privatePanel(
        interaction,
        "Permission Denied",
        ["You need the **Administrator** permission to use this command."]
      );
    }

    // ----------------------------------------------
    // CREATE PRODUCT
    // ----------------------------------------------

    if (commandName === "create-product") {
      const name = interaction.options.getString("name", true);
      const description = interaction.options.getString("description", true);
      const price = interaction.options.getString("price", true);
      const rawUrl = interaction.options.getString("purchase_url");
      const delivery = interaction.options.getString("delivery") || "";

      const purchaseUrl = validateUrl(rawUrl);

      if (rawUrl && !purchaseUrl) {
        return privatePanel(
          interaction,
          "Invalid Purchase Link",
          ["Use a valid HTTP or HTTPS URL."]
        );
      }

      const product = {
        id: data.nextProductId++,
        name,
        description,
        price,
        purchaseUrl,
        asset: delivery,
        createdBy: interaction.user.id,
        createdAt: Date.now()
      };

      data.products.push(product);
      saveData();

      return privatePanel(
        interaction,
        "Product Created",
        [
          `**Product ID:** ${product.id}`,
          ...formatProduct(product),
          "Your product has been saved."
        ]
      );
    }

    // ----------------------------------------------
    // DELETE PRODUCT
    // ----------------------------------------------

    if (commandName === "delete-product") {
      const id = interaction.options.getInteger("id", true);
      const index = data.products.findIndex(p => p.id === id);

      if (index === -1) {
        return privatePanel(
          interaction,
          "Product Not Found",
          [`No product with ID **${id}** exists.`]
        );
      }

      const [product] = data.products.splice(index, 1);
      saveData();

      return privatePanel(
        interaction,
        "Product Deleted",
        [`**${product.name}** (ID: ${product.id}) has been removed.`]
      );
    }

    // ----------------------------------------------
    // GIVE PRODUCT
    // ----------------------------------------------

    if (commandName === "give-product") {
      const customer = interaction.options.getUser("customer", true);
      const id = interaction.options.getInteger("id", true);
      const product = getProduct(id);

      if (!product) {
        return privatePanel(
          interaction,
          "Product Not Found",
          [`No product with ID **${id}** exists.`]
        );
      }

      try {
        await customer.send({
          components: [
            makePanel("Your Rover Product", [
              `Hello ${safeText(customer.username, 100)}, Rover staff have issued you the following product.`,
              ...formatProduct(product)
            ])
          ],
          flags: MessageFlags.IsComponentsV2
        });
      } catch {
        return privatePanel(
          interaction,
          "Delivery Failed",
          [
            `I couldn't send a direct message to ${customer}.`,
            "They may have DMs disabled. No product details were delivered."
          ]
        );
      }

      return privatePanel(
        interaction,
        "Product Delivered",
        [
          `**Product:** ${product.name}`,
          `**Customer:** ${customer}`,
          "The product details were sent by direct message."
        ]
      );
    }

    // ----------------------------------------------
    // PUBLISH INFORMATION PANEL
    // ----------------------------------------------

    if (commandName === "information") {
      const channel = interaction.options.getChannel("channel", true);

      await channel.send({
        components: [informationPanel()],
        flags: MessageFlags.IsComponentsV2
      });

      return privatePanel(
        interaction,
        "Information Panel Published",
        [`The Rover information panel has been posted in ${channel}.`]
      );
    }

    // ----------------------------------------------
    // PUBLIC PRODUCT CATALOGUE
    // ----------------------------------------------

    if (commandName === "products") {
      if (data.products.length === 0) {
        return privatePanel(
          interaction,
          "Rover Products",
          [
            "There are currently no listed products.",
            "Please check back later."
          ]
        );
      }

      const visibleProducts = data.products.slice(0, 25);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("rover_product_details")
        .setPlaceholder("Select a product to view its details")
        .addOptions(
          visibleProducts.map(product => ({
            label: safeText(product.name, 100),
            value: String(product.id),
            description: safeText(
              `ID ${product.id} · ${product.price}`,
              100
            )
          }))
        );

      const container = makePanel("Rover Product Catalogue", [
        `**Available products:** ${data.products.length}`,
        "Choose a product below to view its full description and purchasing information.",
        data.products.length > 25
          ? "Showing the first 25 products. Contact the shop team for additional listings."
          : "Use `/purchase-product` with a product ID to see its purchasing information."
      ]);

      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(menu)
      );

      return interaction.reply({
        components: [container],
        flags: ephemeralFlags()
      });
    }

    // ----------------------------------------------
    // PRODUCT DETAILS DROPDOWN
    // ----------------------------------------------

    if (commandName === "purchase-product") {
      const id = interaction.options.getInteger("id", true);
      const product = getProduct(id);

      if (!product) {
        return privatePanel(
          interaction,
          "Product Not Found",
          [
            `No product with ID **${id}** exists.`,
            "Use `/products` to browse the available listings."
          ]
        );
      }

      const sections = [
        ...formatProduct(product),
        product.purchaseUrl
          ? "**Next step**\nOpen the purchase link above and follow the checkout provider's instructions. Rover does not verify payment automatically."
          : "**Next step**\nThis product has no checkout URL configured. Contact the shop team for purchasing instructions.",
        "**Important**\nReview the listing and licence before proceeding. A displayed link does not guarantee availability or confirm payment."
      ];

      return privatePanel(
        interaction,
        "Purchase Product",
        sections
      );
    }

    // ----------------------------------------------
    // PRODUCT CATALOGUE SELECT MENU
    // ----------------------------------------------

    // Select menus are handled below, outside chat commands.
    // ----------------------------------------------

    // ----------------------------------------------
    // EDIT PRODUCT
    // ----------------------------------------------

    if (commandName === "edit-product") {
      const id = interaction.options.getInteger("id", true);
      const product = getProduct(id);

      if (!product) {
        return privatePanel(
          interaction,
          "Product Not Found",
          [`No product with ID **${id}** exists.`]
        );
      }

      const name = interaction.options.getString("name");
      const description = interaction.options.getString("description");
      const price = interaction.options.getString("price");
      const rawUrl = interaction.options.getString("purchase_url");
      const delivery = interaction.options.getString("delivery");

      if (
        name === null &&
        description === null &&
        price === null &&
        rawUrl === null &&
        delivery === null
      ) {
        return privatePanel(
          interaction,
          "Nothing to Change",
          ["Supply at least one field to update."]
        );
      }

      let purchaseUrl;

      if (rawUrl !== null) {
        purchaseUrl = validateUrl(rawUrl);

        if (!purchaseUrl) {
          return privatePanel(
            interaction,
            "Invalid Purchase Link",
            ["Use a valid HTTP or HTTPS URL."]
          );
        }
      }

      if (name !== null) product.name = name;
      if (description !== null) product.description = description;
      if (price !== null) product.price = price;
      if (rawUrl !== null) product.purchaseUrl = purchaseUrl;
      if (delivery !== null) product.asset = delivery;

      saveData();

      return privatePanel(
        interaction,
        "Product Updated",
        formatProduct(product)
      );
    }

    // ----------------------------------------------
    // GIVEAWAY CREATION
    // ----------------------------------------------

    if (commandName === "giveaway") {
      const prize = interaction.options.getString("prize", true);
      const channel = interaction.options.getChannel("channel", true);

      const giveaway = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prize,
        hostId: interaction.user.id,
        channelId: channel.id,
        messageId: null,
        entries: [],
        endsAt: Date.now() + GIVEAWAY_DURATION,
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

      return privatePanel(
        interaction,
        "Giveaway Created",
        [
          `**Prize:** ${safeText(prize, 200)}`,
          `**Channel:** ${channel}`,
          `**Giveaway ID:** ${giveaway.id}`,
          `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:F>`,
          "The giveaway will close automatically after 24 hours."
        ]
      );
    }

    // ----------------------------------------------
    // END GIVEAWAY EARLY
    // ----------------------------------------------

    if (commandName === "end-giveaway") {
      const id = interaction.options.getString("id", true);
      const giveaway = data.giveaways.find(g => g.id === id);

      if (!giveaway) {
        return privatePanel(
          interaction,
          "Giveaway Not Found",
          [
            "No giveaway matches that ID.",
            "Use the ID provided when the giveaway was created."
          ]
        );
      }

      if (giveaway.ended) {
        return privatePanel(
          interaction,
          "Giveaway Already Ended",
          ["This giveaway has already ended."]
        );
      }

      await finishGiveaway(giveaway);

      return privatePanel(
        interaction,
        "Giveaway Ended",
        [
          `**Prize:** ${safeText(giveaway.prize, 200)}`,
          giveaway.winnerId
            ? `**Winner:** <@${giveaway.winnerId}>`
            : "No entries were recorded."
        ]
      );
    }

    // ----------------------------------------------
    // SHOP STATISTICS
    // ----------------------------------------------

    if (commandName === "shop-info") {
      const activeGiveaways = data.giveaways.filter(
        g => !g.ended && g.endsAt > Date.now()
      ).length;

      return privatePanel(
        interaction,
        "Rover Shop Statistics",
        [
          `**Products listed:** ${data.products.length}`,
          `**Giveaways stored:** ${data.giveaways.length}`,
          `**Active giveaways:** ${activeGiveaways}`,
          `**Next product ID:** ${data.nextProductId}`
        ]
      );
    }
  } catch (error) {
    console.error(
      `Interaction ${interaction.commandName || interaction.customId} failed:`,
      error
    );

    const response = {
      components: [
        makePanel("Something Went Wrong", [
          "The request could not be completed. Please try again or check the bot console."
        ])
      ],
      flags: ephemeralFlags()
    };

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

// --------------------------------------------------
// PRODUCT CATALOGUE SELECT MENU
// This separate listener sends detailed product info
// privately and leaves the catalogue message intact.
// --------------------------------------------------

client.on("interactionCreate", async interaction => {
  if (
    !interaction.isStringSelectMenu() ||
    interaction.customId !== "rover_product_details"
  ) {
    return;
  }

  try {
    const id = Number(interaction.values[0]);
    const product = getProduct(id);

    if (!product) {
      return privatePanel(
        interaction,
        "Product Unavailable",
        ["This product no longer exists."]
      );
    }

    return privatePanel(
      interaction,
      "Product Details",
      [
        ...formatProduct(product),
        "**How to purchase**\nUse `/purchase-product` with this product ID to view its purchasing instructions.",
        "**Please note**\nRover does not automatically process or verify payments in this version."
      ]
    );
  } catch (error) {
    console.error("Product selection failed:", error);

    if (!interaction.replied && !interaction.deferred) {
      await privatePanel(
        interaction,
        "Product Unavailable",
        ["Could not load this product. Please try again."]
      ).catch(() => {});
    }
  }
});

// --------------------------------------------------
// LOGIN
// --------------------------------------------------

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
