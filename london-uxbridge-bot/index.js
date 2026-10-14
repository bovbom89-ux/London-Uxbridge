
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
  ChannelType,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder
} = require("discord.js");

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

// ==================================================
// CONFIGURATION
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const BRAND_NAME = "Rover";
const BRAND_COLOR = 0x8B70C8;
const GIVEAWAY_DURATION = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 25;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

// ==================================================
// DATA STORAGE
// ==================================================

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};

    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    console.error("Failed to load saved data:", error);
    return {};
  }
}

const saved = loadData();

const data = {
  products: Array.isArray(saved.products)
    ? saved.products.map(product => ({
        ...product,
        imageUrl: product.imageUrl || ""
      }))
    : [],

  giveaways: Array.isArray(saved.giveaways)
    ? saved.giveaways.map(giveaway => ({
        ...giveaway,
        entries: Array.isArray(giveaway.entries)
          ? giveaway.entries
          : [],
        ended: Boolean(giveaway.ended)
      }))
    : [],

  nextProductId: Math.max(
    Number(saved.nextProductId) || 1,
    (Array.isArray(saved.products)
      ? saved.products.reduce(
          (maximum, product) =>
            Math.max(maximum, Number(product.id) || 0),
          0
        ) + 1
      : 1)
  )
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

// ==================================================
// CLIENT AND HELPERS
// ==================================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const ADMIN = PermissionFlagsBits.Administrator;
const COMPONENTS_V2 = MessageFlags.IsComponentsV2;
const EPHEMERAL = MessageFlags.Ephemeral;

function isAdmin(interaction) {
  return Boolean(interaction.memberPermissions?.has(ADMIN));
}

function safeText(value, maximum = 1000) {
  return String(value ?? "")
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere")
    .slice(0, maximum);
}

function makePanel(title, sections = []) {
  const container = new ContainerBuilder()
    .setAccentColor(BRAND_COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${safeText(title, 200)}`)
    );

  for (const section of sections) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true)
    );

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        safeText(section, 4000)
      )
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

async function privatePanel(interaction, title, sections = []) {
  const payload = {
    components: [makePanel(title, sections)],
    flags: COMPONENTS_V2 | EPHEMERAL
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
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

function getProduct(id) {
  return data.products.find(product => product.id === Number(id));
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

// ==================================================
// PRODUCT LISTING COMPONENTS
// ==================================================

function productListingPanel(product) {
  const container = makePanel(
    product.name,
    [
      `**Price:** ${safeText(product.price, 50)}`,
      `**Product ID:** ${product.id}`,
      safeText(product.description, 1000),
      product.purchaseUrl
        ? `**Purchase:** ${product.purchaseUrl}`
        : "**Purchase:** Contact the Rover shop team for instructions.",
      product.asset
        ? `**Delivery:** ${safeText(product.asset, 500)}`
        : null
    ].filter(Boolean)
  );

  if (product.imageUrl) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(true)
    );

    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(product.imageUrl)
      )
    );
  }

  return container;
}

// ==================================================
// INFORMATION CENTRE
// ==================================================

const INFORMATION = {
  general: {
    title: "General Information",
    sections: [
      "**Welcome to Rover**",
      "Rover is a digital asset shop where customers can browse products and follow purchasing instructions.",
      "**Our products**\nEach listing explains what is included, the displayed price and applicable usage conditions.",
      "**Need assistance?**\nCheck the product listing or contact the shop team."
    ]
  },

  rules: {
    title: "Shop Rules",
    sections: [
      "**1. Respect**\nTreat customers and staff respectfully.",
      "**2. Honest purchases**\nFraudulent payments and false claims are prohibited.",
      "**3. Product licences**\nRespect the permissions and licence conditions supplied with every asset.",
      "**4. Distribution**\nDo not redistribute or resell assets unless the licence permits it.",
      "**5. Support**\nProvide accurate information when requesting assistance."
    ]
  },

  purchase: {
    title: "Purchasing Guide",
    sections: [
      "**Step 1 — Browse**\nUse `/products` to view the catalogue.",
      "**Step 2 — Select**\nUse `/purchase-product` and select a product from the dropdown.",
      "**Step 3 — Checkout**\nFollow the applicable payment provider's instructions.",
      "**Step 4 — Delivery**\nFollow the listing's delivery instructions or contact the shop team.",
      "**Important**\nRover does not automatically verify external payments."
    ]
  },

  terms: {
    title: "Terms of Service",
    sections: [
      "**Product descriptions**\nReview the listing, price and licence before purchasing.",
      "**Digital products**\nPurchasing an asset does not automatically transfer copyright.",
      "**Payment and delivery**\nA purchase link is not proof of payment.",
      "**Refunds**\nRefunds and cancellations are handled according to the applicable published policy and consumer law."
    ]
  },

  disclaimer: {
    title: "Disclaimer",
    sections: [
      "**Third-party rights**\nTrademarks and third-party assets remain the property of their respective owners.",
      "**Compatibility**\nCheck compatibility before purchasing.",
      "**External links**\nCheckout links may lead to third-party services.",
      "**Payment verification**\nRover does not independently verify external payments."
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
        description: "How to purchase products"
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
    "Welcome to Rover, your destination for digital assets.",
    "Select a category below to receive detailed information privately."
  ]);

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(menu)
  );

  return container;
}

// ==================================================
// PRODUCT DROPDOWN WITH PAGINATION
// ==================================================

function productMenu(page = 0) {
  const products = [...data.products].sort((a, b) => a.id - b.id);
  const pageCount = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  const visible = products.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );

  const container = makePanel("Rover Product Shop", [
    `**Available products:** ${products.length}`,
    `**Page:** ${safePage + 1} of ${pageCount}`,
    "Select a product below to view its details, price and purchasing instructions."
  ]);

  if (visible.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rover_purchase_select:${safePage}`)
      .setPlaceholder("Choose a product")
      .addOptions(
        visible.map(product => ({
          label: safeText(product.name, 100),
          value: String(product.id),
          description: safeText(
            `ID ${product.id} | ${product.price}`,
            100
          )
        }))
      );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(menu)
    );
  }

  if (pageCount > 1) {
    const previous = new ButtonBuilder()
      .setCustomId(`rover_purchase_page:${safePage - 1}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0);

    const next = new ButtonBuilder()
      .setCustomId(`rover_purchase_page:${safePage + 1}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= pageCount - 1);

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(previous, next)
    );
  }

  return container;
}

async function showProductDetails(interaction, product) {
  const sections = [
    ...formatProduct(product),
    product.purchaseUrl
      ? "**Next step**\nUse the purchase link above and follow the checkout provider's instructions."
      : "**Next step**\nContact the shop team for purchasing instructions.",
    "**Payment notice**\nOpening a link does not confirm payment. External payments are not automatically verified by Rover."
  ];

  if (product.imageUrl) {
    sections.push(`**Product preview:** ${product.imageUrl}`);
  }

  return privatePanel(interaction, "Product Details", sections);
}

// ==================================================
// GIVEAWAYS
// ==================================================

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
          : "Select the button below to enter."
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
    if (!channel?.isTextBased() || !channel.messages) return;

    const message = await channel.messages.fetch(giveaway.messageId);

    await message.edit({
      components: [giveawayPanel(giveaway)],
      flags: COMPONENTS_V2
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
      await channel.send({
        components: [
          makePanel("Giveaway Results", [
            `**Prize:** ${safeText(giveaway.prize, 200)}`,
            giveaway.winnerId
              ? `Congratulations <@${giveaway.winnerId}>! You won.`
              : "The giveaway ended without any entries."
          ])
        ],
        flags: COMPONENTS_V2,
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

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [
  new SlashCommandBuilder()
    .setName("create-product")
    .setDescription("Create a Rover product listing")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o =>
      o.setName("name").setDescription("Product name")
        .setRequired(true).setMaxLength(100))
    .addStringOption(o =>
      o.setName("description").setDescription("Product description")
        .setRequired(true).setMaxLength(1000))
    .addStringOption(o =>
      o.setName("price").setDescription("Displayed price")
        .setRequired(true).setMaxLength(50))
    .addStringOption(o =>
      o.setName("purchase_url").setDescription("Checkout or purchase URL")
        .setRequired(false).setMaxLength(500))
    .addStringOption(o =>
      o.setName("delivery").setDescription("Delivery instructions")
        .setRequired(false).setMaxLength(500))
    .addStringOption(o =>
      o.setName("image_url").setDescription("Product preview image URL")
        .setRequired(false).setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("edit-product")
    .setDescription("Edit a Rover product listing")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(o =>
      o.setName("id").setDescription("Product ID")
        .setRequired(true).setMinValue(1))
    .addStringOption(o =>
      o.setName("name").setDescription("New product name")
        .setRequired(false).setMaxLength(100))
    .addStringOption(o =>
      o.setName("description").setDescription("New product description")
        .setRequired(false).setMaxLength(1000))
    .addStringOption(o =>
      o.setName("price").setDescription("New displayed price")
        .setRequired(false).setMaxLength(50))
    .addStringOption(o =>
      o.setName("purchase_url").setDescription("New checkout URL")
        .setRequired(false).setMaxLength(500))
    .addStringOption(o =>
      o.setName("delivery").setDescription("New delivery instructions")
        .setRequired(false).setMaxLength(500))
    .addStringOption(o =>
      o.setName("image_url").setDescription("New preview image URL")
        .setRequired(false).setMaxLength(500)),

  new SlashCommandBuilder()
    .setName("delete-product")
    .setDescription("Delete a Rover product listing")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(o =>
      o.setName("id").setDescription("Product ID")
        .setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("give-product")
    .setDescription("Send product details to a customer")
    .setDefaultMemberPermissions(ADMIN)
    .addUserOption(o =>
      o.setName("customer").setDescription("Customer receiving the product")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("id").setDescription("Product ID")
        .setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("products")
    .setDescription("Browse Rover's available products"),

  new SlashCommandBuilder()
    .setName("purchase-product")
    .setDescription("Open the private Rover product shop"),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Publish a product listing using a Rover webhook")
    .setDefaultMemberPermissions(ADMIN)
    .addIntegerOption(o =>
      o.setName("product_id").setDescription("Product ID to publish")
        .setRequired(true).setMinValue(1))
    .addChannelOption(o =>
      o.setName("channel").setDescription("Channel to publish the listing")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a 24-hour asset giveaway")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o =>
      o.setName("prize").setDescription("Giveaway prize")
        .setRequired(true).setMaxLength(200))
    .addChannelOption(o =>
      o.setName("channel").setDescription("Giveaway channel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("end-giveaway")
    .setDescription("End a Rover giveaway early")
    .setDefaultMemberPermissions(ADMIN)
    .addStringOption(o =>
      o.setName("id").setDescription("Giveaway ID")
        .setRequired(true).setMaxLength(100)),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Publish Rover's information panel")
    .setDefaultMemberPermissions(ADMIN)
    .addChannelOption(o =>
      o.setName("channel").setDescription("Panel channel")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName("shop-info")
    .setDescription("View Rover shop statistics")
    .setDefaultMemberPermissions(ADMIN)
];

// ==================================================
// AUTOMATIC WEBHOOK
// ==================================================

async function getRoverWebhook(channel) {
  if (!channel?.isTextBased() || !channel.guild) {
    throw new Error("Choose a server text or announcement channel.");
  }

  if (typeof channel.createWebhook !== "function") {
    throw new Error("This channel does not support webhooks.");
  }

  const webhooks = await channel.fetchWebhooks();

  let webhook = webhooks.find(
    item =>
      item.name === BRAND_NAME &&
      item.owner?.id === client.user.id &&
      Boolean(item.token)
  );

  if (!webhook) {
    webhook = await channel.createWebhook({
      name: BRAND_NAME,
      avatar: client.user.displayAvatarURL()
    });
  }

  if (!webhook.token) {
    throw new Error("The Rover webhook has no usable token.");
  }

  return webhook;
}

async function publishProductWebhook(channel, product) {
  const webhook = await getRoverWebhook(channel);

  // Components V2 webhook messages must set the V2 flag and
  // request components in the webhook response.
  return webhook.send({
    components: [productListingPanel(product)],
    flags: COMPONENTS_V2,
    withComponents: true,
    allowedMentions: { parse: [] }
  });
}

// ==================================================
// READY / COMMAND REGISTRATION
// ==================================================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log("Registering Rover guild commands...");

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
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

// ==================================================
// INTERACTIONS
// ==================================================

client.on("interactionCreate", async interaction => {
  try {
    // ---------------- INFORMATION MENU ----------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "rover_information"
    ) {
      const section = INFORMATION[interaction.values[0]];

      if (!section) {
        return privatePanel(interaction, "Information Unavailable", [
          "Please select a valid information category."
        ]);
      }

      return privatePanel(interaction, section.title, section.sections);
    }

    // ---------------- PRODUCT SELECTION ----------------

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("rover_purchase_select:")
    ) {
      const product = getProduct(interaction.values[0]);

      if (!product) {
        return privatePanel(interaction, "Product Unavailable", [
          "This product no longer exists. Open `/purchase-product` again."
        ]);
      }

      return showProductDetails(interaction, product);
    }

    // ---------------- PRODUCT PAGE BUTTONS ----------------

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("rover_purchase_page:")
    ) {
      const page = Number(
        interaction.customId.split(":")[1]
      );

      if (!Number.isInteger(page) || page < 0) {
        return privatePanel(interaction, "Invalid Page", [
          "Please reopen `/purchase-product`."
        ]);
      }

      return interaction.update({
        components: [productMenu(page)],
        flags: COMPONENTS_V2 | EPHEMERAL
      });
    }

    // ---------------- GIVEAWAY ENTRY ----------------

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

        return privatePanel(interaction, "Giveaway Closed", [
          "This giveaway has ended or is unavailable."
        ]);
      }

      if (giveaway.entries.includes(interaction.user.id)) {
        return privatePanel(interaction, "Already Entered", [
          "You have already entered this giveaway."
        ]);
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
        flags: COMPONENTS_V2 | EPHEMERAL
      });
    }

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.inGuild()) {
      return privatePanel(interaction, "Server Required", [
        "Please use this command inside a Discord server."
      ]);
    }

    const commandName = interaction.commandName;

    const adminCommands = [
      "create-product",
      "edit-product",
      "delete-product",
      "give-product",
      "embed",
      "giveaway",
      "end-giveaway",
      "information",
      "shop-info"
    ];

    if (adminCommands.includes(commandName) && !isAdmin(interaction)) {
      return privatePanel(interaction, "Permission Denied", [
        "You need the **Administrator** permission to use this command."
      ]);
    }

    // ---------------- CREATE PRODUCT ----------------

    if (commandName === "create-product") {
      const name = interaction.options.getString("name", true);
      const description = interaction.options.getString("description", true);
      const price = interaction.options.getString("price", true);
      const rawUrl = interaction.options.getString("purchase_url");
      const delivery = interaction.options.getString("delivery") || "";
      const rawImage = interaction.options.getString("image_url");

      const purchaseUrl = validateUrl(rawUrl);
      const imageUrl = validateUrl(rawImage);

      if (rawUrl && !purchaseUrl) {
        return privatePanel(interaction, "Invalid Purchase Link", [
          "Use a valid HTTP or HTTPS purchase URL."
        ]);
      }

      if (rawImage && !imageUrl) {
        return privatePanel(interaction, "Invalid Image URL", [
          "Use a valid HTTP or HTTPS image URL."
        ]);
      }

      const product = {
        id: data.nextProductId++,
        name,
        description,
        price,
        purchaseUrl,
        asset: delivery,
        imageUrl,
        createdBy: interaction.user.id,
        createdAt: Date.now()
      };

      data.products.push(product);
      saveData();

      return privatePanel(interaction, "Product Created", [
        ...formatProduct(product),
        "The product has been saved. Use `/embed` to publish its listing."
      ]);
    }

    // ---------------- EDIT PRODUCT ----------------

    if (commandName === "edit-product") {
      const id = interaction.options.getInteger("id", true);
      const product = getProduct(id);

      if (!product) {
        return privatePanel(interaction, "Product Not Found", [
          `No product with ID **${id}** exists.`
        ]);
      }

      const name = interaction.options.getString("name");
      const description = interaction.options.getString("description");
      const price = interaction.options.getString("price");
      const rawUrl = interaction.options.getString("purchase_url");
      const delivery = interaction.options.getString("delivery");
      const rawImage = interaction.options.getString("image_url");

      if (
        name === null &&
        description === null &&
        price === null &&
        rawUrl === null &&
        delivery === null &&
        rawImage === null
      ) {
        return privatePanel(interaction, "Nothing to Change", [
          "Supply at least one field to update."
        ]);
      }

      const purchaseUrl = rawUrl === null ? undefined : validateUrl(rawUrl);
      const imageUrl = rawImage === null ? undefined : validateUrl(rawImage);

      if (rawUrl !== null && purchaseUrl === null) {
        return privatePanel(interaction, "Invalid Purchase Link", [
          "Use a valid HTTP or HTTPS purchase URL."
        ]);
      }

      if (rawImage !== null && imageUrl === null) {
        return privatePanel(interaction, "Invalid Image URL", [
          "Use a valid HTTP or HTTPS image URL."
        ]);
      }

      if (name !== null) product.name = name;
      if (description !== null) product.description = description;
      if (price !== null) product.price = price;
      if (rawUrl !== null) product.purchaseUrl = purchaseUrl;
      if (delivery !== null) product.asset = delivery;
      if (rawImage !== null) product.imageUrl = imageUrl;

      saveData();

      return privatePanel(interaction, "Product Updated", [
        ...formatProduct(product),
        "The saved listing has been updated. Previously published webhook messages are not automatically edited."
      ]);
    }

    // ---------------- DELETE PRODUCT ----------------

    if (commandName === "delete-product") {
      const id = interaction.options.getInteger("id", true);
      const index = data.products.findIndex(product => product.id === id);

      if (index === -1) {
        return privatePanel(interaction, "Product Not Found", [
          `No product with ID **${id}** exists.`
        ]);
      }

      const [product] = data.products.splice(index, 1);
      saveData();

      return privatePanel(interaction, "Product Deleted", [
        `**${safeText(product.name, 100)}** (ID: ${product.id}) has been removed from the catalogue.`
      ]);
    }

    // ---------------- PUBLISH PRODUCT WEBHOOK ----------------

    if (commandName === "embed") {
      const id = interaction.options.getInteger("product_id", true);
      const channel = interaction.options.getChannel("channel", true);
      const product = getProduct(id);

      if (!product) {
        return privatePanel(interaction, "Product Not Found", [
          `No product with ID **${id}** exists. Create it first using `/create-product`.`
        ]);
      }

      await interaction.deferReply({ flags: EPHEMERAL });

      try {
        const message = await publishProductWebhook(channel, product);

        return interaction.editReply({
          components: [
            makePanel("Product Listing Published", [
              `**Product:** ${safeText(product.name, 100)}`,
              `**Product ID:** ${product.id}`,
              `**Channel:** <#${channel.id}>`,
              `**Message ID:** ${message.id}`,
              "Rover published the saved product using its channel webhook."
            ])
          ],
          flags: COMPONENTS_V2 | EPHEMERAL
        });
      } catch (error) {
        console.error("Webhook publication failed:", error);

        return interaction.editReply({
          components: [
            makePanel("Webhook Publication Failed", [
              "Rover could not publish this product.",
              "Check that Rover has **Manage Webhooks**, **View Channel** and **Send Messages** permissions in the destination channel.",
              "Check the bot console for the detailed error."
            ])
          ],
          flags: COMPONENTS_V2 | EPHEMERAL
        });
      }
    }

    // ---------------- GIVE PRODUCT ----------------

    if (commandName === "give-product") {
      const customer = interaction.options.getUser("customer", true);
      const id = interaction.options.getInteger("id", true);
      const product = getProduct(id);

      if (!product) {
        return privatePanel(interaction, "Product Not Found", [
          `No product with ID **${id}** exists.`
        ]);
      }

      try {
        await customer.send({
          components: [
            makePanel("Your Rover Product", [
              `Hello ${safeText(customer.username, 100)}. Rover staff have issued you the following product.`,
              ...formatProduct(product)
            ])
          ],
          flags: COMPONENTS_V2
        });
      } catch {
        return privatePanel(interaction, "Delivery Failed", [
          "I couldn't DM this customer. They may have DMs disabled."
        ]);
      }

      return privatePanel(interaction, "Product Details Sent", [
        `**Product:** ${safeText(product.name, 100)}`,
        `**Customer:** ${customer}`,
        "The product details were sent by direct message. This command does not transfer or attach files automatically."
      ]);
    }

    // ---------------- PRODUCTS CATALOGUE ----------------

    if (commandName === "products") {
      if (data.products.length === 0) {
        return privatePanel(interaction, "Rover Products", [
          "There are currently no listed products."
        ]);
      }

      return interaction.reply({
        components: [productMenu(0)],
        flags: COMPONENTS_V2 | EPHEMERAL
      });
    }

    // ---------------- PURCHASE PRODUCT ----------------

    if (commandName === "purchase-product") {
      if (data.products.length === 0) {
        return privatePanel(interaction, "Rover Product Shop", [
          "There are currently no products available."
        ]);
      }

      return interaction.reply({
        components: [productMenu(0)],
        flags: COMPONENTS_V2 | EPHEMERAL
      });
    }

    // ---------------- INFORMATION PANEL ----------------

    if (commandName === "information") {
      const channel = interaction.options.getChannel("channel", true);

      await channel.send({
        components: [informationPanel()],
        flags: COMPONENTS_V2
      });

      return privatePanel(interaction, "Information Panel Published", [
        `The Rover information panel has been posted in <#${channel.id}>.`
      ]);
    }

    // ---------------- CREATE GIVEAWAY ----------------

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
        flags: COMPONENTS_V2
      });

      giveaway.messageId = message.id;
      data.giveaways.push(giveaway);
      saveData();
      scheduleGiveaway(giveaway);

      return privatePanel(interaction, "Giveaway Created", [
        `**Prize:** ${safeText(prize, 200)}`,
        `**Channel:** <#${channel.id}>`,
        `**Giveaway ID:** ${giveaway.id}`,
        `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:F>`
      ]);
    }

    // ---------------- END GIVEAWAY ----------------

    if (commandName === "end-giveaway") {
      const id = interaction.options.getString("id", true);
      const giveaway = data.giveaways.find(g => g.id === id);

      if (!giveaway) {
        return privatePanel(interaction, "Giveaway Not Found", [
          "No giveaway matches that ID."
        ]);
      }

      if (giveaway.ended) {
        return privatePanel(interaction, "Already Ended", [
          "This giveaway has already ended."
        ]);
      }

      await finishGiveaway(giveaway);

      return privatePanel(interaction, "Giveaway Ended", [
        `**Prize:** ${safeText(giveaway.prize, 200)}`,
        giveaway.winnerId
          ? `**Winner:** <@${giveaway.winnerId}>`
          : "No entries were recorded."
      ]);
    }

    // ---------------- SHOP STATISTICS ----------------

    if (commandName === "shop-info") {
      const activeGiveaways = data.giveaways.filter(
        giveaway => !giveaway.ended && giveaway.endsAt > Date.now()
      ).length;

      return privatePanel(interaction, "Rover Shop Statistics", [
        `**Products listed:** ${data.products.length}`,
        `**Giveaways stored:** ${data.giveaways.length}`,
        `**Active giveaways:** ${activeGiveaways}`,
        `**Next product ID:** ${data.nextProductId}`
      ]);
    }
  } catch (error) {
    console.error(
      `Interaction failed (${interaction.commandName || interaction.customId || "unknown"}):`,
      error
    );

    if (!interaction.isRepliable()) return;

    const response = {
      components: [
        makePanel("Something Went Wrong", [
          "The request could not be completed. Please try again.",
          "If the problem continues, check the bot console."
        ])
      ],
      flags: COMPONENTS_V2 | EPHEMERAL
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

// ==================================================
// LOGIN
// ==================================================

client.login(TOKEN).catch(error => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
