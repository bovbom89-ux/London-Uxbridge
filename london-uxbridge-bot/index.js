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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const BRAND = "Rover";
const FOOTER = "Rover Official Store";
const BRAND_COLOUR = "#8B70C8";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

const PAGE_SIZE = 25;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const defaults = {
  nextProductId: 1,
  products: [],
  giveaways: [],
  deliveries: []
};

function loadData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(defaults, null, 2)
      );

      return structuredClone(defaults);
    }

    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    return {
      ...structuredClone(defaults),
      ...saved,
      products: Array.isArray(saved.products)
        ? saved.products
        : [],
      giveaways: Array.isArray(saved.giveaways)
        ? saved.giveaways
        : [],
      deliveries: Array.isArray(saved.deliveries)
        ? saved.deliveries
        : []
    };
  } catch (error) {
    console.error("Could not load bot data:", error);
    process.exit(1);
  }
}

let data = loadData();

function saveData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const temporaryFile = `${DATA_FILE}.tmp`;

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(data, null, 2)
    );

    fs.renameSync(temporaryFile, DATA_FILE);
  } catch (error) {
    console.error("Could not save bot data:", error);
    throw error;
  }
}

function makePanel(title, sections = []) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
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
    new TextDisplayBuilder().setContent(`-# ${FOOTER}`)
  );

  return container;
}

async function panelReply(
  interaction,
  title,
  sections = [],
  ephemeral = false,
  extraComponents = []
) {
  return interaction.reply({
    components: [
      makePanel(title, sections),
      ...extraComponents
    ],
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0)
  });
}

async function panelFollowUp(
  interaction,
  title,
  sections = [],
  ephemeral = true
) {
  return interaction.followUp({
    components: [makePanel(title, sections)],
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0)
  });
}

function isAdmin(member) {
  return member.permissions.has(
    PermissionFlagsBits.Administrator
  ) || member.permissions.has(
    PermissionFlagsBits.ManageGuild
  );
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction.member)) {
    return true;
  }

  await panelReply(
    interaction,
    "Permission required",
    ["You need Manage Server or Administrator permission to use this command."],
    true
  );

  return false;
}

function cleanText(value, maxLength = 1000) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function validUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      url.protocol === "http:";
  } catch {
    return false;
  }
}

function getProduct(id) {
  return data.products.find(
    product => String(product.id) === String(id)
  );
}

function getActiveProducts() {
  return data.products.filter(
    product => product.active !== false
  );
}

function formatPrice(price) {
  return price || "Contact the store";
}

function formatProduct(product) {
  const sections = [
    `**${product.name}**`,
    product.description || "No description provided.",
    `**Price:** ${formatPrice(product.price)}`,
    `**Category:** ${product.category || "General"}`
  ];

  if (product.purchaseUrl) {
    sections.push(
      `**Purchase link:** ${product.purchaseUrl}`
    );
  }

  if (product.delivery) {
    sections.push(
      `**Delivery information:** ${product.delivery}`
    );
  }

  // Internal product IDs are deliberately never displayed.
  return sections.join("\n\n");
}

function productAutocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  return getActiveProducts()
    .filter(product =>
      product.name.toLowerCase().includes(focused)
    )
    .slice(0, 25)
    .map(product => ({
      name: `${product.name} — ${formatPrice(product.price)}`.slice(0, 100),
      value: String(product.id)
    }));
}

function productChoiceAutocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  return data.products
    .filter(product =>
      product.name.toLowerCase().includes(focused)
    )
    .slice(0, 25)
    .map(product => ({
      name: `${product.name} — ${formatPrice(product.price)}`.slice(0, 100),
      value: String(product.id)
    }));
}

function activeGiveawayAutocomplete(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();

  return data.giveaways
    .filter(giveaway =>
      !giveaway.ended &&
      giveaway.prize.toLowerCase().includes(focused)
    )
    .slice(0, 25)
    .map(giveaway => ({
      name: giveaway.prize.slice(0, 100),
      value: String(giveaway.id)
    }));
}

function makeProductMenu(page, mode) {
  const products = getActiveProducts();
  const pageCount = Math.max(
    1,
    Math.ceil(products.length / PAGE_SIZE)
  );

  const safePage = Math.max(
    0,
    Math.min(page, pageCount - 1)
  );

  const pageProducts = products.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE
  );

  if (!pageProducts.length) {
    return [];
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`rover_${mode}_select`)
    .setPlaceholder(
      mode === "purchase"
        ? "Choose a product to view purchase details"
        : "Choose a product to view details"
    )
    .addOptions(
      pageProducts.map(product => ({
        label: product.name.slice(0, 100),
        description: formatPrice(product.price).slice(0, 100),
        value: String(product.id)
      }))
    );

  const rows = [
    new ActionRowBuilder().addComponents(menu)
  ];

  if (pageCount > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rover_${mode}_page:${safePage - 1}`)
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage === 0),

        new ButtonBuilder()
          .setCustomId(`rover_${mode}_page:${safePage + 1}`)
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage >= pageCount - 1)
      )
    );
  }

  return rows;
}

async function showProductCatalogue(interaction, mode, page = 0) {
  const products = getActiveProducts();

  if (!products.length) {
    return panelReply(
      interaction,
      "Product catalogue",
      ["There are currently no products available."],
      true
    );
  }

  const pageCount = Math.ceil(products.length / PAGE_SIZE);
  const safePage = Math.max(
    0,
    Math.min(page, pageCount - 1)
  );

  const title = mode === "purchase"
    ? "Browse and purchase"
    : "Product catalogue";

  const description = mode === "purchase"
    ? "Choose a product below to view its details and purchase link."
    : "Choose a product below to view its details.";

  const components = makeProductMenu(safePage, mode);

  return interaction.reply({
    components: [
      makePanel(title, [
        description,
        `Page ${safePage + 1} of ${pageCount}`,
        `Available products: ${products.length}`
      ]),
      ...components
    ],
    flags:
      MessageFlags.IsComponentsV2 |
      MessageFlags.Ephemeral
  });
}

async function createStoreWebhook(channel) {
  const hooks = await channel.fetchWebhooks();

  let webhook = hooks.find(
    hook =>
      hook.name === "Rover Store" &&
      hook.owner?.id === client.user.id
  );

  if (!webhook) {
    webhook = await channel.createWebhook({
      name: "Rover Store",
      reason: "Rover product catalogue"
    });
  }

  return webhook;
}

async function finishGiveaway(giveawayId) {
  const giveaway = data.giveaways.find(
    item => String(item.id) === String(giveawayId)
  );

  if (!giveaway || giveaway.ended) return;

  giveaway.ended = true;

  const entrants = Array.isArray(giveaway.entries)
    ? [...new Set(giveaway.entries)]
    : [];

  let winnerId = null;

  if (entrants.length > 0) {
    winnerId = entrants[
      Math.floor(Math.random() * entrants.length)
    ];
  }

  giveaway.winnerId = winnerId;
  giveaway.endedAt = Date.now();

  saveData();

  try {
    const channel = await client.channels.fetch(
      giveaway.channelId
    );

    if (channel?.isTextBased()) {
      if (winnerId) {
        await channel.send({
          components: [
            makePanel("Giveaway ended", [
              `**Prize:** ${giveaway.prize}`,
              `**Winner:** <@${winnerId}>`,
              `Congratulations!`
            ])
          ],
          flags: MessageFlags.IsComponentsV2
        });
      } else {
        await channel.send({
          components: [
            makePanel("Giveaway ended", [
              `**Prize:** ${giveaway.prize}`,
              "Nobody entered this giveaway."
            ])
          ],
          flags: MessageFlags.IsComponentsV2
        });
      }

      if (giveaway.messageId) {
        const message = await channel.messages
          .fetch(giveaway.messageId)
          .catch(() => null);

        if (message) {
          await message.edit({
            components: [
              makePanel("Giveaway ended", [
                `**Prize:** ${giveaway.prize}`,
                winnerId
                  ? `**Winner:** <@${winnerId}>`
                  : "There were no entries.",
                "This giveaway has finished."
              ])
            ],
            flags: MessageFlags.IsComponentsV2
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    console.error("Could not finish giveaway:", error);
  }
}

function restoreGiveawayTimers() {
  for (const giveaway of data.giveaways) {
    if (giveaway.ended) continue;

    const remaining = giveaway.endsAt - Date.now();

    if (remaining <= 0) {
      finishGiveaway(giveaway.id);
    } else {
      setTimeout(
        () => finishGiveaway(giveaway.id),
        Math.min(remaining, 2147483647)
      );
    }
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether Rover is responding"),

  new SlashCommandBuilder()
    .setName("create-product")
    .setDescription("Add a product to the store")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("name")
        .setDescription("Product name")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("description")
        .setDescription("Product description")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("price")
        .setDescription("Price, for example £5 or $10")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("purchase-link")
        .setDescription("Optional purchase URL")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("delivery")
        .setDescription("Delivery instructions")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("category")
        .setDescription("Product category")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("image-url")
        .setDescription("Optional image URL")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("edit-product")
    .setDescription("Edit an existing product")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("product")
        .setDescription("Choose the product")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(option =>
      option.setName("name")
        .setDescription("New product name")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("description")
        .setDescription("New description")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("price")
        .setDescription("New price")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("purchase-link")
        .setDescription("New purchase URL")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("delivery")
        .setDescription("New delivery information")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("category")
        .setDescription("New category")
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName("image-url")
        .setDescription("New image URL")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("delete-product")
    .setDescription("Remove a product from the store")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("product")
        .setDescription("Choose the product")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName("products")
    .setDescription("Browse the product catalogue"),

  new SlashCommandBuilder()
    .setName("purchase-product")
    .setDescription("Browse products and view purchase links"),

  new SlashCommandBuilder()
    .setName("search-products")
    .setDescription("Search the store catalogue")
    .addStringOption(option =>
      option.setName("query")
        .setDescription("Search by product name, description or category")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Post the product catalogue in a channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Channel where the catalogue should be posted")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("shop-info")
    .setDescription("View store statistics")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Publish information about Rover")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Channel for the information panel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Start a store giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("prize")
        .setDescription("Giveaway prize")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option.setName("channel")
        .setDescription("Giveaway channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("duration-hours")
        .setDescription("Duration in hours, from 1 to 168")
        .setMinValue(1)
        .setMaxValue(168)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("end-giveaway")
    .setDescription("End an active giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option.setName("giveaway")
        .setDescription("Choose the giveaway prize")
        .setAutocomplete(true)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("give-product")
    .setDescription("Record a product delivery")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(option =>
      option.setName("customer")
        .setDescription("Customer who received the product")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("product")
        .setDescription("Choose the product delivered")
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("notes")
        .setDescription("Optional delivery notes")
        .setRequired(false)
    )
];

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      {
        body: commands.map(command => command.toJSON())
      }
    );

    console.log(
      `Successfully registered ${commands.length} Rover commands.`
    );

    restoreGiveawayTimers();
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isAutocomplete()) {
      const command = interaction.commandName;

      if (
        command === "edit-product" ||
        command === "delete-product" ||
        command === "give-product"
      ) {
        return interaction.respond(
          command === "delete-product"
            ? productChoiceAutocomplete(interaction)
            : productAutocomplete(interaction)
        );
      }

      if (command === "end-giveaway") {
        return interaction.respond(
          activeGiveawayAutocomplete(interaction)
        );
      }

      return interaction.respond([]);
    }

    if (interaction.isButton()) {
      const pageMatch = interaction.customId.match(
        /^rover_(catalogue|purchase)_page:(-?\d+)$/
      );

      if (pageMatch) {
        const mode = pageMatch[1] === "catalogue"
          ? "catalogue"
          : "purchase";

        const page = Number(pageMatch[2]);

        const products = getActiveProducts();

        if (!products.length) {
          return interaction.update({
            components: [makePanel("Product catalogue", [
              "There are currently no products available."
            ])],
            flags: MessageFlags.IsComponentsV2
          });
        }

        const pageCount = Math.ceil(products.length / PAGE_SIZE);
        const safePage = Math.max(
          0,
          Math.min(page, pageCount - 1)
        );

        const title = mode === "purchase"
          ? "Browse and purchase"
          : "Product catalogue";

        const description = mode === "purchase"
          ? "Choose a product below to view its details and purchase link."
          : "Choose a product below to view its details.";

        return interaction.update({
          components: [
            makePanel(title, [
              description,
              `Page ${safePage + 1} of ${pageCount}`,
              `Available products: ${products.length}`
            ]),
            ...makeProductMenu(safePage, mode)
          ],
          flags: MessageFlags.IsComponentsV2
        });
      }

      const entryMatch = interaction.customId.match(
        /^rover_giveaway_enter:(.+)$/
      );

      if (entryMatch) {
        const giveaway = data.giveaways.find(
          item => String(item.id) === entryMatch[1]
        );

        if (!giveaway || giveaway.ended ||
            giveaway.endsAt <= Date.now()) {
          return panelReply(
            interaction,
            "Giveaway closed",
            ["This giveaway has ended or is no longer available."],
            true
          );
        }

        if (!Array.isArray(giveaway.entries)) {
          giveaway.entries = [];
        }

        if (giveaway.entries.includes(interaction.user.id)) {
          return panelReply(
            interaction,
            "Already entered",
            ["You have already entered this giveaway."],
            true
          );
        }

        giveaway.entries.push(interaction.user.id);
        saveData();

        return panelReply(
          interaction,
          "Entry confirmed",
          [
            `You have entered the giveaway for **${giveaway.prize}**.`,
            "Good luck!"
          ],
          true
        );
      }
    }

    if (interaction.isStringSelectMenu()) {
      const modeMatch = interaction.customId.match(
        /^rover_(catalogue|purchase)_select$/
      );

      if (modeMatch) {
        const product = getProduct(interaction.values[0]);

        if (!product || product.active === false) {
          return panelReply(
            interaction,
            "Product unavailable",
            ["This product is no longer available."],
            true
          );
        }

        return panelReply(
          interaction,
          product.name,
          [
            formatProduct(product),
            modeMatch[1] === "purchase"
              ? "Use the purchase link above to continue, if one is available."
              : "This is the product information currently listed by the store."
          ],
          true
        );
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    if (commandName === "ping") {
      return panelReply(interaction, "Rover status", [
        `WebSocket latency: ${client.ws.ping} ms`,
        "Rover is responding."
      ]);
    }

    if (commandName === "create-product") {
      if (!(await requireAdmin(interaction))) return;

      const name = cleanText(
        interaction.options.getString("name"),
        100
      );

      const description = cleanText(
        interaction.options.getString("description"),
        1000
      );

      const price = cleanText(
        interaction.options.getString("price"),
        100
      );

      const purchaseUrl = cleanText(
        interaction.options.getString("purchase-link"),
        500
      );

      const delivery = cleanText(
        interaction.options.getString("delivery"),
        500
      );

      const category = cleanText(
        interaction.options.getString("category") || "General",
        100
      );

      const imageUrl = cleanText(
        interaction.options.getString("image-url"),
        500
      );

      if (!validUrl(purchaseUrl) || !validUrl(imageUrl)) {
        return panelReply(
          interaction,
          "Invalid URL",
          ["Purchase links and image URLs must be valid HTTP or HTTPS URLs."],
          true
        );
      }

      const product = {
        id: data.nextProductId++,
        name,
        description,
        price,
        purchaseUrl,
        delivery,
        category,
        imageUrl,
        active: true,
        createdAt: Date.now(),
        createdBy: interaction.user.id
      };

      data.products.push(product);
      saveData();

      return panelReply(interaction, "Product created", [
        `**${product.name}** has been added to the store.`,
        `**Price:** ${formatPrice(product.price)}`,
        `**Category:** ${product.category}`
      ], true);
    }

    if (commandName === "edit-product") {
      if (!(await requireAdmin(interaction))) return;

      const id = interaction.options.getString("product");
      const product = getProduct(id);

      if (!product) {
        return panelReply(
          interaction,
          "Product not found",
          ["Choose an existing product from the autocomplete list."],
          true
        );
      }

      const fields = [
        ["name", "name", 100],
        ["description", "description", 1000],
        ["price", "price", 100],
        ["purchase-link", "purchaseUrl", 500],
        ["delivery", "delivery", 500],
        ["category", "category", 100],
        ["image-url", "imageUrl", 500]
      ];

      let changed = 0;

      for (const [optionName, property, limit] of fields) {
        const value = interaction.options.getString(optionName);

        if (value !== null) {
          const cleaned = cleanText(value, limit);

          if (
            (property === "purchaseUrl" || property === "imageUrl") &&
            !validUrl(cleaned)
          ) {
            return panelReply(
              interaction,
              "Invalid URL",
              ["Purchase links and image URLs must be valid HTTP or HTTPS URLs."],
              true
            );
          }

          product[property] = cleaned;
          changed++;
        }
      }

      if (!changed) {
        return panelReply(
          interaction,
          "Nothing changed",
          ["Provide at least one field to update."],
          true
        );
      }

      saveData();

      return panelReply(interaction, "Product updated", [
        `**${product.name}** has been updated.`,
        `**Price:** ${formatPrice(product.price)}`
      ], true);
    }

    if (commandName === "delete-product") {
      if (!(await requireAdmin(interaction))) return;

      const id = interaction.options.getString("product");
      const product = getProduct(id);

      if (!product) {
        return panelReply(
          interaction,
          "Product not found",
          ["Choose an existing product from the autocomplete list."],
          true
        );
      }

      data.products = data.products.filter(
        item => String(item.id) !== String(product.id)
      );

      saveData();

      return panelReply(interaction, "Product deleted", [
        `**${product.name}** has been removed from the store.`
      ], true);
    }

    if (commandName === "products") {
      return showProductCatalogue(interaction, "catalogue");
    }

    if (commandName === "purchase-product") {
      return showProductCatalogue(interaction, "purchase");
    }

    if (commandName === "search-products") {
      const query = cleanText(
        interaction.options.getString("query"),
        100
      ).toLowerCase();

      const results = getActiveProducts().filter(product =>
        `${product.name} ${product.description} ${product.category}`
          .toLowerCase()
          .includes(query)
      );

      if (!results.length) {
        return panelReply(interaction, "Search results", [
          `No products matched **${query}**.`
        ], true);
      }

      const sections = results.slice(0, 10).map(product =>
        formatProduct(product)
      );

      if (results.length > 10) {
        sections.push(
          `Showing 10 of ${results.length} matching products. Use /products to browse the catalogue.`
        );
      }

      return panelReply(
        interaction,
        "Search results",
        sections,
        true
      );
    }

    if (commandName === "embed") {
      if (!(await requireAdmin(interaction))) return;

      const channel = interaction.options.getChannel("channel");

      if (!channel || !channel.isTextBased()) {
        return panelReply(
          interaction,
          "Invalid channel",
          ["Choose a standard text channel."],
          true
        );
      }

      const products = getActiveProducts();

      if (!products.length) {
        return panelReply(
          interaction,
          "No products available",
          ["Create at least one product before publishing the catalogue."],
          true
        );
      }

      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });

      try {
        const webhook = await createStoreWebhook(channel);

        const sections = products.slice(0, 10).map(product =>
          formatProduct(product)
        );

        if (products.length > 10) {
          sections.push(
            `There are ${products.length} products in total. Use /products to browse the full catalogue.`
          );
        }

        await webhook.send({
          components: [
            makePanel("Rover product catalogue", sections)
          ],
          flags: MessageFlags.IsComponentsV2
        });

        return interaction.editReply({
          content: `The product catalogue has been published in ${channel}.`
        });
      } catch (error) {
        console.error("Catalogue publication failed:", error);

        return interaction.editReply({
          content: "Could not publish the catalogue. Check the bot's channel permissions, including Manage Webhooks, View Channel and Send Messages."
        });
      }
    }

    if (commandName === "shop-info") {
      if (!(await requireAdmin(interaction))) return;

      const activeProducts = getActiveProducts().length;
      const activeGiveaways = data.giveaways.filter(
        giveaway => !giveaway.ended
      ).length;

      return panelReply(interaction, "Store overview", [
        `**Available products:** ${activeProducts}`,
        `**Total products saved:** ${data.products.length}`,
        `**Active giveaways:** ${activeGiveaways}`,
        `**Recorded deliveries:** ${data.deliveries.length}`
      ], true);
    }

    if (commandName === "information") {
      if (!(await requireAdmin(interaction))) return;

      const channel = interaction.options.getChannel("channel")
        || interaction.channel;

      if (!channel?.isTextBased()) {
        return panelReply(
          interaction,
          "Invalid channel",
          ["Choose a text channel."],
          true
        );
      }

      await channel.send({
        components: [
          makePanel("Welcome to Rover", [
            "Rover helps manage the Rover Official Store and its digital products.",
            "**Browse products:** Use `/products` to explore the catalogue.",
            "**Purchase information:** Use `/purchase-product` to view product details and available purchase links.",
            "**Giveaways:** Keep an eye on store giveaways for opportunities to win prizes.",
            "For help with an order, contact the store team."
          ])
        ],
        flags: MessageFlags.IsComponentsV2
      });

      return panelReply(interaction, "Information published", [
        `The Rover information panel has been posted in ${channel}.`
      ], true);
    }

    if (commandName === "giveaway") {
      if (!(await requireAdmin(interaction))) return;

      const prize = cleanText(
        interaction.options.getString("prize"),
        200
      );

      const channel = interaction.options.getChannel("channel");
      const durationHours = interaction.options.getInteger(
        "duration-hours"
      );

      if (!channel?.isTextBased()) {
        return panelReply(
          interaction,
          "Invalid channel",
          ["Choose a text channel for the giveaway."],
          true
        );
      }

      const giveaway = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prize,
        channelId: channel.id,
        messageId: null,
        entries: [],
        endsAt: Date.now() + durationHours * 60 * 60 * 1000,
        ended: false,
        createdBy: interaction.user.id
      };

      const entryButton = new ButtonBuilder()
        .setCustomId(`rover_giveaway_enter:${giveaway.id}`)
        .setLabel("Enter giveaway")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(
        entryButton
      );

      try {
        const message = await channel.send({
          components: [
            makePanel("Rover giveaway", [
              `**Prize:** ${prize}`,
              `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:F>`,
              "Press the button below to enter.",
              "One entry per person."
            ]),
            row
          ],
          flags: MessageFlags.IsComponentsV2
        });

        giveaway.messageId = message.id;
        data.giveaways.push(giveaway);
        saveData();

        const delay = giveaway.endsAt - Date.now();

        setTimeout(
          () => finishGiveaway(giveaway.id),
          Math.min(delay, 2147483647)
        );

        return panelReply(interaction, "Giveaway created", [
          `The giveaway for **${prize}** has been posted in ${channel}.`,
          `Duration: ${durationHours} hour(s).`
        ], true);
      } catch (error) {
        console.error("Could not create giveaway:", error);

        return panelReply(
          interaction,
          "Giveaway failed",
          ["I could not post the giveaway. Check the bot's channel permissions."],
          true
        );
      }
    }

    if (commandName === "end-giveaway") {
      if (!(await requireAdmin(interaction))) return;

      const id = interaction.options.getString("giveaway");

      const giveaway = data.giveaways.find(
        item =>
          String(item.id) === String(id) &&
          !item.ended
      );

      if (!giveaway) {
        return panelReply(
          interaction,
          "Giveaway not found",
          ["Choose an active giveaway from the autocomplete list."],
          true
        );
      }

      await finishGiveaway(giveaway.id);

      return panelReply(interaction, "Giveaway ended", [
        `The giveaway for **${giveaway.prize}** has been ended.`
      ], true);
    }

    if (commandName === "give-product") {
      if (!(await requireAdmin(interaction))) return;

      const customer = interaction.options.getUser("customer");
      const productId = interaction.options.getString("product");
      const notes = cleanText(
        interaction.options.getString("notes") || "",
        500
      );

      const product = getProduct(productId);

      if (!product) {
        return panelReply(
          interaction,
          "Product not found",
          ["Choose an existing product from the autocomplete list."],
          true
        );
      }

      const delivery = {
        customerId: customer.id,
        productId: product.id,
        productName: product.name,
        notes,
        deliveredBy: interaction.user.id,
        deliveredAt: Date.now()
      };

      data.deliveries.push(delivery);
      saveData();

      return panelReply(interaction, "Delivery recorded", [
        `**Customer:** ${customer}`,
        `**Product:** ${product.name}`,
        `**Recorded by:** ${interaction.user}`,
        notes ? `**Notes:** ${notes}` : "No additional notes were provided.",
        "This records a delivery; it does not automatically send the product to the customer."
      ], true);
    }
  } catch (error) {
    console.error(
      `Command or interaction failed:`,
      error
    );

    const response = {
      content: "Something went wrong. Check the bot console and its Discord permissions.",
      flags: MessageFlags.Ephemeral
    };

    if (interaction.isRepliable()) {
      if (interaction.deferred) {
        await interaction.editReply(response).catch(() => {});
      } else if (interaction.replied) {
        await interaction.followUp(response).catch(() => {});
      } else {
        await interaction.reply(response).catch(() => {});
      }
    }
  }
});

client.login(TOKEN).catch(error => {
  console.error("Rover could not log in:", error);
  process.exit(1);
});
