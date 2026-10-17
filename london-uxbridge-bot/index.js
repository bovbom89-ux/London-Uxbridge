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

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const PURPLE = 0x8B70C8;
const FOOTER = 'Rover Official Store';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bot-data.json');

const EMOJIS = {
  Roblox: '<:Roblox:1561126193787310161>',
  Member: '<:Member:1561126435169632376>',
  Verified: '<:Verified_Member:1561126375988002927>',
  Shopping: '<:Shopping:1561126149789323335>',
  Chat: '<:Chat:1561125897208201267>',
  Announcement: '<:Announcement:1561125918431256616>',
  Star: '<:Star:1561125940598149261>',
  Scripts: '<:Scripts:1561125963314503832>',
  Maps: '<:Maps:1561125984327958659>',
  Assets: '<:Assets:1561126006109118595>',
  PayPal: '<:PayPal:1561126043538952212>',
  Settings: '<:Settings:1561126067455131698>',
  Cross: '<:Cross:1561126087700783204>',
  Tick: '<:Tick:1561126107787432016>',
  Gift: '<:Gift:1561126127861239929>',
  Ticket: '<:Ticket:1561126172589301832>',
  Briefcase: '<:Briefcase:1561126217581858826>',
  Box: '<:Box:1561126239173869628>',
  Basket: '<:Basket:1561126259675893851>',
  Document: '<:Document:1561126289014784051>',
  Left: '<:Left:1561126311223894137>',
  Right: '<:Right:1561126332388089887>',
  Download: '<:Download:1561126352059367506>'
};

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
  moderation: [],
  roles: {},
  rolesSetupCompleted: false,
  ticketConfig: {
    categoryId: null,
    panelChannelId: null
  },
  tickets: {},
  ticketBlacklist: [],
  reviewConfig: {
    channelId: null
  },
  reviews: [],
  orders: [],
  informationConfig: {
    channelId: null
  }
});

fs.mkdirSync(DATA_DIR, { recursive: true });

let data = defaults();

if (fs.existsSync(DATA_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data = { ...defaults(), ...loaded };

    for (const [key, value] of Object.entries(defaults())) {
      if (data[key] === undefined || data[key] === null) {
        data[key] = value;
      }
    }

    data.ticketConfig = {
      ...defaults().ticketConfig,
      ...(data.ticketConfig || {})
    };

    data.reviewConfig = {
      ...defaults().reviewConfig,
      ...(data.reviewConfig || {})
    };

    data.informationConfig = {
      ...defaults().informationConfig,
      ...(data.informationConfig || {})
    };
  } catch (error) {
    console.error('Could not read bot-data.json:', error);
    process.exit(1);
  }
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let saveQueue = Promise.resolve();

function saveData() {
  const operation = saveQueue.then(async () => {
    const temporary = `${DATA_FILE}.tmp`;

    await fs.promises.writeFile(
      temporary,
      JSON.stringify(data, null, 2)
    );

    await fs.promises.rename(temporary, DATA_FILE);
  });

  saveQueue = operation.catch(error => {
    console.error('Could not save Rover data:', error);
  });

  return operation;
}

function id() {
  return Math.random().toString(36).slice(2, 9).toUpperCase();
}

function clean(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function activeProducts() {
  return data.products.filter(product => product.active !== false);
}

function productById(productId) {
  return data.products.find(product => product.id === productId);
}

function isAdmin(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.permissions?.has(PermissionFlagsBits.ManageGuild)
  );
}

function titleWithEmoji(title) {
  const cleaned = clean(title, 200).replace(/^#+\s*/, '');

  const mappings = [
    [/giveaway/i, EMOJIS.Gift],
    [/ticket|support/i, EMOJIS.Ticket],
    [/product|catalogue|purchas|order|delivery/i, EMOJIS.Shopping],
    [/review|rating/i, EMOJIS.Star],
    [/announcement/i, EMOJIS.Announcement],
    [/role|setting|configur/i, EMOJIS.Settings],
    [/information|about|help/i, EMOJIS.Document],
    [/moderation|ban|kick|timeout/i, EMOJIS.Briefcase],
    [/online|success|complete|created|updated|confirmed/i, EMOJIS.Tick]
  ];

  for (const [pattern, emoji] of mappings) {
    if (pattern.test(cleaned)) {
      return `${emoji} ${cleaned}`;
    }
  }

  return cleaned;
}

function makePanel(title, body = '', emoji = '') {
  const panel = new ContainerBuilder().setAccentColor(PURPLE);

  const heading = emoji
    ? `${emoji} ${clean(title, 200).replace(/^#+\s*/, '')}`
    : titleWithEmoji(title);

  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`**${heading}**`)
  );

  panel.addSeparatorComponents(new SeparatorBuilder());

  if (body) {
    panel.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(body)
    );
  }

  panel.addSeparatorComponents(new SeparatorBuilder());

  panel.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${FOOTER}`)
  );

  return panel;
}

function panelPayload(title, body = '', options = {}) {
  const payload = {
    components: [makePanel(title, body, options.emoji || '')],
    flags: MessageFlags.IsComponentsV2
  };

  if (options.ephemeral) {
    payload.flags |= MessageFlags.Ephemeral;
  }

  if (options.components?.length) {
    payload.components.push(...options.components);
  }

  return payload;
}

async function reply(interaction, title, body, options = {}) {
  const payload = panelPayload(title, body, {
    ...options,
    ephemeral: options.ephemeral !== false
  });

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

async function privateText(interaction, content, components = []) {
  const payload = {
    content,
    flags: MessageFlags.Ephemeral
  };

  if (components.length) {
    payload.components = components;
  }

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction.member)) return true;

  await reply(
    interaction,
    'Permission Denied',
    'You need Administrator or Manage Server permissions to use this command.',
    { ephemeral: true }
  );

  return false;
}

function textInput(
  customId,
  label,
  style = TextInputStyle.Short,
  required = true,
  placeholder = '',
  maxLength = 1000,
  value = ''
) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);

  if (placeholder) input.setPlaceholder(placeholder);
  if (value) input.setValue(String(value).slice(0, maxLength));

  return input;
}

function modal(title, customId, fields) {
  const result = new ModalBuilder()
    .setTitle(title)
    .setCustomId(customId);

  for (const field of fields) {
    result.addComponents(
      new ActionRowBuilder().addComponents(field)
    );
  }

  return result;
}

function productOptions() {
  return activeProducts().slice(0, 25).map(product => ({
    label: clean(product.name, 100) || 'Unnamed Product',
    description: clean(
      `${product.price || 'Price not set'} | ${product.category || 'General'}`,
      100
    ),
    value: product.id
  }));
}

function staffRoleId() {
  return process.env.TICKET_ESCALATION_ROLE_ID || null;
}

function hasRole(member, roleId) {
  return Boolean(roleId && member?.roles?.cache?.has(roleId));
}

function canManageTickets(interaction) {
  return Boolean(
    isAdmin(interaction.member) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
    hasRole(interaction.member, staffRoleId())
  );
}

function ticketForChannel(channelId) {
  return Object.values(data.tickets).find(
    ticket => ticket.channelId === channelId && !ticket.closed
  );
}

function ticketButtons(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_claim:${ticketId}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`ticket_staff:${ticketId}`)
      .setLabel('Staff Panel')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`ticket_close:${ticketId}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );
}

function ticketStaffButtons(ticketId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket_escalate:${ticketId}`)
      .setLabel('Escalate')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`ticket_rename:${ticketId}`)
      .setLabel('Rename')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`ticket_add:${ticketId}`)
      .setLabel('Add Member')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`ticket_blacklist:${ticketId}`)
      .setLabel('Blacklist Opener')
      .setStyle(ButtonStyle.Danger)
  );
}

function informationMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('information_menu')
      .setPlaceholder('Choose an information section')
      .addOptions(
        { label: 'About Rover', value: 'about' },
        { label: 'Products and Purchasing', value: 'products' },
        { label: 'Delivery and Order Support', value: 'delivery' },
        { label: 'Giveaways and Winners', value: 'giveaways' },
        { label: 'Account Safety and Privacy', value: 'safety' },
        { label: 'Terms, Refunds and Disputes', value: 'terms' }
      )
  );
}

function productModal(product = null) {
  return modal(
    product ? 'Edit Product' : 'Create Product',
    product ? `product_edit:${product.id}` : 'product_create',
    [
      textInput(
        'name',
        'Product name',
        TextInputStyle.Short,
        true,
        'Product name',
        100,
        product?.name || ''
      ),
      textInput(
        'price',
        'Price',
        TextInputStyle.Short,
        true,
        'Example: 100 Robux or £5',
        100,
        product?.price || ''
      ),
      textInput(
        'description',
        'Description',
        TextInputStyle.Paragraph,
        true,
        'Describe the product',
        1000,
        product?.description || ''
      ),
      textInput(
        'purchaseUrl',
        'Purchase URL (optional)',
        TextInputStyle.Short,
        false,
        'https://...',
        500,
        product?.purchaseUrl || ''
      ),
      textInput(
        'category',
        'Category',
        TextInputStyle.Short,
        true,
        'Scripts, Maps, Assets, etc.',
        100,
        product?.category || 'General'
      )
    ]
  );
}

function giveawayModal() {
  return modal('Create Giveaway', 'giveaway_create', [
    textInput('prize', 'Prize', TextInputStyle.Short, true, 'What is being given away?', 100),
    textInput('details', 'Details', TextInputStyle.Paragraph, false, 'Optional details', 1000),
    textInput('duration', 'Duration', TextInputStyle.Short, true, 'Examples: 30m, 2h, 3d', 20),
    textInput('winners', 'Number of winners', TextInputStyle.Short, true, '1', 2)
  ]);
}

function reviewModal(productId) {
  return modal('Leave a Review', `review_submit:${productId}`, [
    textInput('rating', 'Rating from 1 to 5', TextInputStyle.Short, true, '5', 1),
    textInput('comment', 'Your review', TextInputStyle.Paragraph, true, 'Tell others about your experience', 1000)
  ]);
}

function parseDuration(value) {
  const match = /^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/i.exec(
    String(value).trim()
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multiplier = unit.startsWith('m')
    ? 60000
    : unit.startsWith('h')
      ? 3600000
      : 86400000;

  const duration = amount * multiplier;

  if (
    !Number.isFinite(duration) ||
    duration < 60000 ||
    duration > 7 * 86400000
  ) {
    return null;
  }

  return duration;
}

function averageRating(productId) {
  const reviews = data.reviews.filter(
    review => review.productId === productId
  );

  if (!reviews.length) return 'No reviews yet';

  const average = reviews.reduce(
    (sum, review) => sum + review.rating,
    0
  ) / reviews.length;

  return `${average.toFixed(1)}/5 (${reviews.length} review${reviews.length === 1 ? '' : 's'})`;
}

async function publishReview(guild, review) {
  if (!data.reviewConfig.channelId) return false;

  const channel = await guild.channels
    .fetch(data.reviewConfig.channelId)
    .catch(() => null);

  if (!channel?.isTextBased() || !channel.send) return false;

  const product = productById(review.productId);

  const body = [
    `**Product:** ${product?.name || review.productName}`,
    `**Rating:** ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)`,
    `**Customer:** <@${review.userId}>`,
    `**Review:** ${review.comment}`,
    `**Product average:** ${averageRating(review.productId)}`
  ].join('\n');

  await channel.send(
    panelPayload('Customer Review', body, { emoji: EMOJIS.Star })
  );

  return true;
}

function giveawayPayload(giveaway) {
  const body = [
    `**Prize:** ${giveaway.prize}`,
    giveaway.details ? `**Details:** ${giveaway.details}` : '',
    `**Number of winners:** ${giveaway.winnerCount}`,
    giveaway.ended
      ? `**Status:** Ended\n**Winner(s):** ${
          giveaway.winners?.length
            ? giveaway.winners.map(userId => `<@${userId}>`).join(', ')
            : 'No eligible entrants.'
        }`
      : `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>\n**Entries:** ${giveaway.entrants.length}`
  ].filter(Boolean).join('\n');

  const rows = giveaway.ended
    ? []
    : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway_enter:${giveaway.id}`)
            .setLabel('Enter Giveaway')
            .setStyle(ButtonStyle.Primary)
        )
      ];

  return panelPayload('Rover Giveaway', body, {
    emoji: EMOJIS.Gift,
    components: rows
  });
}

async function endGiveaway(giveawayId) {
  const giveaway = data.giveaways.find(
    item => item.id === giveawayId
  );

  if (!giveaway || giveaway.ended) return false;

  giveaway.ended = true;

  const entrants = [...new Set(giveaway.entrants || [])];
  const winners = [];

  while (
    entrants.length &&
    winners.length < giveaway.winnerCount
  ) {
    const index = Math.floor(Math.random() * entrants.length);
    winners.push(entrants.splice(index, 1)[0]);
  }

  giveaway.winners = winners;
  giveaway.endedAt = Date.now();

  await saveData();

  const channel = await client.channels
    .fetch(giveaway.channelId)
    .catch(() => null);

  if (channel?.isTextBased() && giveaway.messageId) {
    const message = await channel.messages
      .fetch(giveaway.messageId)
      .catch(() => null);

    if (message) {
      await message.edit(giveawayPayload(giveaway)).catch(console.error);
    }

    if (winners.length) {
      await channel.send({
        content: `The giveaway has ended! Congratulations ${winners.map(userId => `<@${userId}>`).join(', ')} — you won **${giveaway.prize}**!`,
        allowedMentions: { users: winners }
      }).catch(console.error);

      for (const winnerId of winners) {
        const winner = await client.users.fetch(winnerId).catch(() => null);

        if (!winner) continue;

        await winner.send(
          panelPayload(
            'Congratulations — You Won!',
            `You won **${giveaway.prize}** in a Rover Official Store giveaway.\n\nPlease contact the store team to arrange your prize.`,
            { emoji: EMOJIS.Gift }
          )
        ).catch(() => null);
      }
    } else {
      await channel.send(
        `The giveaway for **${giveaway.prize}** has ended with no eligible entrants.`
      ).catch(console.error);
    }
  }

  return true;
}

function scheduleGiveaway(giveaway) {
  if (giveaway.ended) return;

  const delay = Math.max(0, giveaway.endsAt - Date.now());

  setTimeout(async () => {
    try {
      if (Date.now() < giveaway.endsAt) {
        scheduleGiveaway(giveaway);
      } else {
        await endGiveaway(giveaway.id);
      }
    } catch (error) {
      console.error('Giveaway timer failed:', error);
    }
  }, Math.min(delay, 2147483647));
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether Rover is online.'),

  new SlashCommandBuilder()
    .setName('create-product')
    .setDescription('Create a store product.'),

  new SlashCommandBuilder()
    .setName('edit-product')
    .setDescription('Edit an existing product.'),

  new SlashCommandBuilder()
    .setName('delete-product')
    .setDescription('Remove a product from the catalogue.'),

  new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Browse available store products.'),

  new SlashCommandBuilder()
    .setName('give-product')
    .setDescription('Deliver a product to a customer.'),

  new SlashCommandBuilder()
    .setName('my-orders')
    .setDescription('View your recorded product deliveries.'),

  new SlashCommandBuilder()
    .setName('information')
    .setDescription('Publish the Rover information panel.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel where the information panel will be posted.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure the support ticket system.')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Set up the support ticket panel.')
        .addChannelOption(option =>
          option.setName('category')
            .setDescription('Category for ticket channels.')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel where the ticket panel will be posted.')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage store giveaways.')
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Create a giveaway.')
    )
    .addSubcommand(sub =>
      sub.setName('end')
        .setDescription('End a giveaway early.')
        .addStringOption(option =>
          option.setName('id')
            .setDescription('Giveaway ID.')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Create or update Rover staff and customer roles.'),

  new SlashCommandBuilder()
    .setName('review-settings')
    .setDescription('Set the public review channel.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for customer reviews.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Review a product you have received.'),

  new SlashCommandBuilder()
    .setName('review-remove')
    .setDescription('Remove a customer review.')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('Review ID.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Send a plain-text announcement using the Rover webhook.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel where the announcement will be sent.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The announcement text.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Publish a Rover panel to a selected channel.')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel where the panel will be posted.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Panel title.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Panel description.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Member to ban.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the ban.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Member to kick.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the kick.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Member to timeout.')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('minutes')
        .setDescription('Timeout duration in minutes.')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the timeout.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member timeout.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Member to remove the timeout from.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for removing the timeout.')
        .setRequired(true)
    )
].map(command => command.toJSON());

client.once('clientReady', async () => {
  console.log(`Rover is online as ${client.user.tag}.`);

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log(`Registered ${commands.length} Rover slash commands.`);
  } catch (error) {
    console.error('Command registration failed:', error);
  }

  for (const giveaway of data.giveaways) {
    if (giveaway.endsAt && !giveaway.ended) {
      scheduleGiveaway(giveaway);
    }
  }
});

client.on('interactionCreate', async interaction => {
  try {
    // SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      const command = interaction.commandName;

      if (command === 'ping') {
        return reply(
          interaction,
          'Rover Is Online',
          `Latency: ${client.ws.ping}ms.`
        );
      }

      if (command === 'create-product') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(productModal());
      }

      if (command === 'edit-product') {
        if (!await requireAdmin(interaction)) return;

        const options = productOptions();

        if (!options.length) {
          return reply(
            interaction,
            'No Products',
            'There are no active products to edit.',
            { ephemeral: true }
          );
        }

        return privateText(
          interaction,
          'Choose the product you want to edit.',
          [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('product_edit_select')
                .setPlaceholder('Choose a product')
                .addOptions(options)
            )
          ]
        );
      }

      if (command === 'delete-product') {
        if (!await requireAdmin(interaction)) return;

        const options = productOptions();

        if (!options.length) {
          return reply(
            interaction,
            'No Products',
            'There are no active products to delete.',
            { ephemeral: true }
          );
        }

        return privateText(
          interaction,
          'Choose the product you want to delete.',
          [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('product_delete_select')
                .setPlaceholder('Choose a product')
                .addOptions(options)
            )
          ]
        );
      }

      if (command === 'purchase') {
        const options = productOptions();

        if (!options.length) {
          return reply(
            interaction,
            'Store Catalogue',
            'There are currently no products available. Please check back later.',
            { ephemeral: true }
          );
        }

        return privateText(
          interaction,
          '**Rover Official Store — Catalogue**\nChoose a product below to view its description, price, category, review rating and purchase information.',
          [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('purchase_select')
                .setPlaceholder('Browse available products')
                .addOptions(options)
            )
          ]
        );
      }

      if (command === 'give-product') {
        if (!await requireAdmin(interaction)) return;

        const options = productOptions();

        if (!options.length) {
          return reply(
            interaction,
            'No Products',
            'Create a product before delivering it.',
            { ephemeral: true }
          );
        }

        return privateText(
          interaction,
          'Select the product you want to deliver. You will then choose the customer and confirm the delivery.',
          [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('deliver_product_select')
                .setPlaceholder('Choose a product')
                .addOptions(options)
            )
          ]
        );
      }

      if (command === 'my-orders') {
        const orders = data.deliveries
          .filter(order => order.customerId === interaction.user.id)
          .sort((a, b) => b.timestamp - a.timestamp);

        if (!orders.length) {
          return reply(
            interaction,
            'My Orders',
            'You do not have any recorded product deliveries yet.\n\nWhen a store team member delivers a product to you, your order will appear here.',
            { ephemeral: true }
          );
        }

        const body = orders.slice(0, 15).map((order, index) => [
          `**${index + 1}. ${order.productName}**`,
          `Order reference: \`${order.id}\``,
          `Delivered: <t:${Math.floor(order.timestamp / 1000)}:f>`,
          `<t:${Math.floor(order.timestamp / 1000)}:R>`
        ].join('\n')).join('\n\n');

        return reply(
          interaction,
          'My Orders',
          `Here are your most recent deliveries, newest first.\n\n${body}\n\n-# Showing up to 15 recent deliveries.`,
          { ephemeral: true }
        );
      }

      if (command === 'information') {
        if (!await requireAdmin(interaction)) return;

        const channel = interaction.options.getChannel('channel');

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {
          await channel.send(
            panelPayload(
              'Rover Information',
              [
                '**Welcome to Rover Official Store**',
                'Your central place for browsing store products, checking delivery information, entering giveaways and getting support.',
                '',
                '**Products and Purchasing**',
                'Browse the catalogue and review product descriptions and prices before purchasing.',
                '',
                '**Orders and Delivery**',
                'Use `/my-orders` to view recorded deliveries. If a delivery is missing or you need help, open a support ticket.',
                '',
                '**Customer Reviews**',
                'Customers who have received a product can submit an honest review through `/review`.',
                '',
                '**Giveaways**',
                'Enter active giveaways using the entry button on the giveaway panel. Winners are announced when a giveaway ends.',
                '',
                '**Need Help?**',
                'Use the support ticket panel to contact the store team privately.',
                '',
                'Choose a topic below for more detailed information.'
              ].join('\n'),
              {
                emoji: EMOJIS.Document,
                components: [informationMenu()]
              }
            )
          );

          return interaction.editReply({
            content: `The information panel has been posted in ${channel}.`
          });
        } catch (error) {
          console.error('Information panel failed:', error);

          return interaction.editReply({
            content: 'The information panel could not be posted. Check Rover has permission to view and send messages in the selected channel.'
          });
        }
      }

      if (command === 'ticket') {
        if (!await requireAdmin(interaction)) return;

        const category = interaction.options.getChannel('category');
        const channel = interaction.options.getChannel('channel');

        if (!channel || !category) {
          return reply(
            interaction,
            'Invalid Configuration',
            'Select a valid ticket category and text channel.',
            { ephemeral: true }
          );
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('ticket_open')
              .setLabel('Open Support Ticket')
              .setStyle(ButtonStyle.Primary)
          );

          await channel.send(
            panelPayload(
              'Customer Support',
              [
                '**Welcome to Rover Official Store Support.**',
                'Need help? Open a private support ticket and our team will assist you.',
                '',
                '**What can you contact us about?**',
                '• Product enquiries and purchasing information',
                '• Missing, delayed or incorrect deliveries',
                '• Order issues and payment-related questions',
                '• Store questions, feedback and other concerns',
                '',
                '**Before opening a ticket**',
                'Please provide a clear explanation of your issue. Include relevant product or order information where appropriate, but never share passwords or authentication codes.',
                '',
                '**Please note**',
                'Opening multiple tickets for the same issue may delay support. Our team will respond when available.'
              ].join('\n'),
              {
                emoji: EMOJIS.Ticket,
                components: [row]
              }
            )
          );

          data.ticketConfig.categoryId = category.id;
          data.ticketConfig.panelChannelId = channel.id;

          await saveData();

          return interaction.editReply({
            content: `The support panel has been posted in ${channel}.`
          });
        } catch (error) {
          console.error('Ticket panel setup failed:', error);

          return interaction.editReply({
            content: 'The ticket panel could not be posted. Check Rover has permission to view and send messages in the selected channel.'
          });
        }
      }

      if (command === 'giveaway') {
        if (!await requireAdmin(interaction)) return;

        if (interaction.options.getSubcommand() === 'setup') {
          return interaction.showModal(giveawayModal());
        }

        const giveawayId = clean(
          interaction.options.getString('id'),
          50
        ).toUpperCase();

        const giveaway = data.giveaways.find(
          item => item.id === giveawayId && !item.ended
        );

        if (!giveaway) {
          return reply(
            interaction,
            'Giveaway Not Found',
            'No active giveaway matches that ID.',
            { ephemeral: true }
          );
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        const ended = await endGiveaway(giveaway.id);

        return interaction.editReply({
          content: ended
            ? `Giveaway **${giveaway.prize}** has been ended.`
            : 'The giveaway could not be ended because it may already have ended.'
        });
      }

      if (command === 'roles') {
        if (!await requireAdmin(interaction)) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
          return reply(
            interaction,
            'Missing Permission',
            'You need Manage Roles permission, and Rover also needs Manage Roles permission.',
            { ephemeral: true }
          );
        }

        const roleDefinitions = [
          {
            name: 'Owner',
            color: 0x4B286D,
            permissions: [PermissionFlagsBits.Administrator]
          },
          {
            name: 'Administrator',
            color: 0x65409B,
            permissions: [
              PermissionFlagsBits.ManageGuild,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ViewAuditLog,
              PermissionFlagsBits.KickMembers,
              PermissionFlagsBits.BanMembers,
              PermissionFlagsBits.ModerateMembers
            ]
          },
          {
            name: 'Moderator',
            color: 0x8059B7,
            permissions: [
              PermissionFlagsBits.KickMembers,
              PermissionFlagsBits.BanMembers,
              PermissionFlagsBits.ModerateMembers,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages
            ]
          },
          {
            name: 'Support',
            color: 0x9A7BCB,
            permissions: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles
            ]
          },
          {
            name: 'Customer',
            color: 0xB49BDB,
            permissions: []
          },
          {
            name: 'Verified',
            color: 0xCEBDEC,
            permissions: []
          },
          {
            name: 'Member',
            color: 0xE1D5F3,
            permissions: []
          },
          {
            name: 'Muted',
            color: 0x77717F,
            permissions: []
          }
        ];

        const created = [];
        const updated = [];
        const skipped = [];
        const botMember = interaction.guild.members.me;

        if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          return reply(
            interaction,
            'Rover Missing Permission',
            'Give Rover the Manage Roles permission.',
            { ephemeral: true }
          );
        }

        for (const definition of roleDefinitions) {
          let role = interaction.guild.roles.cache.find(
            item => item.name === definition.name
          );

          if (
            role &&
            botMember.roles.highest.comparePositionTo(role) <= 0
          ) {
            skipped.push(definition.name);
            continue;
          }

          if (!role) {
            role = await interaction.guild.roles.create({
              name: definition.name,
              permissions: definition.permissions,
              color: definition.color,
              reason: 'Rover role setup'
            });

            created.push(definition.name);
          } else {
            await role.setPermissions(
              definition.permissions,
              'Rover role setup'
            );

            await role.setColor(
              definition.color,
              'Rover role colour setup'
            ).catch(console.error);

            updated.push(definition.name);
          }

          data.roles[definition.name] = role.id;
        }

        await saveData();

        return reply(
          interaction,
          'Role Setup Complete',
          [
            `**Created:** ${created.join(', ') || 'None'}`,
            `**Updated:** ${updated.join(', ') || 'None'}`,
            `**Skipped:** ${skipped.join(', ') || 'None'}`,
            '',
            'The roles now use a graduated purple palette, from darker senior roles to lighter customer roles.',
            '',
            '**Important:** Move the Rover bot role above the roles it must manage. Discord does not allow a bot to manage roles at or above its highest role.',
            'Administrator permission always grants full server permissions, so Owner remains the highest-privilege role.'
          ].join('\n'),
          { ephemeral: true }
        );
      }

      if (command === 'review-settings') {
        if (!await requireAdmin(interaction)) return;

        const channel = interaction.options.getChannel('channel');

        data.reviewConfig.channelId = channel.id;
        await saveData();

        return reply(
          interaction,
          'Review Channel Saved',
          `Customer reviews will be published in ${channel}.`,
          { ephemeral: true }
        );
      }

      if (command === 'review') {
        const options = productOptions();

        if (!options.length) {
          return reply(
            interaction,
            'Customer Reviews',
            'There are no active products available to review.',
            { ephemeral: true }
          );
        }

        return privateText(
          interaction,
          '**Submit a product review**\nSelect a product you have received. Reviews are limited to customers with a recorded delivery, and you can submit one review per product.',
          [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('review_product_select')
                .setPlaceholder('Choose a product you received')
                .addOptions(options)
            )
          ]
        );
      }

      if (command === 'review-remove') {
        if (!await requireAdmin(interaction)) return;

        const reviewId = clean(
          interaction.options.getString('id'),
          50
        ).toUpperCase();

        const index = data.reviews.findIndex(
          review => review.id === reviewId
        );

        if (index === -1) {
          return reply(
            interaction,
            'Review Not Found',
            'No stored review matches that ID.',
            { ephemeral: true }
          );
        }

        const [review] = data.reviews.splice(index, 1);
        await saveData();

        return reply(
          interaction,
          'Review Removed',
          `The review for **${review.productName}** has been removed from Rover's stored reviews. If it was already posted publicly, its published message may need to be removed separately.`,
          { ephemeral: true }
        );
      }

      if (command === 'announcement') {
        if (!await requireAdmin(interaction)) return;

        const channel = interaction.options.getChannel('channel');
        const message = clean(
          interaction.options.getString('message'),
          1900
        );

        if (!message) {
          return reply(
            interaction,
            'Empty Announcement',
            'Please provide announcement text.',
            { ephemeral: true }
          );
        }

        if (!channel?.isTextBased() || !channel.guild) {
          return reply(
            interaction,
            'Invalid Channel',
            'Select a valid server text channel.',
            { ephemeral: true }
          );
        }

        const botMember = interaction.guild.members.me;

        if (!botMember.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) {
          return reply(
            interaction,
            'Missing Permission',
            'Rover needs Manage Webhooks permission in the selected channel.',
            { ephemeral: true }
          );
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {
          const hooks = await channel.fetchWebhooks();

          let webhook = hooks.find(
            item =>
              item.owner?.id === client.user.id &&
              item.name === 'Rover'
          );

          if (!webhook) {
            webhook = await channel.createWebhook({
              name: 'Rover',
              avatar: process.env.ROVER_ICON_URL ||
                client.user.displayAvatarURL()
            });
          }

          await webhook.send({
            content: message,
            username: 'Rover',
            avatarURL: process.env.ROVER_ICON_URL ||
              client.user.displayAvatarURL(),
            allowedMentions: { parse: [] }
          });

          return interaction.editReply({
            content: `The announcement has been posted in ${channel}.`
          });
        } catch (error) {
          console.error('Announcement failed:', error);

          return interaction.editReply({
            content: 'The announcement could not be sent. Check Rover has Manage Webhooks permission in the selected channel.'
          });
        }
      }

      if (command === 'embed') {
        if (!await requireAdmin(interaction)) return;

        const channel = interaction.options.getChannel('channel');
        const title = clean(interaction.options.getString('title'), 200);
        const message = clean(interaction.options.getString('message'), 3500);

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {
          await channel.send(
            panelPayload(title, message)
          );

          return interaction.editReply({
            content: `The panel has been posted in ${channel}.`
          });
        } catch (error) {
          console.error('Embed panel failed:', error);

          return interaction.editReply({
            content: 'The panel could not be posted. Check Rover has permission to view and send messages in the selected channel.'
          });
        }
      }

      if (['ban', 'kick', 'timeout', 'untimeout'].includes(command)) {
        if (!await requireAdmin(interaction)) return;

        const user = interaction.options.getUser('user');
        const reason = clean(
          interaction.options.getString('reason'),
          500
        );

        const member = await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

        if (!member) {
          return reply(
            interaction,
            'Member Not Found',
            'That user is not a current server member.',
            { ephemeral: true }
          );
        }

        if (user.id === interaction.user.id) {
          return reply(
            interaction,
            'Action Not Allowed',
            'You cannot use this command on yourself.',
            { ephemeral: true }
          );
        }

        if (user.id === client.user.id) {
          return reply(
            interaction,
            'Action Not Allowed',
            'Rover cannot moderate itself.',
            { ephemeral: true }
          );
        }

        if (!member.manageable) {
          return reply(
            interaction,
            'Cannot Moderate Member',
            'Discord does not allow Rover to moderate this member. Check the bot role hierarchy.',
            { ephemeral: true }
          );
        }

        try {
          if (command === 'ban') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
              return reply(interaction, 'Permission Denied', 'You need Ban Members permission.', { ephemeral: true });
            }

            await member.ban({ reason });
          } else if (command === 'kick') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
              return reply(interaction, 'Permission Denied', 'You need Kick Members permission.', { ephemeral: true });
            }

            await member.kick(reason);
          } else if (command === 'timeout') {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
              return reply(interaction, 'Permission Denied', 'You need Moderate Members permission.', { ephemeral: true });
            }

            const minutes = interaction.options.getInteger('minutes');
            await member.timeout(minutes * 60000, reason);
          } else {
            if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
              return reply(interaction, 'Permission Denied', 'You need Moderate Members permission.', { ephemeral: true });
            }

            await member.timeout(null, reason);
          }
        } catch (error) {
          console.error(`Moderation action ${command} failed:`, error);

          return reply(
            interaction,
            'Moderation Failed',
            'Rover could not complete the action. Check its permissions and role position.',
            { ephemeral: true }
          );
        }

        data.moderation.push({
          id: id(),
          action: command,
          userId: user.id,
          moderatorId: interaction.user.id,
          reason,
          timestamp: Date.now(),
          guildId: interaction.guildId
        });

        await saveData();

        return reply(
          interaction,
          'Moderation Action Complete',
          `**Action:** ${command === 'untimeout' ? 'Remove Timeout' : command}\n**Member:** ${user.tag}\n**Reason:** ${reason}`,
          { ephemeral: true }
        );
      }
    }

    // INFORMATION MENU
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'information_menu') {
        const sections = {
          about: [
            '**About Rover Official Store**',
            'Rover Official Store provides a central place to browse available products, receive deliveries, submit reviews and get customer support.',
            '',
            'Our aim is to make finding product information and obtaining help straightforward.',
            '',
            'Use the information panel to explore store services or open a support ticket if you need assistance.'
          ].join('\n'),

          products: [
            '**Products and Purchasing**',
            'Use `/purchase` to browse currently available products.',
            '',
            'Each product listing includes its name, price, category and description. Where a purchase URL is supplied, check the destination carefully before proceeding.',
            '',
            'If a listing has no purchase URL, contact the store team through a support ticket for further instructions.',
            '',
            'Do not purchase from unofficial links claiming to represent the store.'
          ].join('\n'),

          delivery: [
            '**Delivery and Order Support**',
            'Use `/my-orders` to see deliveries recorded against your Discord account.',
            '',
            'A delivery record confirms that a team member marked a product as delivered. It does not replace any external payment receipt or guarantee that a third-party service has completed its own transaction.',
            '',
            'If a product is missing, incorrect or inaccessible, open a support ticket and provide the relevant order reference.',
            '',
            'Never share your password or authentication codes with anyone claiming to be support.'
          ].join('\n'),

          giveaways: [
            '**Giveaways and Winners**',
            'Open giveaways show their prize, closing time and current number of recorded entries.',
            '',
            'Press the entry button on an active giveaway to enter. You will receive a private confirmation.',
            '',
            'When a giveaway ends, Rover selects winners from the recorded entrants, updates the giveaway panel and announces the result.',
            '',
            'Winners may also receive a direct message. Direct messages can fail if a winner has disabled them.',
            '',
            'Never share account credentials to claim a prize.'
          ].join('\n'),

          safety: [
            '**Account Safety and Privacy**',
            'Keep passwords, recovery codes, authentication codes and other sensitive account information private.',
            '',
            'Check purchase URLs carefully and be cautious of unsolicited messages or impersonators.',
            '',
            'Only provide order details needed to resolve your support request.',
            '',
            'Rover records store information such as products, orders, reviews, tickets and moderation actions in its local data file. Access to the hosting files should be restricted to trusted administrators.'
          ].join('\n'),

          terms: [
            '**Terms, Refunds and Disputes**',
            'Check the store’s published terms and the conditions associated with a product before purchasing.',
            '',
            'If you have a problem with a purchase or delivery, open a support ticket and explain the issue. Include the relevant order reference and any appropriate evidence.',
            '',
            'Refund eligibility depends on the applicable store terms and circumstances. Contact the store team for a review rather than assuming a refund has been approved.',
            '',
            'Never send passwords or authentication codes as evidence.'
          ].join('\n')
        };

        const selected = sections[interaction.values[0]];

        if (!selected) {
          return privateText(
            interaction,
            'That information section is unavailable. Please choose another option.'
          );
        }

        // Keep the original information panel unchanged.
        // Send the selected information as a separate private response.
        return reply(
          interaction,
          'Rover Information',
          selected,
          { ephemeral: true }
        );
      }

      // EDIT PRODUCT SELECT
      if (interaction.customId === 'product_edit_select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'That product is no longer available to edit. Run `/edit-product` again.'
          );
        }

        return interaction.showModal(productModal(product));
      }

      // DELETE PRODUCT SELECT
      if (interaction.customId === 'product_delete_select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'That product is no longer available to delete. Run `/delete-product` again.'
          );
        }

        return privateText(
          interaction,
          `Are you sure you want to remove **${product.name}** from the active catalogue?`,
          [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`product_delete_confirm:${product.id}`)
                .setLabel('Confirm Delete')
                .setStyle(ButtonStyle.Danger),

              new ButtonBuilder()
                .setCustomId('product_delete_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
            )
          ]
        );
      }

      // PURCHASE SELECT
      if (interaction.customId === 'purchase_select') {
        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'This product is no longer available. Run `/purchase` again to browse the catalogue.'
          );
        }

        const body = [
          `**Product:** ${product.name}`,
          `**Price:** ${product.price}`,
          `**Category:** ${product.category || 'General'}`,
          '',
          '**Description**',
          product.description,
          '',
          `**Customer rating:** ${averageRating(product.id)}`,
          '',
          product.purchaseUrl
            ? `**Purchase link:** ${product.purchaseUrl}`
            : '**Purchase link:** Contact support for purchasing information.'
        ].join('\n');

        // Respond privately; never replace the original catalogue.
        return reply(
          interaction,
          'Product Details',
          body,
          { ephemeral: true, emoji: EMOJIS.Shopping }
        );
      }

      // DELIVERY PRODUCT SELECT
      if (interaction.customId === 'deliver_product_select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'This product is no longer active.'
          );
        }

        return privateText(
          interaction,
          `Selected **${product.name}**. Choose the customer who should receive the product.`,
          [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId(`deliver_customer:${product.id}`)
                .setPlaceholder('Choose the customer')
                .setMinValues(1)
                .setMaxValues(1)
            )
          ]
        );
      }

      // REVIEW PRODUCT SELECT
      if (interaction.customId === 'review_product_select') {
        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'That product is no longer available to review.'
          );
        }

        const delivered = data.deliveries.some(
          order =>
            order.productId === product.id &&
            order.customerId === interaction.user.id
        );

        if (!delivered) {
          return privateText(
            interaction,
            'You can only review products recorded as delivered to your account.'
          );
        }

        if (data.reviews.some(
          review =>
            review.productId === product.id &&
            review.userId === interaction.user.id
        )) {
          return privateText(
            interaction,
            'You have already reviewed this product. Only one review per product is allowed.'
          );
        }

        return interaction.showModal(reviewModal(product.id));
      }
    }

    // USER SELECT MENUS
    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'ticket_add_member') {
        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can add members.',
            { ephemeral: true }
          );
        }

        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket) {
          return reply(
            interaction,
            'Ticket Not Found',
            'This is not an active ticket.',
            { ephemeral: true }
          );
        }

        const memberId = interaction.values[0];

        await interaction.channel.permissionOverwrites.edit(memberId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        });

        return reply(
          interaction,
          'Member Added',
          `<@${memberId}> can now access this ticket.`,
          { ephemeral: true }
        );
      }

      if (interaction.customId.startsWith('deliver_customer:')) {
        if (!await requireAdmin(interaction)) return;

        const productId = interaction.customId.split(':')[1];
        const product = productById(productId);
        const customerId = interaction.values[0];

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'The selected product is no longer active.'
          );
        }

        return privateText(
          interaction,
          `Confirm delivery of **${product.name}** to <@${customerId}>.`,
          [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`deliver_confirm:${product.id}:${customerId}`)
                .setLabel('Confirm Delivery')
                .setStyle(ButtonStyle.Success),

              new ButtonBuilder()
                .setCustomId('deliver_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
            )
          ]
        );
      }
    }

    // BUTTONS
    if (interaction.isButton()) {
      if (interaction.customId === 'product_delete_cancel') {
        return privateText(interaction, 'Product deletion cancelled.');
      }

      if (interaction.customId.startsWith('product_delete_confirm:')) {
        if (!await requireAdmin(interaction)) return;

        const productId = interaction.customId.split(':')[1];
        const product = productById(productId);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'This product has already been removed or no longer exists.'
          );
        }

        product.active = false;
        product.deletedAt = Date.now();

        await saveData();

        return privateText(
          interaction,
          `**${product.name}** has been removed from the active catalogue. Its historical order and delivery records have been preserved.`
        );
      }

      if (interaction.customId === 'deliver_cancel') {
        return privateText(interaction, 'Product delivery cancelled.');
      }

      // OPEN TICKET
      if (interaction.customId === 'ticket_open') {
        if (data.ticketBlacklist.includes(interaction.user.id)) {
          return reply(
            interaction,
            'Ticket Access Denied',
            'You are unable to open a support ticket. Contact a server administrator if you believe this is a mistake.',
            { ephemeral: true }
          );
        }

        const existing = Object.values(data.tickets).find(
          ticket =>
            ticket.userId === interaction.user.id &&
            ticket.guildId === interaction.guildId &&
            !ticket.closed
        );

        if (existing) {
          const existingChannel = await interaction.guild.channels
            .fetch(existing.channelId)
            .catch(() => null);

          if (existingChannel) {
            return reply(
              interaction,
              'Ticket Already Open',
              `You already have an open ticket: ${existingChannel}.`,
              { ephemeral: true }
            );
          }

          existing.closed = true;
          existing.closedAt = Date.now();

          await saveData();
        }

        const categoryId = data.ticketConfig.categoryId;

        if (!categoryId) {
          return reply(
            interaction,
            'Ticket System Not Configured',
            'An administrator needs to configure the ticket system first.',
            { ephemeral: true }
          );
        }

        const category = await interaction.guild.channels
          .fetch(categoryId)
          .catch(() => null);

        if (!category || category.type !== ChannelType.GuildCategory) {
          return reply(
            interaction,
            'Invalid Ticket Category',
            'The configured ticket category no longer exists. Ask an administrator to run `/ticket setup` again.',
            { ephemeral: true }
          );
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        try {
          const overwrites = [
            {
              id: interaction.guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: interaction.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
              ]
            },
            {
              id: client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
              ]
            }
          ];

          const escalationRole = staffRoleId();

          if (
            escalationRole &&
            interaction.guild.roles.cache.has(escalationRole)
          ) {
            overwrites.push({
              id: escalationRole,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles
              ]
            });
          }

          const safeUsername = interaction.user.username
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '')
            .slice(0, 70) || 'customer';

          const channel = await interaction.guild.channels.create({
            name: `ticket-${safeUsername}`,
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: overwrites,
            reason: `Support ticket opened by ${interaction.user.tag}`
          });

          const ticketId = id();

          data.tickets[ticketId] = {
            id: ticketId,
            channelId: channel.id,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            claimedBy: null,
            closed: false,
            escalated: false,
            createdAt: Date.now()
          };

          await saveData();

          await channel.send(
            panelPayload(
              'Support Ticket',
              [
                `Welcome <@${interaction.user.id}>! Thank you for contacting Rover Official Store Support.`,
                '',
                '**Please tell us how we can help.**',
                '• Explain your issue clearly.',
                '• Include your product name or order reference if relevant.',
                '• Describe any troubleshooting you have already tried.',
                '',
                '**Important information**',
                'Do not share passwords, authentication codes or sensitive account information.',
                '',
                'Our team will respond when available. Please keep all information about this issue in this ticket.',
                '',
                'Use the buttons below to claim the ticket, open the staff panel or request closure.'
              ].join('\n'),
              {
                emoji: EMOJIS.Ticket,
                components: [ticketButtons(ticketId)]
              }
            )
          );

          return interaction.editReply({
            content: `Your private support ticket has been created: ${channel}`
          });
        } catch (error) {
          console.error('Ticket creation failed:', error);

          return interaction.editReply({
            content: 'Rover could not create your ticket. Check its Manage Channels permission and the configured category.'
          });
        }
      }

      // GIVEAWAY ENTRY
      if (interaction.customId.startsWith('giveaway_enter:')) {
        const giveawayId = interaction.customId.split(':')[1];

        const giveaway = data.giveaways.find(
          item => item.id === giveawayId && !item.ended
        );

        if (!giveaway) {
          return reply(
            interaction,
            'Giveaway Closed',
            'This giveaway has ended or no longer exists.',
            { ephemeral: true }
          );
        }

        if (giveaway.endsAt <= Date.now()) {
          await endGiveaway(giveaway.id);

          return reply(
            interaction,
            'Giveaway Closed',
            'This giveaway has ended.',
            { ephemeral: true }
          );
        }

        if (!giveaway.entrants.includes(interaction.user.id)) {
          giveaway.entrants.push(interaction.user.id);

          await saveData();

          const channel = await client.channels
            .fetch(giveaway.channelId)
            .catch(() => null);

          if (channel?.isTextBased() && giveaway.messageId) {
            const message = await channel.messages
              .fetch(giveaway.messageId)
              .catch(() => null);

            if (message) {
              await message.edit(giveawayPayload(giveaway)).catch(console.error);
            }
          }

          return reply(
            interaction,
            'Entry Confirmed',
            'You have successfully entered the giveaway.',
            { ephemeral: true }
          );
        }

        return reply(
          interaction,
          'Already Entered',
          'You have already entered this giveaway.',
          { ephemeral: true }
        );
      }

      // CONFIRM DELIVERY
      if (interaction.customId.startsWith('deliver_confirm:')) {
        if (!await requireAdmin(interaction)) return;

        const [, productId, customerId] = interaction.customId.split(':');
        const product = productById(productId);

        if (!product || product.active === false) {
          return privateText(
            interaction,
            'This product no longer exists or is no longer active.'
          );
        }

        await interaction.deferUpdate();

        const order = {
          id: id(),
          productId: product.id,
          productName: product.name,
          customerId,
          staffId: interaction.user.id,
          guildId: interaction.guildId,
          timestamp: Date.now()
        };

        data.deliveries.push(order);
        data.orders.push(order);

        await saveData();

        const customer = await client.users
          .fetch(customerId)
          .catch(() => null);

        let dmSent = false;

        if (customer) {
          try {
            await customer.send(
              panelPayload(
                'Product Delivery',
                [
                  'A product has been delivered to you by Rover Official Store.',
                  '',
                  `**Product:** ${product.name}`,
                  `**Price:** ${product.price}`,
                  `**Order reference:** \`${order.id}\``,
                  `**Delivered:** <t:${Math.floor(order.timestamp / 1000)}:f>`,
                  '',
                  'Use `/my-orders` in the store server to view your recorded deliveries.',
                  'If you need help, open a support ticket.'
                ].join('\n'),
                { emoji: EMOJIS.Box }
              )
            );

            dmSent = true;
          } catch {
            dmSent = false;
          }
        }

        return interaction.editReply({
          content: `Delivery recorded for <@${customerId}>.\n**Order reference:** \`${order.id}\`\n**Customer DM:** ${dmSent ? 'Sent successfully.' : 'Could not be sent; the customer may have DMs disabled.'}`,
          components: []
        });
      }

      // TICKET CLAIM
      if (interaction.customId.startsWith('ticket_claim:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Closed',
            'This ticket is no longer active.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can claim tickets.',
            { ephemeral: true }
          );
        }

        ticket.claimedBy = interaction.user.id;
        ticket.claimedAt = Date.now();

        await saveData();

        return reply(
          interaction,
          'Ticket Claimed',
          `This ticket has been claimed by ${interaction.user}.`,
          { ephemeral: true }
        );
      }

      // TICKET STAFF PANEL
      if (interaction.customId.startsWith('ticket_staff:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Unavailable',
            'This ticket is not active.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can use the staff panel.',
            { ephemeral: true }
          );
        }

        return reply(
          interaction,
          'Ticket Staff Panel',
          `**Opened by:** <@${ticket.userId}>\n**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed'}\n**Escalated:** ${ticket.escalated ? 'Yes' : 'No'}\n**Created:** <t:${Math.floor(ticket.createdAt / 1000)}:f>`,
          {
            ephemeral: true,
            components: [ticketStaffButtons(ticketId)]
          }
        );
      }

      // TICKET CLOSE: ASK FOR CONFIRMATION FIRST
      if (interaction.customId.startsWith('ticket_close:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Closed',
            'This ticket is already closed.',
            { ephemeral: true }
          );
        }

        if (
          interaction.user.id !== ticket.userId &&
          !canManageTickets(interaction)
        ) {
          return reply(
            interaction,
            'Permission Denied',
            'Only the ticket opener or ticket staff can close this ticket.',
            { ephemeral: true }
          );
        }

        return reply(
          interaction,
          'Confirm Ticket Closure',
          'Are you sure you want to close this ticket? Confirming will delete the ticket channel. This action cannot be undone.',
          {
            ephemeral: true,
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`ticket_close_confirm:${ticketId}`)
                  .setLabel('Confirm and Delete')
                  .setStyle(ButtonStyle.Danger),

                new ButtonBuilder()
                  .setCustomId(`ticket_close_cancel:${ticketId}`)
                  .setLabel('Cancel')
                  .setStyle(ButtonStyle.Secondary)
              )
            ]
          }
        );
      }

      if (interaction.customId.startsWith('ticket_close_cancel:')) {
        return privateText(
          interaction,
          'Ticket closure cancelled. The ticket remains open.'
        );
      }

      if (interaction.customId.startsWith('ticket_close_confirm:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return privateText(
            interaction,
            'This ticket is already closed or no longer exists.'
          );
        }

        if (
          interaction.user.id !== ticket.userId &&
          !canManageTickets(interaction)
        ) {
          return privateText(
            interaction,
            'Only the ticket opener or ticket staff can confirm closure.'
          );
        }

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;

        await saveData();

        const channel = interaction.channel;

        await interaction.editReply({
          content: 'Ticket closure confirmed. Deleting the ticket channel...'
        });

        try {
          if (channel) {
            await channel.delete(
              `Ticket closed by ${interaction.user.tag}`
            );
          }
        } catch (error) {
          console.error('Ticket deletion failed:', error);

          ticket.closed = false;
          ticket.closedAt = null;
          ticket.closedBy = null;

          await saveData();

          await interaction.followUp({
            content: 'Rover could not delete the ticket channel. Check its Manage Channels permission and role hierarchy.',
            flags: MessageFlags.Ephemeral
          }).catch(console.error);
        }

        return;
      }

      // TICKET ESCALATION
      if (interaction.customId.startsWith('ticket_escalate:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Unavailable',
            'This ticket is not active.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can escalate tickets.',
            { ephemeral: true }
          );
        }

        ticket.escalated = true;
        ticket.escalatedAt = Date.now();
        ticket.escalatedBy = interaction.user.id;

        await saveData();

        const roleId = staffRoleId();

        await interaction.channel.send({
          content: roleId
            ? `<@&${roleId}> This ticket has been escalated by ${interaction.user}.`
            : `This ticket has been escalated by ${interaction.user}. Configure TICKET_ESCALATION_ROLE_ID to notify an escalation role.`,
          allowedMentions: {
            roles: roleId ? [roleId] : [],
            users: [interaction.user.id]
          }
        });

        return reply(
          interaction,
          'Ticket Escalated',
          'The escalation has been recorded.',
          { ephemeral: true }
        );
      }

      // TICKET RENAME
      if (interaction.customId.startsWith('ticket_rename:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Unavailable',
            'This ticket is not active.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can rename tickets.',
            { ephemeral: true }
          );
        }

        return interaction.showModal(
          modal('Rename Ticket', `ticket_rename_modal:${ticketId}`, [
            textInput(
              'name',
              'New channel name',
              TextInputStyle.Short,
              true,
              'ticket-new-name',
              90
            )
          ])
        );
      }

      // TICKET ADD MEMBER
      if (interaction.customId.startsWith('ticket_add:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Unavailable',
            'This ticket is not active.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can add members.',
            { ephemeral: true }
          );
        }

        return privateText(
          interaction,
          'Choose the member you want to add to this ticket.',
          [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId('ticket_add_member')
                .setPlaceholder('Choose a member')
                .setMinValues(1)
                .setMaxValues(1)
            )
          ]
        );
      }

      // TICKET BLACKLIST
      if (interaction.customId.startsWith('ticket_blacklist:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket) {
          return reply(
            interaction,
            'Ticket Not Found',
            'This ticket no longer exists.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can manage the ticket blacklist.',
            { ephemeral: true }
          );
        }

        if (data.ticketBlacklist.includes(ticket.userId)) {
          data.ticketBlacklist = data.ticketBlacklist.filter(
            userId => userId !== ticket.userId
          );

          await saveData();

          return reply(
            interaction,
            'Blacklist Updated',
            `<@${ticket.userId}> has been removed from the ticket blacklist.`,
            { ephemeral: true }
          );
        }

        data.ticketBlacklist.push(ticket.userId);

        await saveData();

        return reply(
          interaction,
          'Blacklist Updated',
          `<@${ticket.userId}> has been blocked from opening new tickets.`,
          { ephemeral: true }
        );
      }
    }

    // MODALS
    if (interaction.isModalSubmit()) {
      // CREATE OR EDIT PRODUCT
      if (
        interaction.customId === 'product_create' ||
        interaction.customId.startsWith('product_edit:')
      ) {
        if (!await requireAdmin(interaction)) return;

        const editing = interaction.customId.startsWith('product_edit:');
        const productId = editing
          ? interaction.customId.split(':')[1]
          : null;

        const product = editing ? productById(productId) : null;

        if (editing && !product) {
          return reply(
            interaction,
            'Product Not Found',
            'This product no longer exists.',
            { ephemeral: true }
          );
        }

        const name = clean(
          interaction.fields.getTextInputValue('name'),
          100
        );

        const price = clean(
          interaction.fields.getTextInputValue('price'),
          100
        );

        const description = clean(
          interaction.fields.getTextInputValue('description'),
          1000
        );

        const purchaseUrl = clean(
          interaction.fields.getTextInputValue('purchaseUrl'),
          500
        );

        const category = clean(
          interaction.fields.getTextInputValue('category'),
          100
        );

        if (!name || !price || !description || !category) {
          return reply(
            interaction,
            'Missing Product Details',
            'Please fill in the product name, price, description and category.',
            { ephemeral: true }
          );
        }

        if (
          purchaseUrl &&
          !/^https?:\/\/\S+$/i.test(purchaseUrl)
        ) {
          return reply(
            interaction,
            'Invalid Purchase URL',
            'Enter a complete URL beginning with http:// or https://, or leave the field blank.',
            { ephemeral: true }
          );
        }

        if (product) {
          Object.assign(product, {
            name,
            price,
            description,
            purchaseUrl,
            category,
            active: true,
            updatedAt: Date.now()
          });
        } else {
          data.products.push({
            id: id(),
            name,
            price,
            description,
            purchaseUrl,
            category,
            active: true,
            createdAt: Date.now(),
            createdBy: interaction.user.id
          });
        }

        await saveData();

        return reply(
          interaction,
          editing ? 'Product Updated' : 'Product Created',
          [
            `**${name}**`,
            `**Price:** ${price}`,
            `**Category:** ${category}`,
            '',
            editing
              ? 'The product details have been updated.'
              : 'The product has been added to the active catalogue.',
            '',
            'Use `/purchase` to browse available products.'
          ].join('\n'),
          { ephemeral: true }
        );
      }

      // CREATE GIVEAWAY
      if (interaction.customId === 'giveaway_create') {
        if (!await requireAdmin(interaction)) return;

        const prize = clean(
          interaction.fields.getTextInputValue('prize'),
          100
        );

        const details = clean(
          interaction.fields.getTextInputValue('details'),
          1000
        );

        const duration = parseDuration(
          interaction.fields.getTextInputValue('duration')
        );

        const winnerCount = Number(
          interaction.fields.getTextInputValue('winners')
        );

        if (!prize) {
          return reply(
            interaction,
            'Missing Prize',
            'Please enter a giveaway prize.',
            { ephemeral: true }
          );
        }

        if (!duration) {
          return reply(
            interaction,
            'Invalid Duration',
            'Use a duration such as 30m, 2h or 3d. The maximum is 7 days.',
            { ephemeral: true }
          );
        }

        if (
          !Number.isInteger(winnerCount) ||
          winnerCount < 1 ||
          winnerCount > 10
        ) {
          return reply(
            interaction,
            'Invalid Winner Count',
            'Choose between 1 and 10 winners.',
            { ephemeral: true }
          );
        }

        const giveaway = {
          id: id(),
          prize,
          details,
          winnerCount,
          endsAt: Date.now() + duration,
          entrants: [],
          winners: [],
          ended: false,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: null,
          createdBy: interaction.user.id,
          createdAt: Date.now()
        };

        await interaction.deferReply({
          flags: MessageFlags.Ephemeral
        });

        data.giveaways.push(giveaway);
        await saveData();

        try {
          const message = await interaction.channel.send(
            giveawayPayload(giveaway)
          );

          giveaway.messageId = message.id;

          await saveData();
          scheduleGiveaway(giveaway);

          return interaction.editReply({
            content: `The giveaway has been posted and will end <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`
          });
        } catch (error) {
          console.error('Could not publish giveaway:', error);

          giveaway.ended = true;
          giveaway.failedToPublish = true;

          await saveData();

          return interaction.editReply({
            content: 'The giveaway could not be posted. Check Rover has permission to send messages in this channel.'
          });
        }
      }

      // SUBMIT REVIEW
      if (interaction.customId.startsWith('review_submit:')) {
        const productId = interaction.customId.split(':')[1];
        const product = productById(productId);

        if (!product || product.active === false) {
          return reply(
            interaction,
            'Product Not Found',
            'This product no longer exists or is no longer active.',
            { ephemeral: true }
          );
        }

        const delivered = data.deliveries.some(
          order =>
            order.productId === productId &&
            order.customerId === interaction.user.id
        );

        if (!delivered) {
          return reply(
            interaction,
            'Review Not Allowed',
            'You can only review products recorded as delivered to your account.',
            { ephemeral: true }
          );
        }

        if (data.reviews.some(
          review =>
            review.productId === productId &&
            review.userId === interaction.user.id
        )) {
          return reply(
            interaction,
            'Already Reviewed',
            'You have already reviewed this product.',
            { ephemeral: true }
          );
        }

        const rating = Number(
          interaction.fields.getTextInputValue('rating')
        );

        const comment = clean(
          interaction.fields.getTextInputValue('comment'),
          1000
        );

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          return reply(
            interaction,
            'Invalid Rating',
            'Your rating must be a whole number from 1 to 5.',
            { ephemeral: true }
          );
        }

        if (!comment) {
          return reply(
            interaction,
            'Missing Review',
            'Please write a comment before submitting your review.',
            { ephemeral: true }
          );
        }

        const review = {
          id: id(),
          productId,
          productName: product.name,
          userId: interaction.user.id,
          rating,
          comment,
          timestamp: Date.now()
        };

        data.reviews.push(review);
        await saveData();

        let published = false;

        try {
          published = await publishReview(interaction.guild, review);
        } catch (error) {
          console.error('Could not publish customer review:', error);
        }

        return reply(
          interaction,
          'Review Submitted',
          [
            `Thank you for reviewing **${product.name}**.`,
            '',
            `**Your rating:** ${rating}/5`,
            `**Product average:** ${averageRating(productId)}`,
            '',
            published
              ? 'Your review has been published to the review channel.'
              : 'Your review has been saved, but it could not be published. The review channel may not be configured or accessible.'
          ].join('\n'),
          { ephemeral: true }
        );
      }

      // RENAME TICKET
      if (interaction.customId.startsWith('ticket_rename_modal:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(
            interaction,
            'Ticket Unavailable',
            'This ticket is not active.',
            { ephemeral: true }
          );
        }

        if (!canManageTickets(interaction)) {
          return reply(
            interaction,
            'Permission Denied',
            'Only ticket staff can rename tickets.',
            { ephemeral: true }
          );
        }

        const newName = clean(
          interaction.fields.getTextInputValue('name'),
          90
        ).toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');

        if (!newName) {
          return reply(
            interaction,
            'Invalid Name',
            'Please provide a valid channel name.',
            { ephemeral: true }
          );
        }

        try {
          await interaction.channel.setName(newName);
        } catch (error) {
          console.error('Ticket rename failed:', error);

          return reply(
            interaction,
            'Rename Failed',
            'Rover could not rename the channel. Check its Manage Channels permission.',
            { ephemeral: true }
          );
        }

        return reply(
          interaction,
          'Ticket Renamed',
          `This ticket is now named **${newName}**.`,
          { ephemeral: true }
        );
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    const message =
      'Something went wrong while processing that action. Please try again. The full error has been logged in the Rover console.';

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: message,
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      console.error('Could not send interaction error response:', replyError);
    }
  }
});

client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

client.login(TOKEN).catch(error => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
