
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
  console.error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.');
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
  ticketConfig: { categoryId: null, panelChannelId: null },
  tickets: {},
  ticketBlacklist: [],
  reviewConfig: { channelId: null },
  reviews: [],
  orders: []
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
  } catch (error) {
    console.error('Could not read bot-data.json. Fix the file before restarting.');
    console.error(error);
    process.exit(1);
  }
} else {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let saveQueue = Promise.resolve();

function saveData() {
  saveQueue = saveQueue.then(async () => {
    const temporary = `${DATA_FILE}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(data, null, 2));
    await fs.promises.rename(temporary, DATA_FILE);
  });

  saveQueue = saveQueue.catch(error => {
    console.error('Could not save Rover data:', error);
    throw error;
  });

  return saveQueue;
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

  if (options.components) {
    payload.components.push(...options.components);
  }

  return payload;
}

async function reply(interaction, title, body, options = {}) {
  const payload = panelPayload(title, body, options);

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
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
    description: clean(`${product.price || 'Price not set'} | ${product.category || 'General'}`, 100),
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
  return modal(`Leave a Review`, `review_submit:${productId}`, [
    textInput('rating', 'Rating from 1 to 5', TextInputStyle.Short, true, '5', 1),
    textInput('comment', 'Your review', TextInputStyle.Paragraph, true, 'Tell others about your experience', 1000)
  ]);
}

function parseDuration(value) {
  const match = /^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/i.exec(String(value).trim());

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multiplier = unit.startsWith('m')
    ? 60000
    : unit.startsWith('h')
      ? 3600000
      : 86400000;

  const duration = amount * multiplier;

  if (!Number.isFinite(duration) || duration < 60000 || duration > 7 * 86400000) {
    return null;
  }

  return duration;
}

function averageRating(productId) {
  const reviews = data.reviews.filter(review => review.productId === productId);

  if (!reviews.length) return 'No reviews yet';

  return `${(
    reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
  ).toFixed(1)}/5 (${reviews.length} review${reviews.length === 1 ? '' : 's'})`;
}

async function publishReview(interaction, review) {
  if (!data.reviewConfig.channelId) return;

  const channel = await interaction.guild.channels
    .fetch(data.reviewConfig.channelId)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const product = productById(review.productId);

  const body = [
    `**Product:** ${product?.name || review.productName}`,
    `**Rating:** ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)`,
    `**Customer:** <@${review.userId}>`,
    `**Review:** ${review.comment}`,
    `**Product average:** ${averageRating(review.productId)}`,
    `**Review ID:** \`${review.id}\``
  ].join('\n');

  await channel.send(
    panelPayload('Customer Review', body, { emoji: EMOJIS.Star })
  );
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
      : `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>\n**Entries:** ${giveaway.entrants.length}`,
    `**Giveaway ID:** \`${giveaway.id}\``
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
  const giveaway = data.giveaways.find(item => item.id === giveawayId);

  if (!giveaway || giveaway.ended) return;

  giveaway.ended = true;

  const entrants = [...new Set(giveaway.entrants || [])];
  const winners = [];

  while (entrants.length && winners.length < giveaway.winnerCount) {
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

        if (winner) {
          await winner.send(
            panelPayload(
              'Congratulations — You Won!',
              `You won **${giveaway.prize}** in a Rover Official Store giveaway.\n\n**Giveaway ID:** \`${giveaway.id}\`\n**Server:** ${giveaway.guildId ? `https://discord.com/channels/${giveaway.guildId}` : 'Rover Official Store'}\n\nPlease contact the store team to arrange your prize.`,
              { emoji: EMOJIS.Gift }
            )
          ).catch(() => null);
        }
      }
    } else {
      await channel.send(
        `The giveaway for **${giveaway.prize}** has ended with no eligible entrants.`
      ).catch(console.error);
    }
  }
}

function scheduleGiveaway(giveaway) {
  if (giveaway.ended) return;

  const delay = Math.max(0, giveaway.endsAt - Date.now());

  setTimeout(() => {
    endGiveaway(giveaway.id).catch(console.error);
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
    .setDescription('Open the Rover information menu.'),

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
    .setDescription('Moderate and remove a customer review.')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('Review ID.')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Send a plain-text webhook announcement.')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The announcement text.')
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
          return reply(interaction, 'No Products', 'Create a product first.', { ephemeral: true });
        }

        return interaction.reply({
          content: 'Choose a product to edit.',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('product_edit_select')
                .setPlaceholder('Choose a product')
                .addOptions(options)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      if (command === 'delete-product') {
        if (!await requireAdmin(interaction)) return;

        const options = productOptions();

        if (!options.length) {
          return reply(interaction, 'No Products', 'There are no active products to delete.', { ephemeral: true });
        }

        return interaction.reply({
          content: 'Choose a product to remove.',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('product_delete_select')
                .setPlaceholder('Choose a product')
                .addOptions(options)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      if (command === 'purchase') {
        const options = productOptions();

        if (!options.length) {
          return reply(interaction, 'Store Catalogue', 'There are currently no products available.');
        }

        return reply(
          interaction,
          'Store Catalogue',
          'Choose a product below to view its details and purchasing information.',
          {
            emoji: EMOJIS.Shopping,
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('purchase_select')
                  .setPlaceholder('Browse products')
                  .addOptions(options)
              )
            ]
          }
        );
      }

      if (command === 'give-product') {
        if (!await requireAdmin(interaction)) return;

        const options = productOptions();

        if (!options.length) {
          return reply(interaction, 'No Products', 'Create a product before delivering it.', { ephemeral: true });
        }

        return interaction.reply({
          content: 'Select the product to deliver.',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('deliver_product_select')
                .setPlaceholder('Choose product')
                .addOptions(options)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      if (command === 'my-orders') {
        const orders = data.deliveries.filter(
          order => order.customerId === interaction.user.id
        );

        if (!orders.length) {
          return reply(
            interaction,
            'My Orders',
            'No completed deliveries have been recorded for your account.',
            { ephemeral: true }
          );
        }

        const body = orders.slice(-15).reverse().map(order =>
          `**${order.productName}**\nOrder: \`${order.id}\` • <t:${Math.floor(order.timestamp / 1000)}:R>`
        ).join('\n\n');

        return reply(interaction, 'My Orders', body, { ephemeral: true });
      }

      if (command === 'information') {
        return reply(
          interaction,
          'Rover Information',
          'Choose a section from the menu below to learn more about Rover Official Store.',
          { components: [informationMenu()] }
        );
      }

      if (command === 'ticket') {
        if (!await requireAdmin(interaction)) return;

        const category = interaction.options.getChannel('category');

        data.ticketConfig.categoryId = category.id;
        data.ticketConfig.panelChannelId = interaction.channelId;

        await saveData();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_open')
            .setLabel('Open Support Ticket')
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send(
          panelPayload(
            'Customer Support',
            'Need help with a purchase, delivery or another store issue? Open a ticket and our team will assist you.',
            { emoji: EMOJIS.Ticket, components: [row] }
          )
        );

        return reply(
          interaction,
          'Ticket System Configured',
          `Ticket category set to ${category}. The support panel has been posted.`
        );
      }

      if (command === 'giveaway') {
        if (!await requireAdmin(interaction)) return;

        if (interaction.options.getSubcommand() === 'setup') {
          return interaction.showModal(giveawayModal());
        }

        const giveawayId = clean(interaction.options.getString('id'), 50).toUpperCase();
        const giveaway = data.giveaways.find(
          item => item.id === giveawayId && !item.ended
        );

        if (!giveaway) {
          return reply(
            interaction,
            'Giveaway Not Found',
            'Check the giveaway ID and try again.',
            { ephemeral: true }
          );
        }

        await endGiveaway(giveaway.id);

        return reply(
          interaction,
          'Giveaway Ended',
          `Giveaway \`${giveaway.id}\` has been ended.`
        );
      }

      if (command === 'roles') {
        if (!await requireAdmin(interaction)) return;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
          return reply(
            interaction,
            'Missing Permission',
            'Rover needs Manage Roles permission to configure roles.',
            { ephemeral: true }
          );
        }

        const roleDefinitions = [
          { name: 'Owner', permissions: [PermissionFlagsBits.Administrator] },
          {
            name: 'Administrator',
            permissions: [
              PermissionFlagsBits.ManageGuild,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages
            ]
          },
          {
            name: 'Moderator',
            permissions: [
              PermissionFlagsBits.KickMembers,
              PermissionFlagsBits.BanMembers,
              PermissionFlagsBits.ModerateMembers,
              PermissionFlagsBits.ManageMessages
            ]
          },
          {
            name: 'Support',
            permissions: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageMessages
            ]
          },
          { name: 'Customer', permissions: [] },
          { name: 'Verified', permissions: [] },
          { name: 'Member', permissions: [] },
          { name: 'Muted', permissions: [] }
        ];

        const created = [];
        const updated = [];
        const skipped = [];
        const botMember = interaction.guild.members.me;

        for (const definition of roleDefinitions) {
          let role = interaction.guild.roles.cache.find(
            item => item.name === definition.name
          );

          if (role && botMember && role.position >= botMember.roles.highest.position) {
            skipped.push(definition.name);
            continue;
          }

          if (!role) {
            role = await interaction.guild.roles.create({
              name: definition.name,
              permissions: definition.permissions,
              color: PURPLE,
              reason: 'Rover role setup'
            });

            created.push(definition.name);
          } else {
            await role.setPermissions(
              definition.permissions,
              'Rover role setup'
            );

            if (role.name !== 'Muted') {
              await role.setColor(PURPLE, 'Rover role setup').catch(() => null);
            }

            updated.push(definition.name);
          }

          data.roles[definition.name] = role.id;
        }

        data.rolesSetupCompleted = true;
        await saveData();

        return reply(
          interaction,
          'Role Setup Complete',
          `**Created:** ${created.join(', ') || 'None'}\n**Updated:** ${updated.join(', ') || 'None'}\n**Skipped:** ${skipped.join(', ') || 'None'}\n\nRover does not automatically assign the Owner role or any other role to members. Review role positions and permissions after setup.`
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
          `Customer reviews will be published in ${channel}.`
        );
      }

      if (command === 'review') {
        const options = productOptions();

        if (!options.length) {
          return reply(interaction, 'Reviews', 'There are no products to review.', { ephemeral: true });
        }

        return interaction.reply({
          content: 'Choose the product you received.',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('review_product_select')
                .setPlaceholder('Choose a product')
                .addOptions(options)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      if (command === 'review-remove') {
        if (!await requireAdmin(interaction)) return;

        const reviewId = clean(interaction.options.getString('id'), 50).toUpperCase();
        const index = data.reviews.findIndex(review => review.id === reviewId);

        if (index === -1) {
          return reply(interaction, 'Review Not Found', 'No review matches that ID.', { ephemeral: true });
        }

        const [review] = data.reviews.splice(index, 1);

        await saveData();

        return reply(
          interaction,
          'Review Removed',
          `Review \`${review.id}\` was removed from Rover's stored reviews. Its already-posted message, if any, may need to be deleted separately.`
        );
      }

      if (command === 'announcement') {
        if (!await requireAdmin(interaction)) return;

        const message = clean(interaction.options.getString('message'), 1900);

        if (!message) {
          return reply(interaction, 'Empty Announcement', 'Please provide announcement text.', { ephemeral: true });
        }

        const channel = interaction.channel;

        if (!channel?.isTextBased() || !channel.guild) {
          return reply(interaction, 'Invalid Channel', 'Use this command in a server text channel.', { ephemeral: true });
        }

        const botMember = interaction.guild.members.me;

        if (!botMember.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) {
          return reply(interaction, 'Missing Permission', 'Rover needs Manage Webhooks permission in this channel.', { ephemeral: true });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
          const hooks = await channel.fetchWebhooks();

          let webhook = hooks.find(
            item => item.owner?.id === client.user.id && item.name === FOOTER
          );

          if (!webhook) {
            webhook = await channel.createWebhook({
              name: FOOTER,
              avatar: process.env.ROVER_ICON_URL || client.user.displayAvatarURL()
            });
          }

          await webhook.send({
            content: message,
            username: FOOTER,
            avatarURL: process.env.ROVER_ICON_URL || client.user.displayAvatarURL(),
            allowedMentions: { parse: [] }
          });

          return interaction.editReply({ content: 'Announcement sent.' });
        } catch (error) {
          console.error('Announcement failed:', error);

          return interaction.editReply({
            content: 'The announcement could not be sent. Check Rover’s Manage Webhooks permission and the channel settings.'
          });
        }
      }

      if (['ban', 'kick', 'timeout', 'untimeout'].includes(command)) {
        if (!await requireAdmin(interaction)) return;

        const user = interaction.options.getUser('user');
        const reason = clean(interaction.options.getString('reason'), 500);

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
            await member.ban({ reason });
          } else if (command === 'kick') {
            await member.kick(reason);
          } else if (command === 'timeout') {
            const minutes = interaction.options.getInteger('minutes');
            await member.timeout(minutes * 60000, reason);
          } else if (command === 'untimeout') {
            await member.timeout(null, reason);
          }
        } catch (error) {
          console.error(`Moderation action ${command} failed:`, error);

          return reply(
            interaction,
            'Moderation Failed',
            'Rover could not complete this action. Check its permissions and role position.',
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

        const actionText = command === 'untimeout' ? 'Remove Timeout' : command;

        return reply(
          interaction,
          'Moderation Action Complete',
          `**Action:** ${actionText}\n**Member:** ${user.tag}\n**Reason:** ${reason}`
        );
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'information_menu') {
        const sections = {
          about: `**Rover Official Store**\nRover helps customers browse products, receive deliveries, access support and participate in giveaways.`,
          products: `**Products and Purchasing**\nUse \`/purchase\` to browse available products. Read each product's description and follow its listed purchase information.`,
          delivery: `**Delivery and Order Support**\nUse \`/my-orders\` to view recorded deliveries. If you need help, open a support ticket.`,
          giveaways: `**Giveaways and Winners**\nUse the entry button on an active giveaway. Winners are selected when the giveaway ends.`,
          safety: `**Account Safety and Privacy**\nNever share passwords, authentication codes or sensitive account information. Only use purchase links you trust.`,
          terms: `**Terms, Refunds and Disputes**\nCheck the store's stated terms before purchasing. If there is a problem with an order, contact support through a ticket.`
        };

        return interaction.update(
          panelPayload(
            'Rover Information',
            sections[interaction.values[0]] || 'Section unavailable.'
          )
        );
      }

      if (interaction.customId === 'product_edit_select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return interaction.reply({
            content: 'That product is no longer available to edit.',
            flags: MessageFlags.Ephemeral
          });
        }

        return interaction.showModal(productModal(product));
      }

      if (interaction.customId === 'product_delete_select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return interaction.reply({
            content: 'That product is no longer available to delete.',
            flags: MessageFlags.Ephemeral
          });
        }

        product.active = false;
        product.deletedAt = Date.now();

        await saveData();

        return interaction.update({
          content: `Product **${product.name}** has been removed from the active catalogue.`,
          components: []
        });
      }

      if (interaction.customId === 'purchase_select') {
        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return reply(
            interaction,
            'Product Unavailable',
            'This product is no longer available.',
            { ephemeral: true }
          );
        }

        const body = [
          `**Product:** ${product.name}`,
          `**Price:** ${product.price}`,
          `**Category:** ${product.category || 'General'}`,
          `**Description:** ${product.description}`,
          `**Reviews:** ${averageRating(product.id)}`,
          product.purchaseUrl
            ? `**Purchase link:** ${product.purchaseUrl}`
            : '**Purchase link:** Contact support for purchasing information.'
        ].join('\n');

        return interaction.update(
          panelPayload('Product Details', body, { emoji: EMOJIS.Shopping })
        );
      }

      if (interaction.customId === 'deliver_product_select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return interaction.reply({
            content: 'Product not found or no longer active.',
            flags: MessageFlags.Ephemeral
          });
        }

        const row = new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`deliver_customer:${product.id}`)
            .setPlaceholder('Choose the customer')
            .setMinValues(1)
            .setMaxValues(1)
        );

        return interaction.update({
          content: `Selected **${product.name}**. Choose the customer to receive it.`,
          components: [row]
        });
      }

      if (interaction.customId === 'review_product_select') {
        const product = productById(interaction.values[0]);

        if (!product || product.active === false) {
          return interaction.reply({
            content: 'Product not found or no longer active.',
            flags: MessageFlags.Ephemeral
          });
        }

        const delivered = data.deliveries.some(
          order => order.productId === product.id &&
            order.customerId === interaction.user.id
        );

        if (!delivered) {
          return interaction.update({
            content: 'You can only review products recorded as delivered to your account.',
            components: []
          });
        }

        if (data.reviews.some(
          review => review.productId === product.id &&
            review.userId === interaction.user.id
        )) {
          return interaction.update({
            content: 'You have already reviewed this product.',
            components: []
          });
        }

        return interaction.showModal(reviewModal(product.id));
      }
    }

    if (interaction.isUserSelectMenu()) {
      if (interaction.customId === 'ticket_add_member') {
        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can add members.', { ephemeral: true });
        }

        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket) {
          return reply(interaction, 'Ticket Not Found', 'This is not an active ticket.', { ephemeral: true });
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
          return interaction.update({
            content: 'Product not found or no longer active.',
            components: []
          });
        }

        return interaction.update({
          content: `Confirm delivery of **${product.name}** to <@${customerId}>.`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`deliver_confirm:${product.id}:${customerId}`)
                .setLabel('Confirm Delivery')
                .setStyle(ButtonStyle.Success)
            )
          ]
        });
      }
    }

    if (interaction.isButton()) {
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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
                PermissionFlagsBits.ManageChannels
              ]
            }
          ];

          const escalationRole = staffRoleId();

          if (escalationRole && interaction.guild.roles.cache.has(escalationRole)) {
            overwrites.push({
              id: escalationRole,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
              ]
            });
          }

          const safeUsername = interaction.user.username
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '')
            .slice(0, 80) || 'customer';

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
              `Hello <@${interaction.user.id}>. Please describe the issue and include any relevant order details.\n\n**Ticket ID:** \`${ticketId}\`\nOur support team will respond as soon as possible.`,
              { emoji: EMOJIS.Ticket, components: [ticketButtons(ticketId)] }
            )
          );

          return interaction.editReply({
            content: `Your ticket has been created: ${channel}`
          });
        } catch (error) {
          console.error('Ticket creation failed:', error);

          return interaction.editReply({
            content: 'Rover could not create your ticket. Check its Manage Channels permission and the configured category.'
          });
        }
      }

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
              await message.edit(giveawayPayload(giveaway)).catch(() => null);
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

      if (interaction.customId.startsWith('deliver_confirm:')) {
        if (!await requireAdmin(interaction)) return;

        const [, productId, customerId] = interaction.customId.split(':');
        const product = productById(productId);

        if (!product || product.active === false) {
          return reply(
            interaction,
            'Product Not Found',
            'This product no longer exists or is no longer active.',
            { ephemeral: true }
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
                `A product has been delivered to you by Rover Official Store.\n\n**Product:** ${product.name}\n**Price:** ${product.price}\n**Order ID:** \`${order.id}\`\n\nIf you need help, open a support ticket in the store server.`,
                { emoji: EMOJIS.Box }
              )
            );

            dmSent = true;
          } catch {
            dmSent = false;
          }
        }

        return interaction.editReply({
          content: `Delivery recorded for <@${customerId}>.\n**Order ID:** \`${order.id}\`\n**Customer DM:** ${dmSent ? 'Sent successfully.' : 'Could not be sent; the customer may have DMs disabled.'}`,
          components: []
        });
      }

      if (interaction.customId.startsWith('ticket_claim:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Closed', 'This ticket is no longer active.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can claim tickets.', { ephemeral: true });
        }

        ticket.claimedBy = interaction.user.id;
        ticket.claimedAt = Date.now();

        await saveData();

        return reply(
          interaction,
          'Ticket Claimed',
          `This ticket has been claimed by ${interaction.user}.`
        );
      }

      if (interaction.customId.startsWith('ticket_staff:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Unavailable', 'This ticket is not active.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can use the staff panel.', { ephemeral: true });
        }

        return reply(
          interaction,
          'Ticket Staff Panel',
          `**Ticket ID:** \`${ticket.id}\`\n**Opened by:** <@${ticket.userId}>\n**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed'}\n**Escalated:** ${ticket.escalated ? 'Yes' : 'No'}`,
          {
            ephemeral: true,
            components: [ticketStaffButtons(ticketId)]
          }
        );
      }

      if (interaction.customId.startsWith('ticket_close:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Closed', 'This ticket is already closed.', { ephemeral: true });
        }

        if (interaction.user.id !== ticket.userId && !canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only the ticket opener or staff can close this ticket.', { ephemeral: true });
        }

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;

        await saveData();

        await interaction.channel.permissionOverwrites.edit(ticket.userId, {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true
        }).catch(console.error);

        await interaction.channel.send(
          panelPayload(
            'Ticket Closed',
            `This ticket was closed by ${interaction.user}. Staff can manage the channel manually if needed.\n\n**Ticket ID:** \`${ticket.id}\``
          )
        );

        return reply(
          interaction,
          'Ticket Closed',
          'This support ticket has been closed.',
          { ephemeral: true }
        );
      }

      if (interaction.customId.startsWith('ticket_escalate:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Unavailable', 'This ticket is not active.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can escalate tickets.', { ephemeral: true });
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
          allowedMentions: { roles: roleId ? [roleId] : [] }
        });

        return reply(
          interaction,
          'Ticket Escalated',
          'The escalation has been recorded.'
        );
      }

      if (interaction.customId.startsWith('ticket_rename:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Unavailable', 'This ticket is not active.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can rename tickets.', { ephemeral: true });
        }

        return interaction.showModal(
          modal('Rename Ticket', `ticket_rename_modal:${ticketId}`, [
            textInput('name', 'New channel name', TextInputStyle.Short, true, 'ticket-new-name', 90)
          ])
        );
      }

      if (interaction.customId.startsWith('ticket_add:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Unavailable', 'This ticket is not active.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can add members.', { ephemeral: true });
        }

        return interaction.reply({
          content: `Choose a member to add to ticket \`${ticketId}\`.`,
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId('ticket_add_member')
                .setPlaceholder('Choose a member')
                .setMinValues(1)
                .setMaxValues(1)
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId.startsWith('ticket_blacklist:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket) {
          return reply(interaction, 'Ticket Not Found', 'This ticket no longer exists.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can manage the ticket blacklist.', { ephemeral: true });
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

    if (interaction.isModalSubmit()) {
      if (
        interaction.customId === 'product_create' ||
        interaction.customId.startsWith('product_edit:')
      ) {
        if (!await requireAdmin(interaction)) return;

        const editing = interaction.customId.startsWith('product_edit:');
        const productId = editing ? interaction.customId.split(':')[1] : null;
        const product = editing ? productById(productId) : null;

        if (editing && !product) {
          return reply(interaction, 'Product Not Found', 'This product no longer exists.', { ephemeral: true });
        }

        const name = clean(interaction.fields.getTextInputValue('name'), 100);
        const price = clean(interaction.fields.getTextInputValue('price'), 100);
        const description = clean(interaction.fields.getTextInputValue('description'), 1000);
        const purchaseUrl = clean(interaction.fields.getTextInputValue('purchaseUrl'), 500);
        const category = clean(interaction.fields.getTextInputValue('category'), 100);

        if (!name || !price || !description || !category) {
          return reply(
            interaction,
            'Missing Product Details',
            'Please fill in the product name, price, description and category.',
            { ephemeral: true }
          );
        }

        if (purchaseUrl && !/^https?:\/\/\S+$/i.test(purchaseUrl)) {
          return reply(
            interaction,
            'Invalid Purchase URL',
            'Enter a complete URL beginning with http:// or https://, or leave it blank.',
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
          `**${name}**\n**Price:** ${price}\n**Category:** ${category}\n\nThe product is now available in the catalogue.`
        );
      }

      if (interaction.customId === 'giveaway_create') {
        if (!await requireAdmin(interaction)) return;

        const prize = clean(interaction.fields.getTextInputValue('prize'), 100);
        const details = clean(interaction.fields.getTextInputValue('details'), 1000);
        const duration = parseDuration(interaction.fields.getTextInputValue('duration'));
        const winnerCount = Number(interaction.fields.getTextInputValue('winners'));

        if (!prize) {
          return reply(interaction, 'Missing Prize', 'Please enter a giveaway prize.', { ephemeral: true });
        }

        if (!duration) {
          return reply(
            interaction,
            'Invalid Duration',
            'Use a duration such as 30m, 2h or 3d. The maximum is 7 days.',
            { ephemeral: true }
          );
        }

        if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 10) {
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

        data.giveaways.push(giveaway);
        await saveData();

        try {
          const message = await interaction.channel.send(giveawayPayload(giveaway));

          giveaway.messageId = message.id;
          await saveData();

          scheduleGiveaway(giveaway);

          return reply(
            interaction,
            'Giveaway Created',
            `Giveaway \`${giveaway.id}\` has been posted and will end <t:${Math.floor(giveaway.endsAt / 1000)}:R>.`
          );
        } catch (error) {
          console.error('Could not publish giveaway:', error);

          giveaway.ended = true;
          giveaway.failedToPublish = true;
          await saveData();

          return reply(
            interaction,
            'Giveaway Could Not Be Posted',
            'Rover could not post the giveaway. Check its permissions in this channel.',
            { ephemeral: true }
          );
        }
      }

      if (interaction.customId.startsWith('review_submit:')) {
        const productId = interaction.customId.split(':')[1];
        const product = productById(productId);

        if (!product || product.active === false) {
          return reply(interaction, 'Product Not Found', 'This product no longer exists or is no longer active.', { ephemeral: true });
        }

        const delivered = data.deliveries.some(
          order => order.productId === productId &&
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
          review => review.productId === productId &&
            review.userId === interaction.user.id
        )) {
          return reply(
            interaction,
            'Already Reviewed',
            'You have already reviewed this product.',
            { ephemeral: true }
          );
        }

        const rating = Number(interaction.fields.getTextInputValue('rating'));
        const comment = clean(interaction.fields.getTextInputValue('comment'), 1000);

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

        await publishReview(interaction, review).catch(error => {
          console.error('Could not publish customer review:', error);
        });

        return reply(
          interaction,
          'Review Submitted',
          `Thank you for reviewing **${product.name}**.\n\n**Review ID:** \`${review.id}\`\n**Your rating:** ${rating}/5\n**Product average:** ${averageRating(productId)}`
        );
      }

      if (interaction.customId.startsWith('ticket_rename_modal:')) {
        const ticketId = interaction.customId.split(':')[1];
        const ticket = data.tickets[ticketId];

        if (!ticket || ticket.closed) {
          return reply(interaction, 'Ticket Unavailable', 'This ticket is not active.', { ephemeral: true });
        }

        if (!canManageTickets(interaction)) {
          return reply(interaction, 'Permission Denied', 'Only ticket staff can rename tickets.', { ephemeral: true });
        }

        const newName = clean(
          interaction.fields.getTextInputValue('name'),
          90
        ).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

        if (!newName) {
          return reply(interaction, 'Invalid Name', 'Please provide a valid channel name.', { ephemeral: true });
        }

        await interaction.channel.setName(newName);

        return reply(
          interaction,
          'Ticket Renamed',
          `This ticket is now named **${newName}**.`
        );
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: 'Something went wrong while processing that action. Please check the bot console for details.',
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: 'Something went wrong while processing that action. Please check the bot console for details.',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch {}
  }
});

client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

client.login(TOKEN).catch(error => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
