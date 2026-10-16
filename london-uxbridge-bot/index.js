
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
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
  TextInputStyle
} = require('discord.js');

const {
  DISCORD_TOKEN: TOKEN,
  DISCORD_CLIENT_ID: CLIENT_ID,
  DISCORD_GUILD_ID: GUILD_ID
} = process.env;

const PURPLE = 0x8B70C8;
const FOOTER = 'Rover Official Store';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bot-data.json');
const PAGE_SIZE = 5;
const MAX_SELECT_OPTIONS = 25;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error(
    'Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.'
  );
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const defaults = () => ({
  products: [],
  giveaways: [],
  deliveries: [],
  moderation: []
});

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults(), null, 2));
  }

  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    return {
      ...defaults(),
      ...d,
      products: Array.isArray(d.products) ? d.products : [],
      giveaways: Array.isArray(d.giveaways) ? d.giveaways : [],
      deliveries: Array.isArray(d.deliveries) ? d.deliveries : [],
      moderation: Array.isArray(d.moderation) ? d.moderation : []
    };
  } catch (error) {
    console.error('Could not read bot-data.json:', error);
    return defaults();
  }
}

let data = loadData();
let saveQueue = Promise.resolve();

function saveData() {
  saveQueue = saveQueue.catch(() => {}).then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const temporaryFile = `${DATA_FILE}.tmp`;

    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(data, null, 2)
    );

    fs.renameSync(temporaryFile, DATA_FILE);
  });

  return saveQueue;
}

const makeId = prefix =>
  `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

const clean = (value, max = 1000) =>
  String(value ?? '').trim().slice(0, max);

function validUrl(value) {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function validProduct(product) {
  return Boolean(
    product &&
    typeof product === 'object' &&
    !Array.isArray(product) &&
    typeof product.id === 'string' &&
    product.id.trim().length > 0 &&
    product.id.length <= 100 &&
    typeof product.name === 'string' &&
    product.name.trim().length > 0
  );
}

function activeProducts() {
  return data.products.filter(product =>
    validProduct(product) && product.active !== false
  );
}

function productById(id) {
  if (typeof id !== 'string') return undefined;

  return data.products.find(product =>
    validProduct(product) && product.id === id
  );
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
    'Permission required',
    ['You need **Manage Server** or **Administrator** to use this command.']
  );

  return false;
}

function makePanel(title, sections = []) {
  const container = new ContainerBuilder()
    .setAccentColor(PURPLE);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}`)
  );

  for (const section of sections.filter(Boolean)) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(section))
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

function panelPayload(title, sections = [], ephemeral = true, extra = []) {
  return {
    components: [makePanel(title, sections), ...extra],
    flags:
      MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] }
  };
}

async function panelReply(interaction, title, sections = [], ephemeral = true) {
  const payload = panelPayload(title, sections, ephemeral);

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

/*
 * One safe product-option builder is used by all product dropdowns.
 * Every option must have a unique ID and valid Discord field lengths.
 */
function productOptions(products) {
  const seen = new Set();
  const options = [];

  for (const product of Array.isArray(products) ? products : []) {
    if (!validProduct(product)) continue;

    const id = product.id;

    if (seen.has(id)) continue;

    const label = clean(product.name, 100) || 'Unnamed product';
    const category = clean(product.category, 30) || 'Uncategorised';
    const price = clean(product.price, 40) || 'Not set';

    const description = clean(
      `Category: ${category} | Price: ${price}`,
      100
    ) || 'Product details';

    options.push({
      label,
      description,
      value: id
    });

    seen.add(id);

    if (options.length >= MAX_SELECT_OPTIONS) break;
  }

  return options;
}

function productSummary(product) {
  const sections = [
    `**${clean(product?.name, 100) || 'Unnamed product'}**`,
    clean(product?.description, 1000) || 'No description provided.',
    `**Price:** ${clean(product?.price, 80) || 'Not set'}`
  ];

  if (product?.category) {
    sections.push(`**Category:** ${clean(product.category, 30)}`);
  }

  if (product?.purchaseUrl && validUrl(product.purchaseUrl)) {
    sections.push(`[Purchase link](${product.purchaseUrl})`);
  }

  return sections.join('\n');
}

function productMenu(customId, placeholder, products) {
  const options = productOptions(products);

  if (!options.length) {
    return {
      options: [],
      menu: null
    };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return { options, menu };
}

function textInput(
  id,
  label,
  style = TextInputStyle.Short,
  required = true,
  value = '',
  max = 1000
) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(max);

  if (value !== null && value !== undefined && String(value).length) {
    input.setValue(String(value).slice(0, max));
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
    .setTitle(editing ? 'Edit product' : 'Create product')
    .addComponents(
      textInput(
        'name',
        'Product name',
        TextInputStyle.Short,
        true,
        product?.name || '',
        100
      ),
      textInput(
        'price',
        'Price (e.g. £4.99 or Free)',
        TextInputStyle.Short,
        true,
        product?.price || '',
        80
      ),
      textInput(
        'description',
        'Product description',
        TextInputStyle.Paragraph,
        true,
        product?.description || '',
        1000
      ),
      textInput(
        'url',
        'Purchase URL (optional)',
        TextInputStyle.Short,
        false,
        product?.purchaseUrl || '',
        300
      ),
      textInput(
        'category: Assets, Maps or Scripts',
        'Category: Assets, Maps or Scripts',
        TextInputStyle.Short,
        true,
        product?.category || '',
        20
      )
    );
}

function embedModal() {
  return new ModalBuilder()
    .setCustomId('rover:embed:create')
    .setTitle('Build custom panel')
    .addComponents(
      textInput('title', 'Panel title', TextInputStyle.Short, true, '', 100),
      textInput(
        'message',
        'Panel message',
        TextInputStyle.Paragraph,
        true,
        '',
        3500
      ),
      textInput(
        'label',
        'Optional link button label',
        TextInputStyle.Short,
        false,
        '',
        80
      ),
      textInput(
        'url',
        'Optional link URL',
        TextInputStyle.Short,
        false,
        '',
        300
      )
    );
}

function giveawayModal() {
  return new ModalBuilder()
    .setCustomId('rover:giveaway:create')
    .setTitle('Configure giveaway')
    .addComponents(
      textInput('prize', 'Giveaway prize', TextInputStyle.Short, true, '', 150),
      textInput(
        'duration',
        'Duration (30m, 2h or 1d)',
        TextInputStyle.Short,
        true,
        '',
        20
      ),
      textInput(
        'winners',
        'Number of winners (1–10)',
        TextInputStyle.Short,
        true,
        '',
        2
      ),
      textInput(
        'details',
        'Extra details (optional)',
        TextInputStyle.Paragraph,
        false,
        '',
        500
      )
    );
}

function parseDuration(value) {
  const match = clean(value, 20)
    .toLowerCase()
    .match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/);

  if (!match || Number(match[1]) < 1) return null;

  const multiplier = match[2].startsWith('m')
    ? 60000
    : match[2].startsWith('h')
      ? 3600000
      : 86400000;

  const milliseconds = Number(match[1]) * multiplier;

  return milliseconds <= 7 * 86400000 ? milliseconds : null;
}

async function publishCatalogue(channel, page = 0, existingMessage = null) {
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    throw new Error('The catalogue destination is not a text channel.');
  }

  const products = activeProducts();
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));

  page = Math.min(
    Math.max(0, Number(page) || 0),
    pages - 1
  );

  const shown = products.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE
  );

  const sections = [
    'Use `/purchase` to privately browse a product and its purchase link.',
    shown.length
      ? shown.map(productSummary).join('\n\n')
      : 'No products have been listed yet.',
    `Page **${page + 1}/${pages}** • **${products.length}** active product(s)`
  ];

  const extra = pages > 1
    ? [
        new ContainerBuilder()
          .setAccentColor(PURPLE)
          .addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`rover:catalogue:page:${page - 1}`)
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
              new ButtonBuilder()
                .setCustomId(`rover:catalogue:page:${page + 1}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === pages - 1)
            )
          )
      ]
    : [];

  const payload = {
    components: [makePanel('Rover Product Catalogue', sections), ...extra],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };

  return existingMessage
    ? existingMessage.edit(payload)
    : channel.send(payload);
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription("Check Rover's response time"),

  new SlashCommandBuilder()
    .setName('create-product')
    .setDescription('Add a product to the catalogue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('edit-product')
    .setDescription('Edit a product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('delete-product')
    .setDescription('Remove a product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('publish-catalogue')
    .setDescription('Publish the public product catalogue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Privately browse products and purchase links'),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build a custom purple panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('information')
    .setDescription("Post Rover's private-server information centre")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel where the information panel should be posted')
        .setRequired(true)
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        )
    ),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Set up and publish a giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('end-giveaway')
    .setDescription('End an active giveaway')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('give-product')
    .setDescription('Record delivery of a product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a plain-text webhook announcement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Announcement text')
        .setRequired(true)
        .setMaxLength(1900)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member and send a moderation notice')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the ban')
        .setRequired(false)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member and send a moderation notice')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member to kick')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the kick')
        .setRequired(false)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member and send a moderation notice')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member to timeout')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('minutes')
        .setDescription('Duration in minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for timeout')
        .setRequired(false)
        .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription("Remove a member's timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member to untimeout')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for removing timeout')
        .setRequired(false)
        .setMaxLength(500)
    )
];

const giveawayTimers = new Map();

function scheduleGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  clearTimeout(giveawayTimers.get(giveaway.id));

  const delay = Math.min(
    Math.max(0, giveaway.endsAt - Date.now()),
    2147000000
  );

  giveawayTimers.set(
    giveaway.id,
    setTimeout(
      () => finishGiveaway(giveaway).catch(console.error),
      delay
    )
  );
}

async function finishGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  giveaway.ended = true;

  clearTimeout(giveawayTimers.get(giveaway.id));
  giveawayTimers.delete(giveaway.id);

  const pool = [
    ...new Set(
      Array.isArray(giveaway.entrants) ? giveaway.entrants : []
    )
  ];

  const winners = [];

  while (
    pool.length &&
    winners.length < Number(giveaway.winnerCount || 1)
  ) {
    winners.push(
      pool.splice(Math.floor(Math.random() * pool.length), 1)[0]
    );
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

  if (channel?.isTextBased()) {
    const resultPanel = makePanel('Giveaway Results', [
      `**Prize:** ${giveaway.prize}`,
      winners.length
        ? `**Winner${winners.length === 1 ? '' : 's'}:** ${resultText}`
        : resultText,
      `**Entries:** ${(giveaway.entrants || []).length}`
    ]);

    const oldMessage = giveaway.messageId
      ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
      : null;

    if (oldMessage) {
      await oldMessage.edit({
        components: [resultPanel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: winners }
      }).catch(async error => {
        console.warn(
          'Could not update the original giveaway post:',
          error.message
        );

        await channel.send({
          components: [resultPanel],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { users: winners }
        }).catch(console.error);
      });
    } else {
      await channel.send({
        components: [resultPanel],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: winners }
      }).catch(console.error);
    }
  }

  for (const winnerId of winners) {
    try {
      const user = await client.users.fetch(winnerId);

      await user.send({
        components: [
          makePanel('You won a Rover giveaway!', [
            `Congratulations! You won **${giveaway.prize}**.`,
            `Server: **${channel?.guild?.name || 'Rover community'}**`,
            'Contact the giveaway host or server staff to claim your prize.'
          ])
        ],
        flags: MessageFlags.IsComponentsV2
      });
    } catch {
      console.warn(
        `Could not DM giveaway winner ${winnerId}; their DMs may be closed.`
      );
    }
  }
}

async function sendModNotice(user, action, guild, reason, duration = '') {
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

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log(`Registered ${commands.length} Rover slash commands.`);

    for (const giveaway of data.giveaways) {
      if (!giveaway.ended) scheduleGiveaway(giveaway);
    }
  } catch (error) {
    console.error('Command registration failed:', error);
  }
});

client.on('interactionCreate', async interaction => {
  try {
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
              ['Start the product editor. Your product will be saved to Rover’s data file.'],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                        .setCustomId('rover:product:create:open')
                        .setLabel('Add product')
                        .setStyle(ButtonStyle.Primary)
                    )
                  )
              ]
            )
          );

        case 'edit-product': {
          if (!await requireAdmin(interaction)) return;

          try {
            const { options, menu } = productMenu(
              'rover:product:edit:select',
              'Choose a product to edit',
              data.products
            );

            if (!options.length || !menu) {
              return panelReply(
                interaction,
                data.products.length ? 'Products Need Attention' : 'No Products',
                [
                  data.products.length
                    ? 'Rover could not find valid products to edit. Check the saved catalogue or recreate the affected products.'
                    : 'Create a product first, then run `/edit-product` again.'
                ]
              );
            }

            return await interaction.reply(
              panelPayload(
                'Edit a Product',
                [
                  'Choose the product you want to edit.',
                  `Showing **${options.length}** product option(s).`
                ],
                true,
                [
                  new ContainerBuilder()
                    .setAccentColor(PURPLE)
                    .addActionRowComponents(
                      new ActionRowBuilder().addComponents(menu)
                    )
                ]
              )
            );
          } catch (error) {
            console.error('[/edit-product] Menu error:', error);

            return panelReply(interaction, 'Edit Product Menu Error', [
              'Rover could not open the product editor menu.',
              'Please try again. If the issue continues, check the bot console.'
            ]).catch(() => null);
          }
        }

        case 'delete-product': {
          if (!await requireAdmin(interaction)) return;

          try {
            const { options, menu } = productMenu(
              'rover:product:delete:select',
              'Choose a product to delete',
              data.products
            );

            if (!options.length || !menu) {
              return panelReply(
                interaction,
                data.products.length ? 'Products Need Attention' : 'No Products',
                [
                  data.products.length
                    ? 'Rover could not find valid products to delete. Check the saved catalogue or recreate the affected products.'
                    : 'There are no products to remove.'
                ]
              );
            }

            return await interaction.reply(
              panelPayload(
                'Delete a Product',
                [
                  'Choose the product you want to remove.',
                  `Showing **${options.length}** product option(s).`
                ],
                true,
                [
                  new ContainerBuilder()
                    .setAccentColor(PURPLE)
                    .addActionRowComponents(
                      new ActionRowBuilder().addComponents(menu)
                    )
                ]
              )
            );
          } catch (error) {
            console.error('[/delete-product] Menu error:', error);

            return panelReply(interaction, 'Delete Product Menu Error', [
              'Rover could not open the product deletion menu.',
              'Please try again and check the bot console if the issue continues.'
            ]).catch(() => null);
          }
        }

        case 'publish-catalogue':
          if (!await requireAdmin(interaction)) return;

          try {
            await interaction.deferReply({
              flags: MessageFlags.Ephemeral
            });

            await publishCatalogue(interaction.channel, 0);

            return panelReply(interaction, 'Catalogue Published', [
              'The public product catalogue has been posted in this channel.'
            ]);
          } catch (error) {
            console.error('[/publish-catalogue] Error:', error);

            return panelReply(interaction, 'Catalogue Not Published', [
              'Rover could not publish the catalogue. Check its channel permissions and try again.'
            ]).catch(() => null);
          }

        case 'purchase': {
          try {
            if (!interaction.inGuild()) {
              return panelReply(interaction, 'Server Only', [
                '`/purchase` can only be used inside the Rover Official Store server.'
              ]);
            }

            const products = activeProducts();

            if (!products.length) {
              return panelReply(interaction, 'No Products Available', [
                'There are no active products available to browse yet.',
                'Please contact Rover Official Store staff if you expected to see products.'
              ]);
            }

            const { options, menu } = productMenu(
              'rover:purchase:select',
              'Choose a product',
              products
            );

            if (!options.length || !menu) {
              return panelReply(interaction, 'Products Need Attention', [
                'Rover could not find valid products in the saved catalogue.',
                'Ask a server administrator to edit or recreate the affected products.'
              ]);
            }

            return await interaction.reply(
              panelPayload(
                'Rover Official Store | Purchase Centre',
                [
                  'This purchase menu is private: only you can see it.',
                  'Choose a product to view its description, category, price and purchase link.',
                  `Showing **${options.length}** product option(s). Discord allows up to 25 options per menu.`,
                  'Rover does not process payments or collect payment details.'
                ],
                true,
                [
                  new ContainerBuilder()
                    .setAccentColor(PURPLE)
                    .addActionRowComponents(
                      new ActionRowBuilder().addComponents(menu)
                    )
                ]
              )
            );
          } catch (error) {
            console.error('[/purchase] Menu error:', error);

            return panelReply(interaction, 'Purchase Menu Error', [
              'Rover could not open the purchase menu.',
              'Please run `/purchase` again. If the issue continues, check the bot console.'
            ]).catch(() => null);
          }
        }

        case 'embed':
          if (!await requireAdmin(interaction)) return;

          return interaction.reply(
            panelPayload(
              'Custom Panel Builder',
              [
                'Build a branded purple panel for this channel.',
                'Press **Build panel** to enter the title, message and optional link. The setup panel is private; the finished panel is public.'
              ],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                        .setCustomId('rover:embed:open')
                        .setLabel('Build panel')
                        .setStyle(ButtonStyle.Primary)
                    )
                  )
              ]
            )
          );

        case 'information': {
          if (!await requireAdmin(interaction)) return;

          const targetChannel = interaction.options.getChannel('channel', true);

          if (
            !targetChannel?.isTextBased?.() ||
            typeof targetChannel.send !== 'function'
          ) {
            return panelReply(interaction, 'Invalid Channel', [
              'Choose a regular text or announcement channel where Rover can post messages.'
            ]);
          }

          const botMember = interaction.guild.members.me;
          const channelPermissions = botMember
            ? targetChannel.permissionsFor(botMember)
            : null;

          if (
            !channelPermissions ||
            !channelPermissions.has(PermissionFlagsBits.SendMessages)
          ) {
            return panelReply(interaction, 'Missing Channel Permission', [
              `Rover cannot send messages in ${targetChannel}. Give Rover the **Send Messages** permission there and try again.`
            ]);
          }

          const infoPanel = panelPayload(
            'Rover Official Store | Information Centre',
            [
              '**Welcome to Rover Official Store**',
              'Rover Official Store is a digital shop for community members to browse a range of products and resources. The server is organised around three main product categories: **Assets**, **Maps** and **Scripts**.',
              'Choose **About Rover** in the menu to learn more about the store and what you can find here. Other topics cover product listings and purchases, delivery records, giveaways, safety and shop terms.'
            ],
            false,
            [
              new ContainerBuilder()
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
                          description: 'About Rover Official Store and its categories'
                        },
                        {
                          label: 'Products and purchases',
                          value: 'products',
                          description: 'Product listings, prices and links'
                        },
                        {
                          label: 'Delivery',
                          value: 'delivery',
                          description: 'Delivery records and support'
                        },
                        {
                          label: 'Giveaways',
                          value: 'giveaways',
                          description: 'Entries and claiming prizes'
                        },
                        {
                          label: 'Safety and support',
                          value: 'safety',
                          description: 'Stay safe and get help'
                        },
                        {
                          label: 'Terms and refunds',
                          value: 'terms',
                          description: 'Shop terms and refund guidance'
                        }
                      )
                  )
                )
            ]
          );

          try {
            await targetChannel.send({
              ...infoPanel,
              allowedMentions: { parse: [] }
            });
          } catch (error) {
            console.error('Information panel publish failed:', error);

            return panelReply(interaction, 'Could Not Publish Panel', [
              `Rover could not post in ${targetChannel}. Check its channel permissions and try again.`
            ]);
          }

          return panelReply(interaction, 'Information Panel Published', [
            `Rover’s information panel was posted in ${targetChannel}.`
          ]);
        }

        case 'giveaway':
          if (!await requireAdmin(interaction)) return;

          return interaction.reply(
            panelPayload(
              'Giveaway Setup',
              [
                'Configure the prize, duration, number of winners and optional details.',
                'Press the button to open the editor. The setup panel is private; the giveaway post will be public.'
              ],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                      new ButtonBuilder()
                        .setCustomId('rover:giveaway:open')
                        .setLabel('Configure giveaway')
                        .setStyle(ButtonStyle.Primary)
                    )
                  )
              ]
            )
          );

        case 'end-giveaway': {
          if (!await requireAdmin(interaction)) return;

          const active = data.giveaways.filter(
            giveaway =>
              giveaway &&
              typeof giveaway.id === 'string' &&
              typeof giveaway.prize === 'string' &&
              !giveaway.ended
          );

          if (!active.length) {
            return panelReply(interaction, 'No Active Giveaways', [
              'There are no giveaways to end.'
            ]);
          }

          const options = active
            .slice(0, MAX_SELECT_OPTIONS)
            .map(giveaway => ({
              label: clean(giveaway.prize, 100) || 'Unnamed giveaway',
              description: `${Array.isArray(giveaway.entrants) ? giveaway.entrants.length : 0} entr(y/ies)`,
              value: giveaway.id
            }));

          const menu = new StringSelectMenuBuilder()
            .setCustomId('rover:giveaway:end:select')
            .setPlaceholder('Choose a giveaway')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);

          return interaction.reply(
            panelPayload(
              'End a Giveaway',
              ['Choose a giveaway to draw the winner(s) now.'],
              true,
              [
                new ContainerBuilder()
                  .setAccentColor(PURPLE)
                  .addActionRowComponents(
                    new ActionRowBuilder().addComponents(menu)
                  )
              ]
            )
          );
        }

        case 'give-product': {
          if (!await requireAdmin(interaction)) return;

          if (!interaction.inGuild()) {
            return panelReply(interaction, 'Server Only', [
              '`/give-product` can only be used inside the Rover Official Store server.'
            ]);
          }

          try {
            const products = activeProducts();

            if (!products.length) {
              return panelReply(interaction, 'No Products', [
                'Create a product before recording a delivery.'
              ]);
            }

            const { options, menu } = productMenu(
              'rover:delivery:product',
              'Choose a product to deliver',
              products
            );

            if (!options.length || !menu) {
              return panelReply(interaction, 'Products Need Attention', [
                'Rover could not find valid products to deliver.',
                'Ask an administrator to edit or recreate the affected products.'
              ]);
            }

            return await interaction.reply(
              panelPayload(
                'Record Product Delivery',
                [
                  'Choose the product, then select the customer who received it.',
                  'This records the delivery; it does not automatically send product files.',
                  `Showing **${options.length}** product option(s).`
                ],
                true,
                [
                  new ContainerBuilder()
                    .setAccentColor(PURPLE)
                    .addActionRowComponents(
                      new ActionRowBuilder().addComponents(menu)
                    )
                ]
              )
            );
          } catch (error) {
            console.error('[/give-product] Menu error:', error);

            return panelReply(interaction, 'Delivery Menu Error', [
              'Rover could not open the product delivery menu.',
              'Please try again and check the bot console if the issue continues.'
            ]).catch(() => null);
          }
        }

        case 'announce': {
          if (!await requireAdmin(interaction)) return;

          const channel = interaction.channel;

          if (
            !channel ||
            !channel.isTextBased() ||
            typeof channel.fetchWebhooks !== 'function'
          ) {
            return panelReply(interaction, 'Unsupported Channel', [
              'Use `/announce` in a regular text or announcement channel.'
            ]);
          }

          const botMember = interaction.guild?.members?.me;

          if (
            !botMember ||
            !botMember.permissionsIn(channel).has(
              PermissionFlagsBits.ManageWebhooks
            )
          ) {
            return panelReply(interaction, 'Missing Bot Permission', [
              'Rover needs **Manage Webhooks** in this channel to publish webhook announcements.'
            ]);
          }

          const message = clean(
            interaction.options.getString('message'),
            1900
          );

          if (!message) {
            return panelReply(interaction, 'Empty Announcement', [
              'Enter a message before publishing.'
            ]);
          }

          const webhookName = 'Rover Announcements';

          try {
            const webhooks = await channel.fetchWebhooks();

            let webhook = webhooks.find(
              hook =>
                hook.name === webhookName &&
                hook.owner?.id === client.user.id
            );

            if (!webhook) {
              webhook = await channel.createWebhook({
                name: webhookName,
                avatar: client.user.displayAvatarURL({
                  extension: 'png',
                  size: 256
                }),
                reason: 'Rover plain-text announcement publishing'
              });
            }

            await webhook.send({
              content: message,
              username: 'Rover Official Store',
              avatarURL: client.user.displayAvatarURL({
                extension: 'png',
                size: 256
              }),
              allowedMentions: { parse: [] }
            });
          } catch (error) {
            console.error('Webhook announcement failed:', error);

            return panelReply(interaction, 'Announcement Failed', [
              'Rover could not send the webhook message. Check that it has **Manage Webhooks** and **Send Messages** in this channel.'
            ]);
          }

          return panelReply(interaction, 'Announcement Posted', [
            'Your normal text message has been published through the **Rover Official Store** webhook.'
          ]);
        }

        case 'ban':
        case 'kick':
        case 'timeout':
        case 'untimeout': {
          if (!interaction.inGuild()) {
            return panelReply(interaction, 'Server Only', [
              'This moderation command can only be used inside a server.'
            ]);
          }

          const command = interaction.commandName;
          const target = interaction.options.getUser('user');

          const reason = clean(
            interaction.options.getString('reason') || 'No reason provided.',
            500
          );

          if (
            target.id === interaction.user.id ||
            target.id === client.user.id
          ) {
            return panelReply(interaction, 'Action Cancelled', [
              'You cannot use this moderation command on yourself or Rover.'
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

          const actor = await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);

          const botMember = interaction.guild.members.me;
          const administrator = interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
          );

          const requiredPermission =
            command === 'ban'
              ? PermissionFlagsBits.BanMembers
              : command === 'kick'
                ? PermissionFlagsBits.KickMembers
                : PermissionFlagsBits.ModerateMembers;

          if (
            !administrator &&
            !interaction.memberPermissions?.has(requiredPermission)
          ) {
            return panelReply(interaction, 'Permission Required', [
              `You need the relevant **${command === 'ban' ? 'Ban Members' : command === 'kick' ? 'Kick Members' : 'Moderate Members'}** permission to use this command.`
            ]);
          }

          if (!actor || !botMember) {
            return panelReply(interaction, 'Member Not Found', [
              'Rover could not verify the required server members. Please try again.'
            ]);
          }

          if (!botMember.permissions.has(requiredPermission)) {
            return panelReply(interaction, 'Rover Missing Permission', [
              `Give Rover the **${command === 'ban' ? 'Ban Members' : command === 'kick' ? 'Kick Members' : 'Moderate Members'}** permission and try again.`
            ]);
          }

          if (
            !administrator &&
            member.roles.highest.position >= actor.roles.highest.position
          ) {
            return panelReply(interaction, 'Role Hierarchy', [
              'You cannot moderate a member whose highest role is equal to or higher than yours.'
            ]);
          }

          if (
            member.roles.highest.position >= botMember.roles.highest.position
          ) {
            return panelReply(interaction, 'Bot Role Hierarchy', [
              'Move Rover’s highest role above the target member’s highest role and try again.'
            ]);
          }

          const action =
            command === 'ban'
              ? 'Ban'
              : command === 'kick'
                ? 'Kick'
                : command === 'timeout'
                  ? 'Timeout'
                  : 'Timeout Removed';

          const minutes =
            command === 'timeout'
              ? interaction.options.getInteger('minutes')
              : null;

          const duration = minutes ? `${minutes} minute(s)` : '';

          if (command === 'ban') {
            await interaction.guild.members.ban(target.id, {
              reason: `${reason} | Moderator: ${interaction.user.tag}`
            });
          } else if (command === 'kick') {
            await member.kick(
              `${reason} | Moderator: ${interaction.user.tag}`
            );
          } else if (command === 'timeout') {
            await member.timeout(minutes * 60000, reason);
          } else {
            await member.timeout(null, reason);
          }

          const dmSent = await sendModNotice(
            target,
            action,
            interaction.guild,
            reason,
            duration
          );

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
            `**Notice DM:** ${dmSent ? 'Sent' : 'Could not be delivered (DMs may be closed).'}` 
          ]);
        }
      }
    }

    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId === 'rover:product:create:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(productModal());
      }

      if (customId === 'rover:embed:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(embedModal());
      }

      if (customId === 'rover:giveaway:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(giveawayModal());
      }

      if (customId === 'rover:cancel') {
        return panelReply(interaction, 'Cancelled', [
          'No changes were made.'
        ]);
      }

      if (customId.startsWith('rover:product:delete:confirm:')) {
        if (!await requireAdmin(interaction)) return;

        const productId = customId.split(':').pop();
        const index = data.products.findIndex(
          product => validProduct(product) && product.id === productId
        );

        if (index < 0) {
          return panelReply(interaction, 'Product Not Found', [
            'It may already have been deleted.'
          ]);
        }

        const [removed] = data.products.splice(index, 1);
        await saveData();

        return panelReply(interaction, 'Product Deleted', [
          `**${removed.name}** has been removed from the catalogue.`
        ]);
      }

      if (customId.startsWith('rover:catalogue:page:')) {
        const page = Number(customId.split(':').pop());

        await interaction.deferUpdate();

        try {
          return await publishCatalogue(
            interaction.channel,
            page,
            interaction.message
          );
        } catch (error) {
          console.error('Catalogue page update failed:', error);
          return interaction.followUp({
            content: 'Rover could not update the catalogue page.',
            flags: MessageFlags.Ephemeral
          }).catch(() => null);
        }
      }

      if (customId.startsWith('rover:giveaway:join:')) {
        const giveawayId = customId.split(':').pop();

        const giveaway = data.giveaways.find(
          item => item.id === giveawayId && !item.ended
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

    if (interaction.isStringSelectMenu()) {
      const customId = interaction.customId;
      const value = interaction.values?.[0];

      if (customId === 'rover:purchase:select') {
        try {
          const product = productById(value);

          if (!product || product.active === false) {
            return panelReply(interaction, 'Product Unavailable', [
              'This product is no longer available. Please run `/purchase` again to refresh the menu.'
            ]);
          }

          return panelReply(
            interaction,
            'Rover Official Store | Product Details',
            [
              productSummary(product),
              product.purchaseUrl && validUrl(product.purchaseUrl)
                ? 'Use the purchase link above to continue with the seller.'
                : 'The seller has not added a valid purchase link yet.',
              'Rover does not process payments. For payment or delivery problems, contact the shop support team.'
            ]
          );
        } catch (error) {
          console.error('[purchase select] Could not display product:', error);

          return panelReply(interaction, 'Product Details Error', [
            'Rover could not display that product. Please run `/purchase` again or contact store staff.'
          ]).catch(() => null);
        }
      }

      if (customId === 'rover:information:select') {
        const pages = {
          about: [
            'About Rover',
            [
              'Welcome to **Rover Official Store**, a digital store offering products and resources for our community.',
              '**Assets** — Browse available digital assets and other resources.',
              '**Maps** — Explore maps listed in the store.',
              '**Scripts** — Discover available scripts and review their descriptions and requirements.',
              'Visit the relevant product channels — **#assets**, **#maps** and **#scripts** — to browse listings and read product details.',
              'For questions about products, purchases or delivery, contact the appropriate store staff member.',
              'Thank you for being part of **Rover Official Store**!'
            ]
          ],
          products: [
            'Products and Purchases',
            [
              'Product details come from the shop’s saved catalogue. Review the description and price before purchasing.',
              'Use the listed purchase link to complete a transaction. Rover does not collect card details or process payments.',
              'Never share passwords, login codes, account tokens or payment details in direct messages.'
            ]
          ],
          delivery: [
            'Product Delivery',
            [
              'Staff can use `/give-product` to record which customer received which product.',
              'The command records the delivery; it does not automatically send files, licences or product access.',
              'If a purchase has not arrived, keep your receipt and contact the shop support team.'
            ]
          ],
          giveaways: [
            'Giveaways',
            [
              'Enter through the button on an active giveaway post. Each account can enter once per giveaway.',
              'When the timer ends, Rover randomly draws up to the configured number of winners from eligible entries.',
              'Winners are announced in the server and receive a DM if their privacy settings allow it.'
            ]
          ],
          safety: [
            'Safety and Support',
            [
              'Only use purchase links posted by trusted staff. Be cautious of impersonators and unexpected DMs.',
              'Never share your Discord password, backup codes, payment details or account token.',
              'For help, contact the server’s official support team and share order evidence privately.'
            ]
          ],
          terms: [
            'Terms and Refunds',
            [
              'Refund eligibility depends on the shop’s published terms and the payment platform used.',
              'Read product descriptions and refund conditions before purchasing. Keep proof of payment and order confirmations.',
              'Rover cannot approve refunds or resolve payment disputes itself; contact the seller or payment provider.'
            ]
          ]
        };

        const page = pages[value];

        return page
          ? panelReply(interaction, page[0], page[1], true)
          : panelReply(interaction, 'Topic Not Found', [
              'Choose a topic from the information menu.'
            ]);
      }

      if (customId === 'rover:product:edit:select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(value);

        if (!product) {
          return panelReply(interaction, 'Product Not Found', [
            'This product no longer exists.'
          ]);
        }

        return interaction.showModal(productModal(product));
      }

      if (customId === 'rover:product:delete:select') {
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
            [`Delete **${clean(product.name, 100)}**? This cannot be undone.`],
            true,
            [
              new ContainerBuilder()
                .setAccentColor(PURPLE)
                .addActionRowComponents(
                  new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                      .setCustomId(`rover:product:delete:confirm:${product.id}`)
                      .setLabel('Delete product')
                      .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                      .setCustomId('rover:cancel')
                      .setLabel('Cancel')
                      .setStyle(ButtonStyle.Secondary)
                  )
                )
            ]
          )
        );
      }

      if (customId === 'rover:delivery:product') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(value);

        if (!product || product.active === false) {
          return panelReply(interaction, 'Product Not Found', [
            'This product is no longer available. Refresh the delivery menu and try again.'
          ]);
        }

        return interaction.reply(
          panelPayload(
            'Choose Customer',
            [
              `Product: **${clean(product.name, 100)}**`,
              'Select the customer who received it.'
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

      if (customId === 'rover:giveaway:end:select') {
        if (!await requireAdmin(interaction)) return;

        const giveaway = data.giveaways.find(
          item => item.id === value && !item.ended
        );

        if (!giveaway) {
          return panelReply(interaction, 'Giveaway Not Found', [
            'It may already have ended.'
          ]);
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        await finishGiveaway(giveaway);

        return panelReply(interaction, 'Giveaway Ended', [
          `The draw for **${giveaway.prize}** has been completed.`
        ]);
      }
    }

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
        `**Customer:** ${customer}`,
        `**Customer notice:** ${dmSent ? 'Sent' : 'Could not be delivered (DMs may be closed).'}` 
      ]);
    }

    if (interaction.isModalSubmit()) {
      const customId = interaction.customId;

      if (
        customId === 'rover:product:create' ||
        customId.startsWith('rover:product:edit:')
      ) {
        if (!await requireAdmin(interaction)) return;

        const productData = {
          name: clean(interaction.fields.getTextInputValue('name'), 100),
          price: clean(interaction.fields.getTextInputValue('price'), 80),
          description: clean(
            interaction.fields.getTextInputValue('description'),
            1000
          ),
          purchaseUrl: clean(
            interaction.fields.getTextInputValue('url'),
            300
          ),
          category: clean(
            interaction.fields.getTextInputValue('category: Assets, Maps or Scripts'),
            20
          )
        };

        if (!productData.name) {
          return panelReply(interaction, 'Product Name Required', [
            'Enter a product name and try again.'
          ]);
        }

        if (!productData.price) {
          return panelReply(interaction, 'Product Price Required', [
            'Enter a price, or use `Free` for a free product.'
          ]);
        }

        const categoryNames = {
          assets: 'Assets',
          maps: 'Maps',
          scripts: 'Scripts'
        };

        const categoryKey = productData.category.toLowerCase();

        if (!categoryNames[categoryKey]) {
          return panelReply(interaction, 'Invalid Product Category', [
            'Choose one of these exact categories: **Assets**, **Maps** or **Scripts**. Reopen the product form and enter one of those categories.'
          ]);
        }

        productData.category = categoryNames[categoryKey];

        if (productData.purchaseUrl && !validUrl(productData.purchaseUrl)) {
          return panelReply(interaction, 'Invalid Purchase URL', [
            'Use a valid HTTP or HTTPS link.'
          ]);
        }

        if (customId === 'rover:product:create') {
          const duplicate = data.products.some(
            product =>
              validProduct(product) &&
              product.name.trim().toLowerCase() ===
                productData.name.toLowerCase()
          );

          if (duplicate) {
            return panelReply(interaction, 'Product Already Exists', [
              'Use a unique name or edit the existing product.'
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
            `**Category:** ${productData.category}`,
            'Use `/publish-catalogue` to publish the current catalogue.'
          ]);
        }

        const productId = customId.split(':').pop();
        const product = productById(productId);

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
          `**${product.name}** has been updated.`,
          `**Category:** ${product.category}`,
          'Use `/publish-catalogue` to publish the current catalogue.'
        ]);
      }

      if (customId === 'rover:embed:create') {
        if (!await requireAdmin(interaction)) return;

        const title = clean(
          interaction.fields.getTextInputValue('title'),
          100
        );

        const message = clean(
          interaction.fields.getTextInputValue('message'),
          3500
        );

        const label = clean(
          interaction.fields.getTextInputValue('label'),
          80
        );

        const url = clean(
          interaction.fields.getTextInputValue('url'),
          300
        );

        if (!validUrl(url) || Boolean(label) !== Boolean(url)) {
          return panelReply(interaction, 'Check Link Details', [
            'Provide both a valid HTTP/HTTPS URL and button label, or leave both blank.'
          ]);
        }

        if (!interaction.channel || typeof interaction.channel.send !== 'function') {
          return panelReply(interaction, 'Invalid Channel', [
            'Rover cannot publish a panel in this channel.'
          ]);
        }

        const extras = label
          ? [
              new ContainerBuilder()
                .setAccentColor(PURPLE)
                .addActionRowComponents(
                  new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                      .setLabel(label)
                      .setStyle(ButtonStyle.Link)
                      .setURL(url)
                  )
                )
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
          console.error('Custom panel publish failed:', error);

          return panelReply(interaction, 'Panel Not Published', [
            'Rover could not publish the panel. Check the channel permissions and try again.'
          ]);
        }

        return panelReply(interaction, 'Panel Published', [
          'Your custom purple panel has been posted publicly.'
        ]);
      }

      if (customId === 'rover:giveaway:create') {
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

        if (!prize) {
          return panelReply(interaction, 'Prize Required', [
            'Enter a prize for the giveaway.'
          ]);
        }

        if (!duration) {
          return panelReply(interaction, 'Invalid Duration', [
            'Use `30m`, `2h` or `1d`. Maximum duration is 7 days.'
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

        if (!interaction.channel || typeof interaction.channel.send !== 'function') {
          return panelReply(interaction, 'Invalid Channel', [
            'Rover cannot publish a giveaway in this channel.'
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

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`rover:giveaway:join:${giveaway.id}`)
              .setLabel('Enter giveaway')
              .setStyle(ButtonStyle.Primary)
          );

          const message = await interaction.channel.send({
            components: [
              makePanel('Rover Giveaway', [
                `**Prize:** ${prize}`,
                details,
                `**Winners:** ${winnerCount}`,
                `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
                `Hosted by <@${interaction.user.id}>`,
                'Press **Enter giveaway** below. Each member can enter once.'
              ]),
              new ContainerBuilder()
                .setAccentColor(PURPLE)
                .addActionRowComponents(row)
            ],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
          });

          giveaway.messageId = message.id;
          await saveData();
          scheduleGiveaway(giveaway);

          return panelReply(interaction, 'Giveaway Published', [
            `The giveaway for **${prize}** is live.`,
            `It ends <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`
          ]);
        } catch (error) {
          console.error('Giveaway publishing failed:', error);

          giveaway.ended = true;
          await saveData();

          return panelReply(interaction, 'Giveaway Not Published', [
            'Rover could not publish the giveaway. Check its channel permissions and try again.'
          ]);
        }
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    const payload = {
      content: 'Rover encountered an error. Please try again or contact an administrator.',
      flags: MessageFlags.Ephemeral
    };

    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      }
    } catch (replyError) {
      console.error('Could not send the interaction error response:', replyError);
    }
  }
});

client.login(TOKEN).catch(error => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
