require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

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
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const FOOTER = "Rover Official Store";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "bot-data.json");

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    "Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID."
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function emptyData() {
  return {
    products: [],
    giveaways: [],
    deliveries: [],
    shopInfo: {
      name: "Rover Official Store",
      description: "Browse our digital product catalogue.",
      support: "",
      terms: "",
    },
  };
}

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(emptyData(), null, 2)
    );
  }

  try {
    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    return {
      ...emptyData(),
      ...saved,
      products: Array.isArray(saved.products)
        ? saved.products
        : [],
      giveaways: Array.isArray(saved.giveaways)
        ? saved.giveaways
        : [],
      deliveries: Array.isArray(saved.deliveries)
        ? saved.deliveries
        : [],
      shopInfo: {
        ...emptyData().shopInfo,
        ...(saved.shopInfo || {}),
      },
    };
  } catch (error) {
    console.error("Could not load saved data:", error);
    return emptyData();
  }
}

let data = loadData();

function saveData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(data, null, 2)
  );

  fs.renameSync(temporaryFile, DATA_FILE);
}

function makePanel(title, sections = []) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}`)
  );

  for (const section of sections) {
    if (section) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          String(section)
        )
      );
    }
  }

  // Keep panels clean: one divider above the footer.
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${FOOTER}`
    )
  );

  return container;
}

async function panelReply(
  interaction,
  title,
  sections = [],
  ephemeral = true
) {
  const flags =
    MessageFlags.IsComponentsV2 |
    (ephemeral ? MessageFlags.Ephemeral : 0);

  const payload = {
    components: [makePanel(title, sections)],
    flags,
  };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

function isAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    ) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  );
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction)) return true;

  await panelReply(
    interaction,
    "Permission required",
    [
      "You need **Manage Server** or **Administrator** to use this command.",
    ],
    true
  );

  return false;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function validUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function productById(id) {
  return data.products.find(
    (product) => product.id === id
  );
}

function productOptions(products) {
  return products.slice(0, 25).map((product) => ({
    label: clean(product.name, 100),
    description: clean(
      `${product.price || "Price not set"}${
        product.category ? ` • ${product.category}` : ""
      }`,
      100
    ),
    value: product.id,
  }));
}

function productSummary(product) {
  const lines = [
    `**${product.name}**`,
    product.description || "No description provided.",
    `**Price:** ${product.price || "Not set"}`,
  ];

  if (product.category) {
    lines.push(`**Category:** ${product.category}`);
  }

  if (product.purchaseUrl) {
    lines.push(`[Purchase link](${product.purchaseUrl})`);
  }

  if (product.imageUrl) {
    lines.push(`[Product image](${product.imageUrl})`);
  }

  return lines.join("\n");
}

function createProductModal() {
  return new ModalBuilder()
    .setCustomId("rover:product:create")
    .setTitle("Create a product")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Product name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("price")
          .setLabel("Price")
          .setPlaceholder("£4.99 or Free")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Product description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("purchaseUrl")
          .setLabel("Purchase URL (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(300)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("category")
          .setLabel("Category (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
      )
    );
}

function editProductModal(product) {
  return new ModalBuilder()
    .setCustomId(`rover:product:edit:${product.id}`)
    .setTitle("Edit product")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Product name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(product.name)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("price")
          .setLabel("Price")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
          .setValue(product.price || "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(product.description || "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("purchaseUrl")
          .setLabel("Purchase URL (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(300)
          .setValue(product.purchaseUrl || "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("category")
          .setLabel("Category (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(80)
          .setValue(product.category || "")
      )
    );
}

function searchModal() {
  return new ModalBuilder()
    .setCustomId("rover:product:search")
    .setTitle("Search products")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("query")
          .setLabel("Search by name, category or keyword")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
      )
    );
}

function shopInfoModal() {
  return new ModalBuilder()
    .setCustomId("rover:shop:edit")
    .setTitle("Edit shop information")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("name")
          .setLabel("Shop name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setValue(data.shopInfo.name)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("description")
          .setLabel("Shop description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setValue(data.shopInfo.description)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("support")
          .setLabel("Support URL (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(300)
          .setValue(data.shopInfo.support || "")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("terms")
          .setLabel("Terms URL (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(300)
          .setValue(data.shopInfo.terms || "")
      )
    );
}

function giveawayModal() {
  return new ModalBuilder()
    .setCustomId("rover:giveaway:create")
    .setTitle("Create a giveaway")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("prize")
          .setLabel("Giveaway prize")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(150)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel("Duration (30m, 2h or 1d)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(20)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("winners")
          .setLabel("Number of winners (1–10)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("details")
          .setLabel("Extra details (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
      )
    );
}

function parseDuration(input) {
  const match = clean(input, 20)
    .toLowerCase()
    .match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1) return null;

  const unit = match[2];
  const multiplier = unit.startsWith("m")
    ? 60_000
    : unit.startsWith("h")
      ? 3_600_000
      : 86_400_000;

  const duration = amount * multiplier;

  if (duration > 7 * 86_400_000) return null;

  return duration;
}

async function publishCatalogue(channel, page = 0) {
  const products = data.products.filter(
    (product) => product.active !== false
  );

  const pageSize = 5;
  const maxPage = Math.max(
    0,
    Math.ceil(products.length / pageSize) - 1
  );

  page = Math.max(0, Math.min(page, maxPage));

  const selected = products.slice(
    page * pageSize,
    page * pageSize + pageSize
  );

  const sections = [
    data.shopInfo.description,
    selected.length
      ? selected.map(productSummary).join("\n\n")
      : "There are no products listed yet.",
    `Page **${page + 1}/${maxPage + 1}** • **${products.length}** products`,
  ];

  const components = [makePanel(data.shopInfo.name, sections)];

  if (maxPage > 0) {
    components.push(
      new ContainerBuilder().addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rover:catalogue:page:${page - 1}`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
          new ButtonBuilder()
            .setCustomId(`rover:catalogue:page:${page + 1}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === maxPage)
        )
      )
    );
  }

  return channel.send({
    components,
    flags: MessageFlags.IsComponentsV2,
  });
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check Rover's response time"),

  new SlashCommandBuilder()
    .setName("create-product")
    .setDescription("Add a product to your catalogue")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("edit-product")
    .setDescription("Edit an existing product")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("delete-product")
    .setDescription("Remove a product from your catalogue")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("products")
    .setDescription("Publish the public product catalogue")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("purchase-product")
    .setDescription("Get product details and its purchase link")
    .addStringOption((option) =>
      option
        .setName("product")
        .setDescription("Choose a product")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName("search-products")
    .setDescription("Search the product catalogue"),

  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Publish a custom shop panel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("shop-info")
    .setDescription("View or edit shop information")
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription("Choose an action")
        .setRequired(true)
        .addChoices(
          {
            name: "View information",
            value: "view",
          },
          {
            name: "Edit information",
            value: "edit",
          }
        )
    ),

  new SlashCommandBuilder()
    .setName("information")
    .setDescription("Learn about Rover"),

  new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create a giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("end-giveaway")
    .setDescription("End an active giveaway")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("give-product")
    .setDescription("Record delivery of a product")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      {
        body: commands.map((command) => command.toJSON()),
      }
    );

    console.log(
      `Registered ${commands.length} Rover slash commands.`
    );
  } catch (error) {
    console.error("Command registration failed:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "purchase-product") {
        const query = clean(
          interaction.options.getFocused(),
          100
        ).toLowerCase();

        const choices = data.products
          .filter(
            (product) =>
              product.active !== false &&
              product.name.toLowerCase().includes(query)
          )
          .slice(0, 25)
          .map((product) => ({
            name: `${product.name} — ${product.price || "Price not set"}`.slice(0, 100),
            value: product.id,
          }));

        return interaction.respond(choices);
      }

      return interaction.respond([]);
    }

    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case "ping":
          return panelReply(
            interaction,
            "Rover status",
            [
              `WebSocket latency: **${client.ws.ping} ms**`,
              `Listed products: **${data.products.filter((p) => p.active !== false).length}**`,
              "Rover is responding.",
            ],
            false
          );

        case "create-product":
          if (!(await requireAdmin(interaction))) return;

          return interaction.reply({
            components: [
              makePanel("Create a product", [
                "Add a product to your shop catalogue.",
                "Press the button below to enter its details.",
              ]),
              new ContainerBuilder().addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId("rover:product:create:open")
                    .setLabel("Add product")
                    .setStyle(ButtonStyle.Primary)
                )
              ),
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral,
          });

        case "edit-product":
          if (!(await requireAdmin(interaction))) return;

          if (!data.products.length) {
            return panelReply(
              interaction,
              "No products",
              ["Create a product first."],
              true
            );
          }

          return interaction.reply({
            components: [
              makePanel("Edit a product", [
                "Choose which product you want to update.",
              ]),
              new ContainerBuilder().addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new StringSelectMenuBuilder()
                    .setCustomId("rover:product:edit:select")
                    .setPlaceholder("Select a product")
                    .addOptions(productOptions(data.products))
                )
              ),
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral,
          });

        case "delete-product":
          if (!(await requireAdmin(interaction))) return;

          if (!data.products.length) {
            return panelReply(
              interaction,
              "No products",
              ["There are no products to delete."],
              true
            );
          }

          return interaction.reply({
            components: [
              makePanel("Delete a product", [
                "Select a product to remove it from your catalogue.",
              ]),
              new ContainerBuilder().addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new StringSelectMenuBuilder()
                    .setCustomId("rover:product:delete:select")
                    .setPlaceholder("Select a product")
                    .addOptions(productOptions(data.products))
                )
              ),
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral,
          });

        case "products":
          if (!(await requireAdmin(interaction))) return;

          await interaction.deferReply({
            flags: MessageFlags.Ephemeral,
          });

          await publishCatalogue(interaction.channel, 0);

          return panelReply(
            interaction,
            "Catalogue published",
            ["Your public catalogue has been posted in this channel."],
            true
          );

        case "purchase-product": {
          const product = productById(
            interaction.options.getString("product")
          );

          if (!product || product.active === false) {
            return panelReply(
              interaction,
              "Product unavailable",
              ["This product could not be found."],
              true
            );
          }

          return panelReply(
            interaction,
            "Product details",
            [
              productSummary(product),
              product.purchaseUrl
                ? ""
                : "The shop has not added a purchase URL yet.",
            ],
            true
          );
        }

        case "search-products":
          return interaction.showModal(searchModal());

        case "shop-info": {
          const action = interaction.options.getString("action");

          if (action === "edit") {
            if (!(await requireAdmin(interaction))) return;
            return interaction.showModal(shopInfoModal());
          }

          return panelReply(
            interaction,
            data.shopInfo.name,
            [
              data.shopInfo.description,
              data.shopInfo.support
                ? `[Support](${data.shopInfo.support})`
                : "",
              data.shopInfo.terms
                ? `[Terms and conditions](${data.shopInfo.terms})`
                : "",
            ],
            false
          );
        }

        case "information":
          return panelReply(
            interaction,
            "About Rover",
            [
              "Rover helps manage a digital product shop, catalogue, giveaways and delivery records.",
              "Use `/products` to publish your catalogue and `/search-products` to find an item.",
              "Rover provides purchase links but does not process payments.",
            ],
            false
          );

        case "embed":
          if (!(await requireAdmin(interaction))) return;

          return interaction.showModal(
            new ModalBuilder()
              .setCustomId("rover:embed:create")
              .setTitle("Create a custom panel")
              .addComponents(
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("title")
                    .setLabel("Panel title")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMaxLength(100)
                ),
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("description")
                    .setLabel("Panel message")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(3500)
                ),
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("linkLabel")
                    .setLabel("Optional link button label")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(80)
                ),
                new ActionRowBuilder().addComponents(
                  new TextInputBuilder()
                    .setCustomId("linkUrl")
                    .setLabel("Optional link URL")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(300)
                )
              )
          );

        case "giveaway":
          if (!(await requireAdmin(interaction))) return;

          return interaction.showModal(
            giveawayModal()
          );

        case "end-giveaway": {
          if (!(await requireAdmin(interaction))) return;

          const active = data.giveaways.filter(
            (giveaway) => !giveaway.ended
          );

          if (!active.length) {
            return panelReply(
              interaction,
              "No active giveaways",
              ["There are no active giveaways to end."],
              true
            );
          }

          return interaction.reply({
            components: [
              makePanel("End a giveaway", [
                "Choose which giveaway to end.",
              ]),
              new ContainerBuilder().addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new StringSelectMenuBuilder()
                    .setCustomId("rover:giveaway:end:select")
                    .setPlaceholder("Select a giveaway")
                    .addOptions(
                      active.slice(0, 25).map((giveaway) => ({
                        label: clean(giveaway.prize, 100),
                        description: "End this giveaway early",
                        value: giveaway.id,
                      }))
                    )
                )
              ),
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral,
          });
        }

        case "give-product": {
          if (!(await requireAdmin(interaction))) return;

          const products = data.products.filter(
            (product) => product.active !== false
          );

          if (!products.length) {
            return panelReply(
              interaction,
              "No products",
              ["Create a product before recording a delivery."],
              true
            );
          }

          return interaction.reply({
            components: [
              makePanel("Record a delivery", [
                "Choose the product, then select the customer.",
                "This records the delivery; it does not send files automatically.",
              ]),
              new ContainerBuilder().addActionRowComponents(
                new ActionRowBuilder().addComponents(
                  new StringSelectMenuBuilder()
                    .setCustomId("rover:delivery:product")
                    .setPlaceholder("Select a product")
                    .addOptions(productOptions(products))
                )
              ),
            ],
            flags:
              MessageFlags.IsComponentsV2 |
              MessageFlags.Ephemeral,
          });
        }
      }
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === "rover:product:create:open") {
        if (!(await requireAdmin(interaction))) return;
        return interaction.showModal(createProductModal());
      }

      if (id === "rover:cancel") {
        return panelReply(
          interaction,
          "Cancelled",
          ["No changes were made."],
          true
        );
      }

      if (id.startsWith("rover:catalogue:page:")) {
        const page = Number(id.split(":").pop());
        await interaction.deferUpdate();
        return publishCatalogue(interaction.channel, page);
      }

      if (id.startsWith("rover:product:delete:confirm:")) {
        if (!(await requireAdmin(interaction))) return;

        const productId = id.split(":").pop();
        const index = data.products.findIndex(
          (product) => product.id === productId
        );

        if (index === -1) {
          return panelReply(
            interaction,
            "Product not found",
            ["This product has already been removed."],
            true
          );
        }

        const [removed] = data.products.splice(index, 1);
        saveData();

        return panelReply(
          interaction,
          "Product deleted",
          [`**${removed.name}** has been removed.`],
          true
        );
      }

      if (id.startsWith("rover:giveaway:join:")) {
        const giveawayId = id.split(":").pop();
        const giveaway = data.giveaways.find(
          (item) => item.id === giveawayId && !item.ended
        );

        if (!giveaway || giveaway.endsAt <= Date.now()) {
          return panelReply(
            interaction,
            "Giveaway closed",
            ["This giveaway has ended."],
            true
          );
        }

        if (giveaway.entrants.includes(interaction.user.id)) {
          return panelReply(
            interaction,
            "Already entered",
            ["You have already entered this giveaway."],
            true
          );
        }

        giveaway.entrants.push(interaction.user.id);
        saveData();

        return panelReply(
          interaction,
          "Entry confirmed",
          ["Your giveaway entry has been recorded. Good luck!"],
          true
        );
      }
    }

    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      const selectedId = interaction.values[0];

      if (id === "rover:product:edit:select") {
        const product = productById(selectedId);

        if (!product) {
          return panelReply(
            interaction,
            "Product not found",
            ["This product no longer exists."],
            true
          );
        }

        return interaction.showModal(
          editProductModal(product)
        );
      }

      if (id === "rover:product:delete:select") {
        const product = productById(selectedId);

        if (!product) {
          return panelReply(
            interaction,
            "Product not found",
            ["This product no longer exists."],
            true
          );
        }

        return interaction.reply({
          components: [
            makePanel("Confirm deletion", [
              `Delete **${product.name}**? This cannot be undone.`,
            ]),
            new ContainerBuilder().addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `rover:product:delete:confirm:${product.id}`
                  )
                  .setLabel("Delete product")
                  .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                  .setCustomId("rover:cancel")
                  .setLabel("Cancel")
                  .setStyle(ButtonStyle.Secondary)
              )
            ),
          ],
          flags:
            MessageFlags.IsComponentsV2 |
            MessageFlags.Ephemeral,
        });
      }

      if (id === "rover:delivery:product") {
        const product = productById(selectedId);

        if (!product) {
          return panelReply(
            interaction,
            "Product not found",
            ["This product no longer exists."],
            true
          );
        }

        return interaction.reply({
          components: [
            makePanel("Choose customer", [
              `Product: **${product.name}**`,
              "Select the customer who received the product.",
            ]),
            new ContainerBuilder().addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                  .setCustomId(
                    `rover:delivery:customer:${product.id}`
                  )
                  .setPlaceholder("Select customer")
                  .setMinValues(1)
                  .setMaxValues(1)
              )
            ),
          ],
          flags:
            MessageFlags.IsComponentsV2 |
            MessageFlags.Ephemeral,
        });
      }

      if (id === "rover:giveaway:end:select") {
        const giveaway = data.giveaways.find(
          (item) => item.id === selectedId && !item.ended
        );

        if (!giveaway) {
          return panelReply(
            interaction,
            "Giveaway not found",
            ["This giveaway has already ended."],
            true
          );
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });

        await finishGiveaway(giveaway);

        return panelReply(
          interaction,
          "Giveaway ended",
          [`The giveaway for **${giveaway.prize}** has ended.`],
          true
        );
      }
    }

    if (interaction.isUserSelectMenu()) {
      if (
        interaction.customId.startsWith(
          "rover:delivery:customer:"
        )
      ) {
        if (!(await requireAdmin(interaction))) return;

        const productId = interaction.customId.split(":").pop();
        const product = productById(productId);
        const customer = interaction.users.first();

        if (!product || !customer) {
          return panelReply(
            interaction,
            "Delivery not recorded",
            ["The product or customer could not be found."],
            true
          );
        }

        data.deliveries.push({
          id: makeId("delivery"),
          productId: product.id,
          productName: product.name,
          customerId: customer.id,
          moderatorId: interaction.user.id,
          createdAt: Date.now(),
        });

        saveData();

        return panelReply(
          interaction,
          "Delivery recorded",
          [
            `**Product:** ${product.name}`,
            `**Customer:** ${customer}`,
            "The delivery record has been saved.",
          ],
          true
        );
      }
    }

    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (
        id === "rover:product:create" ||
        id.startsWith("rover:product:edit:")
      ) {
        if (!(await requireAdmin(interaction))) return;

        const name = clean(
          interaction.fields.getTextInputValue("name"),
          100
        );
        const price = clean(
          interaction.fields.getTextInputValue("price"),
          80
        );
        const description = clean(
          interaction.fields.getTextInputValue("description"),
          1000
        );
        const purchaseUrl = clean(
          interaction.fields.getTextInputValue("purchaseUrl"),
          300
        );
        const category = clean(
          interaction.fields.getTextInputValue("category"),
          80
        );

        if (purchaseUrl && !validUrl(purchaseUrl)) {
          return panelReply(
            interaction,
            "Invalid purchase URL",
            ["Use a valid HTTP or HTTPS link."],
            true
          );
        }

        if (id === "rover:product:create") {
          const duplicate = data.products.some(
            (product) =>
              product.name.toLowerCase() === name.toLowerCase()
          );

          if (duplicate) {
            return panelReply(
              interaction,
              "Product already exists",
              ["Use `/edit-product` to update the existing product."],
              true
            );
          }

          data.products.push({
            id: makeId("product"),
            name,
            price,
            description,
            purchaseUrl,
            category,
            active: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });

          saveData();

          return panelReply(
            interaction,
            "Product created",
            [
              `**${name}** has been added to your catalogue.`,
              "Use `/products` to publish the updated catalogue.",
            ],
            true
          );
        }

        const productId = id.split(":").pop();
        const product = productById(productId);

        if (!product) {
          return panelReply(
            interaction,
            "Product not found",
            ["This product no longer exists."],
            true
          );
        }

        product.name = name;
        product.price = price;
        product.description = description;
        product.purchaseUrl = purchaseUrl;
        product.category = category;
        product.updatedAt = Date.now();

        saveData();

        return panelReply(
          interaction,
          "Product updated",
          [
            `**${name}** has been updated.`,
            "Use `/products` to publish the updated catalogue.",
          ],
          true
        );
      }

      if (id === "rover:product:search") {
        const query = clean(
          interaction.fields.getTextInputValue("query"),
          100
        ).toLowerCase();

        const results = data.products.filter((product) =>
          product.active !== false &&
          `${product.name} ${product.category || ""} ${product.description || ""}`
            .toLowerCase()
            .includes(query)
        ).slice(0, 10);

        return panelReply(
          interaction,
          "Search results",
          [
            results.length
              ? results.map(productSummary).join("\n\n")
              : `No products matched **${query}**.`,
          ],
          true
        );
      }

      if (id === "rover:shop:edit") {
        if (!(await requireAdmin(interaction))) return;

        const name = clean(
          interaction.fields.getTextInputValue("name"),
          100
        );
        const description = clean(
          interaction.fields.getTextInputValue("description"),
          1000
        );
        const support = clean(
          interaction.fields.getTextInputValue("support"),
          300
        );
        const terms = clean(
          interaction.fields.getTextInputValue("terms"),
          300
        );

        if (
          (support && !validUrl(support)) ||
          (terms && !validUrl(terms))
        ) {
          return panelReply(
            interaction,
            "Invalid URL",
            ["Support and terms must be valid HTTP or HTTPS links."],
            true
          );
        }

        data.shopInfo = {
          name,
          description,
          support,
          terms,
        };

        saveData();

        return panelReply(
          interaction,
          "Shop information saved",
          ["Your shop details have been updated."],
          true
        );
      }

      if (id === "rover:embed:create") {
        if (!(await requireAdmin(interaction))) return;

        const title = clean(
          interaction.fields.getTextInputValue("title"),
          100
        );
        const description = clean(
          interaction.fields.getTextInputValue("description"),
          3500
        );
        const linkLabel = clean(
          interaction.fields.getTextInputValue("linkLabel"),
          80
        );
        const linkUrl = clean(
          interaction.fields.getTextInputValue("linkUrl"),
          300
        );

        if (linkUrl && !validUrl(linkUrl)) {
          return panelReply(
            interaction,
            "Invalid URL",
            ["The link must be a valid HTTP or HTTPS URL."],
            true
          );
        }

        if (linkLabel && !linkUrl) {
          return panelReply(
            interaction,
            "Missing URL",
            ["Provide a URL for the link button."],
            true
          );
        }

        const components = [
          makePanel(title, [description]),
        ];

        if (linkLabel && linkUrl) {
          components.push(
            new ContainerBuilder().addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setLabel(linkLabel)
                  .setStyle(ButtonStyle.Link)
                  .setURL(linkUrl)
              )
            )
          );
        }

        await interaction.channel.send({
          components,
          flags: MessageFlags.IsComponentsV2,
        });

        return panelReply(
          interaction,
          "Panel published",
          ["Your custom panel has been posted."],
          true
        );
      }

      if (id === "rover:giveaway:create") {
        if (!(await requireAdmin(interaction))) return;

        const prize = clean(
          interaction.fields.getTextInputValue("prize"),
          150
        );
        const duration = parseDuration(
          interaction.fields.getTextInputValue("duration")
        );
        const winnerCount = Number(
          clean(
            interaction.fields.getTextInputValue("winners"),
            2
          )
        );
        const details = clean(
          interaction.fields.getTextInputValue("details"),
          500
        );

        if (!duration) {
          return panelReply(
            interaction,
            "Invalid duration",
            ["Use `30m`, `2h` or `1d`. The maximum is 7 days."],
            true
          );
        }

        if (
          !Number.isInteger(winnerCount) ||
          winnerCount < 1 ||
          winnerCount > 10
        ) {
          return panelReply(
            interaction,
            "Invalid winner count",
            ["Enter a number from 1 to 10."],
            true
          );
        }

        const giveaway = {
          id: makeId("giveaway"),
          prize,
          details,
          winnerCount,
          hostId: interaction.user.id,
          channelId: interaction.channelId,
          messageId: null,
          createdAt: Date.now(),
          endsAt: Date.now() + duration,
          entrants: [],
          winners: [],
          ended: false,
        };

        data.giveaways.push(giveaway);
        saveData();

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral,
        });

        await publishGiveaway(giveaway);

        return panelReply(
          interaction,
          "Giveaway published",
          [
            `Your giveaway for **${prize}** is now live.`,
            `It ends <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`,
          ],
          true
        );
      }
    }
  } catch (error) {
    console.error("Interaction failed:", error);

    const response = {
      content: "Something went wrong. Check the bot console for details.",
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(response);
      } else if (interaction.isRepliable()) {
        await interaction.reply(response);
      }
    } catch {}
  }
});

const giveawayTimers = new Map();

async function publishGiveaway(giveaway) {
  const channel = await client.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const message = await channel.send({
    components: [
      makePanel("Giveaway", [
        `**Prize:** ${giveaway.prize}`,
        giveaway.details || "",
        `**Winners:** ${giveaway.winnerCount}`,
        `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
        `Hosted by <@${giveaway.hostId}>`,
      ]),
      new ContainerBuilder().addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rover:giveaway:join:${giveaway.id}`)
            .setLabel("Enter giveaway")
            .setStyle(ButtonStyle.Primary)
        )
      ),
    ],
    flags: MessageFlags.IsComponentsV2,
  });

  giveaway.messageId = message.id;
  saveData();
  scheduleGiveaway(giveaway);
}

function scheduleGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  if (giveawayTimers.has(giveaway.id)) {
    clearTimeout(giveawayTimers.get(giveaway.id));
  }

  const delay = Math.max(0, giveaway.endsAt - Date.now());

  giveawayTimers.set(
    giveaway.id,
    setTimeout(() => {
      finishGiveaway(giveaway).catch(console.error);
    }, delay)
  );
}

async function finishGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  giveaway.ended = true;

  const entrants = [...giveaway.entrants];
  const winners = [];

  while (
    entrants.length &&
    winners.length < giveaway.winnerCount
  ) {
    const index = Math.floor(Math.random() * entrants.length);
    winners.push(entrants.splice(index, 1)[0]);
  }

  giveaway.winners = winners;
  saveData();

  const channel = await client.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const result = winners.length
    ? `Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}!`
    : "No valid entries were received.";

  await channel.send({
    components: [
      makePanel("Giveaway results", [
        `**Prize:** ${giveaway.prize}`,
        result,
        `**Entries:** ${giveaway.entrants.length}`,
      ]),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

client.login(TOKEN).catch((error) => {
  console.error("Discord login failed:", error);
  process.exit(1);
});
