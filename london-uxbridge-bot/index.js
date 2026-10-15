require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

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
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID
} = process.env;

const PURPLE = 0x8B70C8;
const FOOTER = 'Rover Official Store';

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bot-data.json');

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.error(
    'Missing environment variables: DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.'
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const defaultData = () => ({
  products: [],
  giveaways: [],
  deliveries: [],
  moderation: []
});

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(defaultData(), null, 2)
    );
  }

  try {
    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );

    const defaults = defaultData();

    return {
      ...defaults,
      ...saved,
      products: Array.isArray(saved.products) ? saved.products : [],
      giveaways: Array.isArray(saved.giveaways)
        ? saved.giveaways
        : [],
      deliveries: Array.isArray(saved.deliveries)
        ? saved.deliveries
        : [],
      moderation: Array.isArray(saved.moderation)
        ? saved.moderation
        : []
    };
  } catch (error) {
    console.error('Could not load saved data:', error);
    return defaultData();
  }
}

let data = loadData();
let saveQueue = Promise.resolve();

function saveData() {
  saveQueue = saveQueue.then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const temporaryFile = `${DATA_FILE}.tmp`;

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(data, null, 2)
    );

    fs.renameSync(temporaryFile, DATA_FILE);
  }).catch(error => {
    console.error('Could not save data:', error);
  });

  return saveQueue;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36).slice(2, 8)}`;
}

function clean(value, maxLength = 1000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function validUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);

    return url.protocol === 'https:' ||
      url.protocol === 'http:';
  } catch {
    return false;
  }
}

function activeProducts() {
  return data.products.filter(
    product => product.active !== false
  );
}

function productById(id) {
  return data.products.find(product => product.id === id);
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

/* -------------------- COMPONENTS V2 PANELS -------------------- */

function makePanel(title, sections = []) {
  const container = new ContainerBuilder()
    .setAccentColor(PURPLE);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}`)
  );

  for (const section of sections) {
    if (section) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(String(section))
      );
    }
  }

  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true)
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${FOOTER}`)
  );

  return container;
}

function panelPayload(
  title,
  sections = [],
  ephemeral = true,
  extraComponents = []
) {
  return {
    components: [
      makePanel(title, sections),
      ...extraComponents
    ],
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] }
  };
}

async function panelReply(
  interaction,
  title,
  sections = [],
  ephemeral = true,
  extraComponents = []
) {
  const response = panelPayload(
    title,
    sections,
    ephemeral,
    extraComponents
  );

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(response);
  }

  return interaction.reply(response);
}

function buttonRow(buttons) {
  return new ContainerBuilder()
    .setAccentColor(PURPLE)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(...buttons)
    );
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction)) return true;

  await panelReply(interaction, 'Permission Required', [
    'You need **Manage Server** or **Administrator** to use this command.'
  ]);

  return false;
}

function productOptions(products) {
  return products.slice(0, 25).map(product => ({
    label: clean(product.name, 100) || 'Unnamed product',
    description: clean(
      `${product.price || 'Price not set'}${
        product.category ? ` • ${product.category}` : ''
      }`,
      100
    ),
    value: product.id
  }));
}

function productSummary(product) {
  const lines = [
    `**${product.name}**`,
    product.description || 'No description provided.',
    `**Price:** ${product.price || 'Not set'}`
  ];

  if (product.category) {
    lines.push(`**Category:** ${product.category}`);
  }

  if (product.purchaseUrl) {
    lines.push(`[Purchase link](${product.purchaseUrl})`);
  }

  return lines.join('\n');
}

/* -------------------- MODALS -------------------- */

function textInput(
  id,
  label,
  style = TextInputStyle.Short,
  required = true,
  value = '',
  maxLength = 1000
) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);

  if (value) {
    input.setValue(String(value).slice(0, maxLength));
  }

  return new ActionRowBuilder().addComponents(input);
}

function productModal(product = null) {
  const editing = Boolean(product);

  return new ModalBuilder()
    .setCustomId(
      editing
        ? `rover:product:edit:${product.id}`
        : 'rover:product:create'
    )
    .setTitle(editing ? 'Edit Product' : 'Create Product')
    .addComponents(
      textInput('name', 'Product name', TextInputStyle.Short, true, product?.name || '', 100),
      textInput('price', 'Price', TextInputStyle.Short, true, product?.price || '', 80),
      textInput('description', 'Description', TextInputStyle.Paragraph, true, product?.description || '', 1000),
      textInput('url', 'Purchase URL (optional)', TextInputStyle.Short, false, product?.purchaseUrl || '', 300),
      textInput('category', 'Category (optional)', TextInputStyle.Short, false, product?.category || '', 80)
    );
}

function customPanelModal() {
  return new ModalBuilder()
    .setCustomId('rover:embed:create')
    .setTitle('Configure Custom Panel')
    .addComponents(
      textInput('title', 'Panel title', TextInputStyle.Short, true, '', 100),
      textInput('message', 'Panel message', TextInputStyle.Paragraph, true, '', 3500),
      textInput('buttonLabel', 'Optional link button label', TextInputStyle.Short, false, '', 80),
      textInput('url', 'Optional link URL', TextInputStyle.Short, false, '', 300)
    );
}

function giveawayModal() {
  return new ModalBuilder()
    .setCustomId('rover:giveaway:create')
    .setTitle('Configure Giveaway')
    .addComponents(
      textInput('prize', 'Giveaway prize', TextInputStyle.Short, true, '', 150),
      textInput('duration', 'Duration (30m, 2h, 1d)', TextInputStyle.Short, true, '', 20),
      textInput('winners', 'Number of winners (1–10)', TextInputStyle.Short, true, '1', 2),
      textInput('details', 'Additional details (optional)', TextInputStyle.Paragraph, false, '', 500)
    );
}

function parseDuration(value) {
  const match = clean(value, 20)
    .toLowerCase()
    .match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/);

  if (!match || Number(match[1]) < 1) return null;

  const unit = match[2];

  const multiplier = unit.startsWith('m')
    ? 60_000
    : unit.startsWith('h')
      ? 3_600_000
      : 86_400_000;

  const duration = Number(match[1]) * multiplier;

  if (duration > 7 * 86_400_000) return null;

  return duration;
}

/* -------------------- INFORMATION TOPICS -------------------- */

const informationTopics = {
  about: {
    title: 'About Rover',
    sections: [
      'Rover is a shop-management assistant for digital product communities.',
      '**Product management:** staff can create, edit and remove product records. Product information is stored in Rover’s local data file.',
      '**Purchases:** members can privately browse products and use the seller’s purchase link. Rover does not process payments or store card details.',
      '**Giveaways:** staff can publish giveaways, collect entries and draw random winners when the timer ends or staff end a giveaway.',
      '**Delivery:** staff can record that a customer received a product. Rover does not automatically deliver files or grant access.',
      '**Moderation:** authorised staff can use moderation commands, subject to Discord permissions and role hierarchy.',
      'Rover cannot guarantee the quality, safety or availability of a seller’s products.'
    ]
  },

  products: {
    title: 'Products and Purchases',
    sections: [
      '**Browsing:** use `/purchase` and choose a product from the dropdown. The response is private.',
      '**Before paying:** read the full description, check the listed price and category, and confirm the item is what you want.',
      '**Purchase links:** only use links provided by trusted shop staff. Check the destination and watch out for lookalike domains.',
      '**Payments:** Rover does not take payments, request card details or hold funds. Transactions happen with the seller or payment provider.',
      '**Problems:** save your receipt, order confirmation and relevant messages. Contact the seller’s official support team if a listing is incorrect or an order has not arrived.',
      '**Account security:** never provide passwords, one-time codes, backup codes or Discord account tokens.'
    ]
  },

  delivery: {
    title: 'Product Delivery',
    sections: [
      '**What staff record:** `/give-product` lets authorised staff select a product and customer. Rover records the product, customer, staff member and time.',
      '**What the record means:** it records that staff marked a delivery as completed. It does not itself send files, generate a licence, grant permissions or verify access.',
      '**Missing orders:** keep your proof of payment and order number, then contact the shop’s official support team privately.',
      '**Privacy:** share receipts and order details only with trusted staff through appropriate private channels. Do not post payment details publicly.',
      '**Notifications:** Rover attempts to DM the customer when staff record delivery. If DMs are closed, the record still exists but the notification may not be delivered.'
    ]
  },

  giveaways: {
    title: 'Giveaways',
    sections: [
      '**Entering:** press the Enter Giveaway button on an active giveaway post. Each Discord account can enter once per giveaway.',
      '**Closing time:** the post shows a relative countdown. Authorised staff can also end a giveaway early using `/end-giveaway`.',
      '**Winner selection:** Rover randomly selects up to the configured number of winners from unique recorded entries. If there are fewer entries than requested winners, only available entrants can win.',
      '**Results:** Rover posts the result in the giveaway channel and attempts to DM each winner.',
      '**Closed DMs:** if you win but do not receive a DM, check the public result and contact the giveaway host or server staff.',
      '**Scam warning:** legitimate staff should not ask for your password, account token or payment to release a prize.'
    ]
  },

  safety: {
    title: 'Safety and Support',
    sections: [
      '**Protect your account:** never share your Discord password, login codes, backup codes or account token. Staff do not need these.',
      '**Check links:** be cautious with shortened URLs, unexpected downloads, fake giveaways and websites impersonating trusted services.',
      '**Impersonation:** verify staff identities and announcements in the server. Do not trust a direct message solely because it uses a familiar name or logo.',
      '**Purchases:** review the product details and seller before paying. Keep receipts and order confirmations.',
      '**Report concerns:** contact the server’s official support or moderation team and provide relevant evidence privately.',
      '**Rover’s limitations:** the bot cannot guarantee a seller is trustworthy, reverse a payment or recover a compromised account.'
    ]
  },

  terms: {
    title: 'Terms and Refunds',
    sections: [
      '**Read before buying:** check the product description, price, delivery method and seller conditions before completing payment.',
      '**Refunds:** eligibility depends on the seller’s published terms, applicable consumer law and the payment provider’s rules. Rover cannot approve or issue refunds.',
      '**Keep evidence:** save the order confirmation, receipt, product listing and messages related to the transaction.',
      '**Missing or incorrect items:** contact the seller’s official support team first and explain what happened, including your order reference.',
      '**Payment disputes:** if you cannot resolve the issue with the seller, review the dispute or buyer-protection process offered by your payment provider.',
      '**Sensitive information:** do not send full card numbers, passwords, security codes or account tokens in public channels or DMs.'
    ]
  }
};

function informationMenu() {
  return new ContainerBuilder()
    .setAccentColor(PURPLE)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('rover:information:select')
          .setPlaceholder('Choose an information topic')
          .addOptions(
            {
              label: 'About Rover',
              value: 'about',
              description: 'Rover features and limitations'
            },
            {
              label: 'Products and Purchases',
              value: 'products',
              description: 'Browsing, prices and safe purchases'
            },
            {
              label: 'Delivery',
              value: 'delivery',
              description: 'Delivery records and missing orders'
            },
            {
              label: 'Giveaways',
              value: 'giveaways',
              description: 'Entries, draws and claiming prizes'
            },
            {
              label: 'Safety and Support',
              value: 'safety',
              description: 'Account safety and support'
            },
            {
              label: 'Terms and Refunds',
              value: 'terms',
              description: 'Shop terms and payment disputes'
            }
          )
      )
    );
}

/* -------------------- SLASH COMMANDS -------------------- */

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription("Check Rover's response time"),

  new SlashCommandBuilder()
    .setName('create-product')
    .setDescription('Create a product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('edit-product')
    .setDescription('Edit an existing product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('delete-product')
    .setDescription('Delete a product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Browse products and purchase links'),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Open the custom panel builder')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('information')
    .setDescription('Post the information panel in a selected channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('The channel where the information panel will be posted')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Open the giveaway setup panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('end-giveaway')
    .setDescription('End an active giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('give-product')
    .setDescription('Record product delivery')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Post a plain-text announcement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Announcement message')
        .setRequired(true)
        .setMaxLength(1900)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to ban').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to kick').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to timeout').setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Timeout duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to untimeout').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(500)
    )
];

/* -------------------- GIVEAWAY TIMERS -------------------- */

const giveawayTimers = new Map();

function scheduleGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  clearTimeout(giveawayTimers.get(giveaway.id));

  const remaining = giveaway.endsAt - Date.now();

  if (remaining <= 0) {
    finishGiveaway(giveaway).catch(error => {
      console.error('Could not finish giveaway:', error);
    });
    return;
  }

  giveawayTimers.set(
    giveaway.id,
    setTimeout(
      () => finishGiveaway(giveaway).catch(error => {
        console.error('Could not finish giveaway:', error);
      }),
      Math.min(remaining, 2_147_000_000)
    )
  );
}

async function finishGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  if (giveaway.endsAt > Date.now()) {
    scheduleGiveaway(giveaway);
    return;
  }

  giveaway.ended = true;

  clearTimeout(giveawayTimers.get(giveaway.id));
  giveawayTimers.delete(giveaway.id);

  const pool = [
    ...new Set(Array.isArray(giveaway.entrants) ? giveaway.entrants : [])
  ];

  const winners = [];

  while (pool.length && winners.length < giveaway.winnerCount) {
    const index = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(index, 1)[0]);
  }

  giveaway.winners = winners;
  giveaway.endedAt = Date.now();

  await saveData();

  const channel = await client.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  const resultText = winners.length
    ? winners.map(id => `<@${id}>`).join(', ')
    : 'No valid entries were received.';

  if (channel?.isTextBased() && channel.messages) {
    const oldMessage = giveaway.messageId
      ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
      : null;

    const resultPanel = makePanel('Giveaway Results', [
      `**Prize:** ${giveaway.prize}`,
      winners.length
        ? `**Winner${winners.length === 1 ? '' : 's'}:** ${resultText}`
        : resultText,
      `**Entries:** ${(giveaway.entrants || []).length}`
    ]);

    const resultPayload = {
      components: [resultPanel],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: winners }
    };

    if (oldMessage) {
      await oldMessage.edit(resultPayload).catch(async error => {
        console.error('Could not edit giveaway message:', error);
        await channel.send(resultPayload).catch(console.error);
      });
    } else {
      await channel.send(resultPayload).catch(console.error);
    }
  }

  for (const winnerId of winners) {
    try {
      const winner = await client.users.fetch(winnerId);

      await winner.send({
        components: [
          makePanel('You Won a Rover Giveaway!', [
            `Congratulations! You won **${giveaway.prize}**.`,
            `Server: **${channel?.guild?.name || 'Rover community'}**`,
            'Contact the giveaway host or server staff to claim your prize.'
          ])
        ],
        flags: MessageFlags.IsComponentsV2
      });
    } catch (error) {
      console.warn(`Could not DM giveaway winner ${winnerId}:`, error.message);
    }
  }
}

/* -------------------- MODERATION NOTICES -------------------- */

async function sendModerationNotice(
  user,
  action,
  guild,
  reason,
  duration = ''
) {
  try {
    await user.send({
      components: [
        makePanel('Moderation Notice', [
          `**Action:** ${action}`,
          `**Server:** ${guild.name}`,
          duration ? `**Duration:** ${duration}` : '',
          `**Reason:** ${reason || 'No reason provided.'}`,
          'If you believe this action was made in error, contact the server moderation team.'
        ])
      ],
      flags: MessageFlags.IsComponentsV2
    });

    return true;
  } catch {
    return false;
  }
}

/* -------------------- STARTUP -------------------- */

client.once('clientReady', async () => {
  console.log(`Rover is online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        DISCORD_CLIENT_ID,
        DISCORD_GUILD_ID
      ),
      {
        body: commands.map(command => command.toJSON())
      }
    );

    console.log(`Successfully registered ${commands.length} slash commands.`);

    for (const giveaway of data.giveaways) {
      // Older saved giveaways may not contain entrants.
      if (!Array.isArray(giveaway.entrants)) {
        giveaway.entrants = [];
      }

      if (!giveaway.ended) {
        scheduleGiveaway(giveaway);
      }
    }

    await saveData();
  } catch (error) {
    console.error('Startup or slash command registration failed:', error);
  }
});

/* -------------------- INTERACTIONS -------------------- */

client.on('interactionCreate', async interaction => {
  try {
    /* ---------- SLASH COMMANDS ---------- */

    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'ping':
          return panelReply(interaction, 'Rover Status', [
            `WebSocket latency: **${client.ws.ping} ms**`,
            `Active products: **${activeProducts().length}**`,
            `Active giveaways: **${data.giveaways.filter(g => !g.ended).length}**`,
            'Rover is online.'
          ]);

        case 'create-product':
          if (!await requireAdmin(interaction)) return;

          return interaction.reply(
            panelPayload(
              'Create a Product',
              [
                'Add a new product to Rover.',
                'Select the button below to enter the product details.'
              ],
              true,
              [
                buttonRow([
                  new ButtonBuilder()
                    .setCustomId('rover:product:create:open')
                    .setLabel('Create Product')
                    .setStyle(ButtonStyle.Primary)
                ])
              ]
            )
          );

        case 'edit-product':
          if (!await requireAdmin(interaction)) return;

          if (!data.products.length) {
            return panelReply(interaction, 'No Products', [
              'Create a product before trying to edit one.'
            ]);
          }

          return interaction.reply(
            panelPayload(
              'Edit a Product',
              ['Choose a product from the menu below.'],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new StringSelectMenuBuilder()
                        .setCustomId('rover:product:edit:select')
                        .setPlaceholder('Choose a product')
                        .addOptions(productOptions(data.products))
                    )
                  )
              ]
            )
          );

        case 'delete-product':
          if (!await requireAdmin(interaction)) return;

          if (!data.products.length) {
            return panelReply(interaction, 'No Products', [
              'There are no products to delete.'
            ]);
          }

          return interaction.reply(
            panelPayload(
              'Delete a Product',
              ['Choose the product you want to remove.'],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new StringSelectMenuBuilder()
                        .setCustomId('rover:product:delete:select')
                        .setPlaceholder('Choose a product')
                        .addOptions(productOptions(data.products))
                    )
                  )
              ]
            )
          );

        case 'purchase': {
          const products = activeProducts();

          if (!products.length) {
            return panelReply(interaction, 'No Products Available', [
              'There are no active products to browse yet.'
            ]);
          }

          // Respond with the panel and menu in one initial response.
          // This avoids creating a second initial response accidentally.
          return interaction.reply(
            panelPayload(
              'Purchase Centre',
              [
                'Choose a product below to see its details, price and purchase link.',
                'Rover does not process payments. Check the seller details before purchasing.'
              ],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new StringSelectMenuBuilder()
                        .setCustomId('rover:purchase:select')
                        .setPlaceholder('Choose a product')
                        .addOptions(productOptions(products))
                    )
                  )
              ]
            )
          );
        }

        case 'embed':
          if (!await requireAdmin(interaction)) return;

          return interaction.reply(
            panelPayload(
              'Custom Panel Builder',
              [
                'Create a custom purple Components V2 panel.',
                'Press **Configure Panel** to enter your title, message and optional link.',
                'The setup stays private. The finished panel is posted publicly.'
              ],
              true,
              [
                buttonRow([
                  new ButtonBuilder()
                    .setCustomId('rover:embed:open')
                    .setLabel('Configure Panel')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId('rover:cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                ])
              ]
            )
          );

        case 'information': {
          if (!await requireAdmin(interaction)) return;

          const channel = interaction.options.getChannel('channel', true);

          if (
            !channel ||
            channel.type !== ChannelType.GuildText ||
            !channel.isTextBased()
          ) {
            return panelReply(interaction, 'Invalid Channel', [
              'Choose a standard server text channel.'
            ]);
          }

          const botMember = interaction.guild.members.me;

          const permissions = channel.permissionsFor(botMember);

          if (
            !permissions?.has(PermissionFlagsBits.ViewChannel) ||
            !permissions?.has(PermissionFlagsBits.SendMessages)
          ) {
            return panelReply(interaction, 'Missing Channel Permissions', [
              `Rover needs **View Channel** and **Send Messages** in ${channel}.`,
              'Give Rover the required permissions and try again.'
            ]);
          }

          try {
            await channel.send({
              components: [
                makePanel('Rover Information Centre', [
                  'Welcome to Rover’s Information Centre.',
                  'Choose a topic below for detailed guidance about products, purchases, delivery, giveaways, safety and shop terms.',
                  'Topic explanations are sent privately to the person who selects them.'
                ]),
                informationMenu()
              ],
              flags: MessageFlags.IsComponentsV2,
              allowedMentions: { parse: [] }
            });
          } catch (error) {
            console.error('Could not post information panel:', error);

            return panelReply(interaction, 'Could Not Post Panel', [
              `Rover could not send the information panel to ${channel}.`,
              'Check the channel permissions and the console error.'
            ]);
          }

          return panelReply(interaction, 'Information Panel Published', [
            `The Rover Information Centre has been posted in ${channel}.`,
            'Members can use the dropdown on the public panel to view topics privately.'
          ]);
        }

        case 'giveaway':
          if (!await requireAdmin(interaction)) return;

          return interaction.reply(
            panelPayload(
              'Giveaway Setup',
              [
                'Set the prize, duration, winner count and optional details.',
                'Press **Configure Giveaway** to get started.',
                'The setup is private. The giveaway post and results are public.'
              ],
              true,
              [
                buttonRow([
                  new ButtonBuilder()
                    .setCustomId('rover:giveaway:open')
                    .setLabel('Configure Giveaway')
                    .setStyle(ButtonStyle.Primary),
                  new ButtonBuilder()
                    .setCustomId('rover:cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                ])
              ]
            )
          );

        case 'end-giveaway': {
          if (!await requireAdmin(interaction)) return;

          const activeGiveaways = data.giveaways.filter(g => !g.ended);

          if (!activeGiveaways.length) {
            return panelReply(interaction, 'No Active Giveaways', [
              'There are no giveaways to end.'
            ]);
          }

          return interaction.reply(
            panelPayload(
              'End a Giveaway',
              ['Choose a giveaway to draw the winners immediately.'],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new StringSelectMenuBuilder()
                        .setCustomId('rover:giveaway:end:select')
                        .setPlaceholder('Choose a giveaway')
                        .addOptions(
                          activeGiveaways.slice(0, 25).map(giveaway => ({
                            label: clean(giveaway.prize, 100) || 'Unnamed giveaway',
                            description: `${(giveaway.entrants || []).length} entries`,
                            value: giveaway.id
                          }))
                        )
                    )
                  )
              ]
            )
          );
        }

        case 'give-product': {
          if (!await requireAdmin(interaction)) return;

          const products = activeProducts();

          if (!products.length) {
            return panelReply(interaction, 'No Products', [
              'Create a product before recording a delivery.'
            ]);
          }

          return interaction.reply(
            panelPayload(
              'Record Product Delivery',
              [
                'Choose the product first, then select the customer.',
                'This records the delivery. It does not automatically send files or grant product access.'
              ],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new StringSelectMenuBuilder()
                        .setCustomId('rover:delivery:product')
                        .setPlaceholder('Choose a product')
                        .addOptions(productOptions(products))
                    )
                  )
              ]
            )
          );
        }

        case 'announcement': {
          if (!await requireAdmin(interaction)) return;

          const message = clean(
            interaction.options.getString('message'),
            1900
          );

          await interaction.channel.send({
            content: message,
            allowedMentions: { parse: [] }
          });

          return interaction.reply({
            content: 'Announcement posted.',
            flags: MessageFlags.Ephemeral
          });
        }

        case 'ban':
        case 'kick':
        case 'timeout':
        case 'untimeout': {
          const command = interaction.commandName;
          const target = interaction.options.getUser('user');

          const reason = clean(
            interaction.options.getString('reason') || 'No reason provided.',
            500
          );

          if (!interaction.guild) {
            return panelReply(interaction, 'Server Only', [
              'This command can only be used inside a server.'
            ]);
          }

          if (
            target.id === interaction.user.id ||
            target.id === client.user.id
          ) {
            return panelReply(interaction, 'Action Cancelled', [
              'You cannot use this command on yourself or Rover.'
            ]);
          }

          const member = await interaction.guild.members
            .fetch(target.id)
            .catch(() => null);

          if (!member) {
            return panelReply(interaction, 'Member Not Found', [
              'That user is not currently in this server.'
            ]);
          }

          if (target.id === interaction.guild.ownerId) {
            return panelReply(interaction, 'Action Not Allowed', [
              'The server owner cannot be moderated by Rover.'
            ]);
          }

          const actor = interaction.member;
          const botMember = interaction.guild.members.me;

          if (
            !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
            member.roles.highest.position >= actor.roles.highest.position
          ) {
            return panelReply(interaction, 'Role Hierarchy', [
              'You cannot moderate someone whose highest role is equal to or higher than yours.'
            ]);
          }

          if (
            botMember &&
            member.roles.highest.position >= botMember.roles.highest.position
          ) {
            return panelReply(interaction, 'Bot Role Hierarchy', [
              'Move Rover’s highest role above the target member’s highest role and try again.'
            ]);
          }

          const minutes = command === 'timeout'
            ? interaction.options.getInteger('minutes')
            : null;

          const action = command === 'ban'
            ? 'Ban'
            : command === 'kick'
              ? 'Kick'
              : command === 'timeout'
                ? 'Timeout'
                : 'Timeout Removed';

          const duration = minutes ? `${minutes} minute(s)` : '';

          const dmSent = await sendModerationNotice(
            target,
            action,
            interaction.guild,
            reason,
            duration
          );

          if (command === 'ban') {
            await interaction.guild.members.ban(target.id, {
              reason: `${reason} | Moderator: ${interaction.user.tag}`
            });
          } else if (command === 'kick') {
            await member.kick(
              `${reason} | Moderator: ${interaction.user.tag}`
            );
          } else if (command === 'timeout') {
            await member.timeout(minutes * 60_000, reason);
          } else {
            await member.timeout(null, reason);
          }

          data.moderation.push({
            id: makeId('mod'),
            action,
            targetId: target.id,
            moderatorId: interaction.user.id,
            reason,
            guildId: interaction.guildId,
            createdAt: Date.now()
          });

          if (data.moderation.length > 500) {
            data.moderation = data.moderation.slice(-500);
          }

          await saveData();

          return panelReply(interaction, `${action} Completed`, [
            `**Member:** ${target.tag}`,
            `**Reason:** ${reason}`,
            duration ? `**Duration:** ${duration}` : '',
            `**Notice DM:** ${dmSent ? 'Sent' : 'Could not be delivered because DMs may be closed.'}`
          ]);
        }
      }
    }

    /* ---------- BUTTONS ---------- */

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'rover:product:create:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(productModal());
      }

      if (id === 'rover:embed:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(customPanelModal());
      }

      if (id === 'rover:giveaway:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(giveawayModal());
      }

      if (id === 'rover:cancel') {
        return panelReply(interaction, 'Cancelled', [
          'No changes were made.'
        ]);
      }

      if (id.startsWith('rover:product:delete:confirm:')) {
        if (!await requireAdmin(interaction)) return;

        const productId = id.split(':').pop();
        const index = data.products.findIndex(p => p.id === productId);

        if (index === -1) {
          return panelReply(interaction, 'Product Not Found', [
            'The product may already have been deleted.'
          ]);
        }

        const [removed] = data.products.splice(index, 1);

        await saveData();

        return panelReply(interaction, 'Product Deleted', [
          `**${removed.name}** has been removed.`
        ]);
      }

      if (id.startsWith('rover:giveaway:join:')) {
        const giveawayId = id.split(':').pop();

        const giveaway = data.giveaways.find(
          g => g.id === giveawayId && !g.ended
        );

        if (!giveaway || giveaway.endsAt <= Date.now()) {
          return panelReply(interaction, 'Giveaway Closed', [
            'This giveaway has ended.'
          ]);
        }

        if (!Array.isArray(giveaway.entrants)) {
          giveaway.entrants = [];
        }

        if (giveaway.entrants.includes(interaction.user.id)) {
          return panelReply(interaction, 'Already Entered', [
            'You have already entered this giveaway.'
          ]);
        }

        giveaway.entrants.push(interaction.user.id);

        await saveData();

        return panelReply(interaction, 'Entry Confirmed', [
          `You have entered the giveaway for **${giveaway.prize}**. Good luck!`
        ]);
      }
    }

    /* ---------- SELECT MENUS ---------- */

    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId;
      const value = interaction.values[0];

      if (id === 'rover:purchase:select') {
        const product = productById(value);

        if (!product || product.active === false) {
          return panelReply(interaction, 'Product Unavailable', [
            'This product is no longer available.'
          ]);
        }

        return panelReply(interaction, 'Product Details', [
          productSummary(product),
          product.purchaseUrl
            ? 'Use the purchase link above to continue with the seller.'
            : 'The seller has not added a purchase link yet.',
          'For payment or delivery problems, contact the shop support team.'
        ]);
      }

      if (id === 'rover:information:select') {
        const topic = informationTopics[value];

        if (!topic) {
          return panelReply(interaction, 'Topic Not Found', [
            'Choose a topic from the information menu.'
          ]);
        }

        return panelReply(
          interaction,
          topic.title,
          topic.sections,
          true
        );
      }

      if (id === 'rover:product:edit:select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(value);

        if (!product) {
          return panelReply(interaction, 'Product Not Found', [
            'This product no longer exists.'
          ]);
        }

        return interaction.showModal(productModal(product));
      }

      if (id === 'rover:product:delete:select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(value);

        if (!product) {
          return panelReply(interaction, 'Product Not Found', [
            'This product no longer exists.'
          ]);
        }

        return interaction.reply(
          panelPayload(
            'Confirm Product Deletion',
            [
              `Delete **${product.name}**?`,
              'This cannot be undone.'
            ],
            true,
            [
              buttonRow([
                new ButtonBuilder()
                  .setCustomId(`rover:product:delete:confirm:${product.id}`)
                  .setLabel('Delete Product')
                  .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                  .setCustomId('rover:cancel')
                  .setLabel('Cancel')
                  .setStyle(ButtonStyle.Secondary)
              ])
            ]
          )
        );
      }

      if (id === 'rover:delivery:product') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(value);

        if (!product) {
          return panelReply(interaction, 'Product Not Found', [
            'This product no longer exists.'
          ]);
        }

        return interaction.reply(
          panelPayload(
            'Choose Customer',
            [
              `**Product:** ${product.name}`,
              'Select the customer who received this product.'
            ],
            true,
            [
              new ContainerBuilder()
                .setAccentColor(PURPLE)
                .addActionRowComponents(
                  new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                      .setCustomId(`rover:delivery:customer:${product.id}`)
                      .setPlaceholder('Choose customer')
                      .setMinValues(1)
                      .setMaxValues(1)
                  )
                )
            ]
          )
        );
      }

      if (id === 'rover:giveaway:end:select') {
        if (!await requireAdmin(interaction)) return;

        const giveaway = data.giveaways.find(
          g => g.id === value && !g.ended
        );

        if (!giveaway) {
          return panelReply(interaction, 'Giveaway Not Found', [
            'It may already have ended.'
          ]);
        }

        giveaway.endsAt = Date.now();

        await saveData();
        await finishGiveaway(giveaway);

        return panelReply(interaction, 'Giveaway Ended', [
          `The draw for **${giveaway.prize}** has been completed.`
        ]);
      }
    }

    /* ---------- CUSTOMER SELECT ---------- */

    if (
      interaction.isUserSelectMenu() &&
      interaction.customId.startsWith('rover:delivery:customer:')
    ) {
      if (!await requireAdmin(interaction)) return;

      const productId = interaction.customId.split(':').pop();
      const product = productById(productId);
      const customer = interaction.users.first();

      if (!product || !customer) {
        return panelReply(interaction, 'Delivery Not Recorded', [
          'The product or customer could not be found.'
        ]);
      }

      data.deliveries.push({
        id: makeId('delivery'),
        productId: product.id,
        productName: product.name,
        customerId: customer.id,
        moderatorId: interaction.user.id,
        createdAt: Date.now()
      });

      await saveData();

      let dmSent = true;

      try {
        await customer.send({
          components: [
            makePanel('Product Delivery Notice', [
              `A delivery for **${product.name}** has been recorded for your account.`,
              'If you need help accessing the product, contact the shop support team.'
            ])
          ],
          flags: MessageFlags.IsComponentsV2
        });
      } catch {
        dmSent = false;
      }

      return panelReply(interaction, 'Delivery Recorded', [
        `**Product:** ${product.name}`,
        `**Customer:** ${customer.tag}`,
        `**Customer notice:** ${dmSent ? 'Sent' : 'Could not be delivered because DMs may be closed.'}`
      ]);
    }

    /* ---------- MODAL SUBMISSIONS ---------- */

    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (
        id === 'rover:product:create' ||
        id.startsWith('rover:product:edit:')
      ) {
        if (!await requireAdmin(interaction)) return;

        const productData = {
          name: clean(interaction.fields.getTextInputValue('name'), 100),
          price: clean(interaction.fields.getTextInputValue('price'), 80),
          description: clean(interaction.fields.getTextInputValue('description'), 1000),
          purchaseUrl: clean(interaction.fields.getTextInputValue('url'), 300),
          category: clean(interaction.fields.getTextInputValue('category'), 80)
        };

        if (
          productData.purchaseUrl &&
          !validUrl(productData.purchaseUrl)
        ) {
          return panelReply(interaction, 'Invalid Purchase URL', [
            'Use a valid HTTP or HTTPS link.'
          ]);
        }

        if (id === 'rover:product:create') {
          const duplicate = data.products.some(
            product =>
              product.name.toLowerCase() === productData.name.toLowerCase()
          );

          if (duplicate) {
            return panelReply(interaction, 'Product Already Exists', [
              'Use a unique product name or edit the existing product.'
            ]);
          }

          data.products.push({
            id: makeId('product'),
            ...productData,
            active: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });

          await saveData();

          return panelReply(interaction, 'Product Created', [
            `**${productData.name}** has been added.`,
            'It is now available through `/purchase`. Use your own product listing channels for public listings.'
          ]);
        }

        const product = productById(id.split(':').pop());

        if (!product) {
          return panelReply(interaction, 'Product Not Found', [
            'This product no longer exists.'
          ]);
        }

        Object.assign(product, productData, {
          updatedAt: Date.now()
        });

        await saveData();

        return panelReply(interaction, 'Product Updated', [
          `**${product.name}** has been updated.`
        ]);
      }

      if (id === 'rover:embed:create') {
        if (!await requireAdmin(interaction)) return;

        const title = clean(
          interaction.fields.getTextInputValue('title'),
          100
        );

        const message = clean(
          interaction.fields.getTextInputValue('message'),
          3500
        );

        const buttonLabel = clean(
          interaction.fields.getTextInputValue('buttonLabel'),
          80
        );

        const url = clean(
          interaction.fields.getTextInputValue('url'),
          300
        );

        if (
          !validUrl(url) ||
          Boolean(buttonLabel) !== Boolean(url)
        ) {
          return panelReply(interaction, 'Check Link Details', [
            'Provide both a valid HTTP/HTTPS URL and button label, or leave both blank.'
          ]);
        }

        const extras = buttonLabel
          ? [
              buttonRow([
                new ButtonBuilder()
                  .setLabel(buttonLabel)
                  .setStyle(ButtonStyle.Link)
                  .setURL(url)
              ])
            ]
          : [];

        try {
          await interaction.channel.send({
            components: [
              makePanel(title, [message]),
              ...extras
            ],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
          });
        } catch (error) {
          console.error('Could not publish custom panel:', error);

          return panelReply(interaction, 'Panel Could Not Be Published', [
            'Check that Rover has permission to send messages in this channel.',
            'The full error has been recorded in the hosting console.'
          ]);
        }

        return panelReply(interaction, 'Panel Published', [
          'Your custom purple Components V2 panel has been posted publicly.'
        ]);
      }

      if (id === 'rover:giveaway:create') {
        if (!await requireAdmin(interaction)) return;

        const prize = clean(
          interaction.fields.getTextInputValue('prize'),
          150
        );

        const duration = parseDuration(
          interaction.fields.getTextInputValue('duration')
        );

        const winnerCount = Number(
          clean(interaction.fields.getTextInputValue('winners'), 2)
        );

        const details = clean(
          interaction.fields.getTextInputValue('details'),
          500
        );

        if (!duration) {
          return panelReply(interaction, 'Invalid Duration', [
            'Use `30m`, `2h` or `1d`. The maximum duration is 7 days.'
          ]);
        }

        if (
          !Number.isInteger(winnerCount) ||
          winnerCount < 1 ||
          winnerCount > 10
        ) {
          return panelReply(interaction, 'Invalid Winner Count', [
            'Enter a whole number from 1 to 10.'
          ]);
        }

        const giveaway = {
          id: makeId('giveaway'),
          prize,
          details,
          winnerCount,
          hostId: interaction.user.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: null,
          createdAt: Date.now(),
          endsAt: Date.now() + duration,
          entrants: [],
          winners: [],
          ended: false
        };

        data.giveaways.push(giveaway);
        await saveData();

        try {
          const giveawayMessage = await interaction.channel.send({
            components: [
              makePanel('Rover Giveaway', [
                `**Prize:** ${prize}`,
                details || 'Good luck to everyone entering.',
                `**Winners:** ${winnerCount}`,
                `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
                `Hosted by <@${interaction.user.id}>`,
                'Press **Enter Giveaway** below. Each member can enter once.'
              ]),
              buttonRow([
                new ButtonBuilder()
                  .setCustomId(`rover:giveaway:join:${giveaway.id}`)
                  .setLabel('Enter Giveaway')
                  .setStyle(ButtonStyle.Primary)
              ])
            ],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
          });

          giveaway.messageId = giveawayMessage.id;

          await saveData();
          scheduleGiveaway(giveaway);

          return panelReply(interaction, 'Giveaway Published', [
            `The giveaway for **${prize}** is now live.`,
            `It ends <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`
          ]);
        } catch (error) {
          console.error('Could not publish giveaway:', error);

          // Avoid leaving an unsendable giveaway active in saved data.
          data.giveaways = data.giveaways.filter(
            item => item.id !== giveaway.id
          );

          await saveData();

          return panelReply(interaction, 'Giveaway Could Not Be Published', [
            'Rover could not post the giveaway. Check the channel permissions and hosting console.'
          ]);
        }
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);
    console.error('Interaction type:', interaction.type);
    console.error('Command/custom ID:', interaction.commandName || interaction.customId || 'unknown');

    try {
      if (interaction.isRepliable()) {
        const errorMessage = {
          content: 'Rover encountered an error. Check the hosting console for details.',
          flags: MessageFlags.Ephemeral
        };

        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      }
    } catch (responseError) {
      console.error('Could not send interaction error response:', responseError.message);
    }
  }
});

/* -------------------- LOGIN -------------------- */

client.login(DISCORD_TOKEN).catch(error => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
