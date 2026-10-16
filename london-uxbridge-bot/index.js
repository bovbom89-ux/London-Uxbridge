require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, ChannelType, PermissionFlagsBits,
  MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');

const { DISCORD_TOKEN: TOKEN, DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_GUILD_ID: GUILD_ID } = process.env;

const PURPLE = 0x8B70C8;
const FOOTER = 'Rover Official Store';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bot-data.json');

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID or DISCORD_GUILD_ID.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const defaults = () => ({
  products: [], giveaways: [], deliveries: [], moderation: [],
  roles: {}, rolesSetupCompleted: false,
  ticketConfig: { categoryId: null, panelChannelId: null },
  tickets: {}, ticketBlacklist: [],
  reviewConfig: { channelId: null }, reviews: []
});

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults(), null, 2));
  }

  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    return {
      ...defaults(), ...d,
      products: Array.isArray(d.products) ? d.products : [],
      giveaways: Array.isArray(d.giveaways) ? d.giveaways : [],
      deliveries: Array.isArray(d.deliveries) ? d.deliveries : [],
      moderation: Array.isArray(d.moderation) ? d.moderation : [],
      roles: d.roles && typeof d.roles === 'object' ? d.roles : {},
      rolesSetupCompleted: Boolean(d.rolesSetupCompleted),
      ticketConfig: { ...defaults().ticketConfig, ...(d.ticketConfig || {}) },
      tickets: d.tickets && typeof d.tickets === 'object' ? d.tickets : {},
      ticketBlacklist: Array.isArray(d.ticketBlacklist) ? d.ticketBlacklist : [],
      reviewConfig: { ...defaults().reviewConfig, ...(d.reviewConfig || {}) },
      reviews: Array.isArray(d.reviews) ? d.reviews : []
    };
  } catch (e) {
    console.error('Could not read bot-data.json:', e);
    return defaults();
  }
}

let data = loadData();
let saveQueue = Promise.resolve();

function saveData() {
  saveQueue = saveQueue.catch(() => {}).then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  });

  return saveQueue;
}

const makeId = p =>
  `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const clean = (v, n = 1000) => String(v ?? '').trim().slice(0, n);

const activeProducts = () => data.products.filter(p =>
  p && typeof p === 'object' && p.active !== false &&
  typeof p.id === 'string' && typeof p.name === 'string' && p.name.trim()
);

const productById = id => data.products.find(p => p && p.id === id);

const isAdmin = i => Boolean(
  i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
  i.memberPermissions?.has(PermissionFlagsBits.Administrator)
);

function makePanel(title, sections = []) {
  const c = new ContainerBuilder().setAccentColor(PURPLE);
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));

  for (const s of sections.filter(Boolean)) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(s)));
  }

  c.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${FOOTER}`));
  return c;
}

function payload(title, sections = [], ephemeral = true, extra = []) {
  return {
    components: [makePanel(title, sections), ...extra],
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] }
  };
}

async function reply(i, title, sections = [], ephemeral = true) {
  const p = payload(title, sections, ephemeral);
  return i.deferred || i.replied ? i.editReply(p) : i.reply(p);
}

async function requireAdmin(i) {
  if (isAdmin(i)) return true;
  await reply(i, 'Permission Required', ['You need **Manage Server** or **Administrator**.']);
  return false;
}

function textInput(id, label, required = true, value = '', max = 1000, paragraph = false) {
  const t = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(max);

  if (value) t.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(t);
}

function productModal(p = null) {
  return new ModalBuilder()
    .setCustomId(p ? `rover:product:edit:${p.id}` : 'rover:product:create')
    .setTitle(p ? 'Edit product' : 'Create product')
    .addComponents(
      textInput('name', 'Product name', true, p?.name || '', 100),
      textInput('price', 'Price', true, p?.price || '', 80),
      textInput('description', 'Description', true, p?.description || '', 1000, true),
      textInput('url', 'Purchase URL (optional)', false, p?.purchaseUrl || '', 300),
      textInput('category', 'Assets, Maps or Scripts', true, p?.category || '', 20)
    );
}

function productOptions(products) {
  return products.filter(p => p?.id && p?.name).slice(0, 25).map(p => ({
    label: clean(p.name, 100),
    description: clean(`${p.category || 'Uncategorised'} | ${p.price || 'Price not set'}`, 100),
    value: String(p.id)
  }));
}

function staffRoleId(name) {
  return data.roles?.[name] || null;
}

function hasRole(member, names) {
  return names.some(n => staffRoleId(n) && member?.roles?.cache?.has(staffRoleId(n)));
}

function canManageTickets(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    hasRole(member, ['Owner', 'Administrator', 'Moderator', 'Support'])
  );
}

function canBlacklistTickets(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    hasRole(member, ['Owner', 'Administrator', 'Moderator'])
  );
}

function giveawayModal() {
  return new ModalBuilder()
    .setCustomId('rover:giveaway:create')
    .setTitle('Configure giveaway')
    .addComponents(
      textInput('prize', 'Giveaway prize', true, '', 150),
      textInput('duration', 'Duration (30m, 2h or 1d)', true, '', 20),
      textInput('winners', 'Number of winners (1–10)', true, '', 2),
      textInput('details', 'Extra details (optional)', false, '', 500, true)
    );
}

function parseDuration(v) {
  const m = clean(v, 20).toLowerCase()
    .match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/);

  if (!m || Number(m[1]) < 1) return null;

  const ms = Number(m[1]) *
    (m[2].startsWith('m') ? 60000 :
     m[2].startsWith('h') ? 3600000 : 86400000);

  return ms <= 7 * 86400000 ? ms : null;
}

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check Rover response time'),

  new SlashCommandBuilder().setName('create-product')
    .setDescription('Create a store product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('edit-product')
    .setDescription('Edit a store product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('delete-product')
    .setDescription('Delete a store product')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('purchase')
    .setDescription('Browse available store products'),

  new SlashCommandBuilder().setName('give-product')
    .setDescription('Deliver a product to a customer')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('customer').setDescription('Customer receiving the product').setRequired(true))
    .addStringOption(o => o.setName('product').setDescription('Product ID').setRequired(true)),

  new SlashCommandBuilder().setName('information')
    .setDescription('Publish the Rover information centre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Target channel').setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  new SlashCommandBuilder().setName('ticket')
    .setDescription('Configure support tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Publish a ticket panel')
      .addChannelOption(o => o.setName('category').setDescription('Ticket category').setRequired(true)
        .addChannelTypes(ChannelType.GuildCategory))),

  new SlashCommandBuilder().setName('giveaway')
    .setDescription('Manage store giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s => s.setName('setup').setDescription('Create a giveaway'))
    .addSubcommand(s => s.setName('end').setDescription('End a giveaway')),

  new SlashCommandBuilder().setName('roles')
    .setDescription('Create Rover staff and customer roles')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('review-settings')
    .setDescription('Set the public review channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Review channel').setRequired(true)
      .addChannelTypes(ChannelType.GuildText)),

  new SlashCommandBuilder().setName('review')
    .setDescription('Leave a product review')
    .addStringOption(o => o.setName('product').setDescription('Product ID').setRequired(true))
    .addIntegerOption(o => o.setName('rating').setDescription('Rating out of five').setRequired(true).setMinValue(1).setMaxValue(5))
    .addStringOption(o => o.setName('comment').setDescription('Your review').setRequired(true).setMaxLength(800)),

  new SlashCommandBuilder().setName('announce')
    .setDescription('Publish a store announcement')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true).setMaxLength(1800)),

  new SlashCommandBuilder().setName('ban')
    .setDescription('Ban a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(500)),

  new SlashCommandBuilder().setName('kick')
    .setDescription('Kick a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(500)),

  new SlashCommandBuilder().setName('timeout')
    .setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(false).setMaxLength(500))
];

const giveawayTimers = new Map();

function scheduleGiveaway(g) {
  if (!g || g.ended) return;
  clearTimeout(giveawayTimers.get(g.id));
  giveawayTimers.set(g.id, setTimeout(
    () => finishGiveaway(g).catch(console.error),
    Math.min(Math.max(0, g.endsAt - Date.now()), 2147000000)
  ));
}

async function finishGiveaway(g) {
  if (!g || g.ended) return;

  g.ended = true;
  clearTimeout(giveawayTimers.get(g.id));
  giveawayTimers.delete(g.id);

  const pool = [...new Set(Array.isArray(g.entrants) ? g.entrants : [])];
  const winners = [];

  while (pool.length && winners.length < g.winnerCount) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }

  g.winners = winners;
  g.endedAt = Date.now();
  await saveData();

  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  const winnerText = winners.length
    ? winners.map(id => `<@${id}>`).join(', ')
    : 'No valid entries were received.';

  if (channel?.isTextBased()) {
    const oldMessage = g.messageId
      ? await channel.messages.fetch(g.messageId).catch(() => null)
      : null;

    const result = makePanel('Giveaway Results', [
      `**Prize:** ${g.prize}`,
      `**Winner${winners.length === 1 ? '' : 's'}:** ${winnerText}`,
      `**Entries:** ${(g.entrants || []).length}`
    ]);

    if (oldMessage) {
      await oldMessage.edit({
        components: [result],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: winners }
      }).catch(console.error);
    } else {
      await channel.send({
        components: [result],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: winners }
      }).catch(console.error);
    }
  }

  for (const id of winners) {
    try {
      const user = await client.users.fetch(id);
      await user.send({
        components: [makePanel('You won a Rover giveaway!', [
          `Congratulations! You won **${g.prize}**.`,
          'Contact the store team to claim your prize.'
        ])],
        flags: MessageFlags.IsComponentsV2
      });
    } catch (e) {
      console.warn(`Could not DM giveaway winner ${id}:`, e.message);
    }
  }
}

client.once('clientReady', async () => {
  console.log(`Rover is online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(c => c.toJSON())
    });

    console.log(`Registered ${commands.length} Rover slash commands.`);

    for (const g of data.giveaways) {
      if (!g.ended) scheduleGiveaway(g);
    }
  } catch (e) {
    console.error('Command registration failed:', e);
  }
});

client.on('interactionCreate', async i => {
  try {
    if (i.isChatInputCommand()) {
      switch (i.commandName) {
        case 'ping':
          return reply(i, 'Rover Status', [
            `WebSocket latency: **${client.ws.ping} ms**`,
            `Available products: **${activeProducts().length}**`,
            `Active giveaways: **${data.giveaways.filter(g => !g.ended).length}**`
          ]);

        case 'create-product':
          if (!await requireAdmin(i)) return;
          return i.showModal(productModal());

        case 'edit-product': {
          if (!await requireAdmin(i)) return;
          if (!activeProducts().length) return reply(i, 'No Products', ['Create a product first.']);

          const menu = new StringSelectMenuBuilder()
            .setCustomId('rover:product:edit:select')
            .setPlaceholder('Choose a product')
            .addOptions(productOptions(activeProducts()));

          return i.reply(payload('Edit Product', ['Select the product you want to edit.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
          ]));
        }

        case 'delete-product': {
          if (!await requireAdmin(i)) return;
          if (!activeProducts().length) return reply(i, 'No Products', ['There are no products to delete.']);

          const menu = new StringSelectMenuBuilder()
            .setCustomId('rover:product:delete:select')
            .setPlaceholder('Choose a product')
            .addOptions(productOptions(activeProducts()));

          return i.reply(payload('Delete Product', ['Choose the product to remove.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
          ]));
        }

        case 'purchase': {
          const products = activeProducts();

          if (!products.length) {
            return reply(i, 'Store Catalogue', ['There are no products listed yet. Please check back later.']);
          }

          const menu = new StringSelectMenuBuilder()
            .setCustomId('rover:product:view')
            .setPlaceholder('Choose a product')
            .addOptions(productOptions(products));

          return i.reply(payload('Rover Product Catalogue', [
            'Select a product to view its description, price and purchase link.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
          ]));
        }

        case 'give-product': {
          if (!await requireAdmin(i)) return;

          const customer = i.options.getUser('customer', true);
          const product = productById(i.options.getString('product', true));

          if (!product) return reply(i, 'Product Not Found', [
            'That product ID was not found. Use an ID from the product catalogue.'
          ]);

          const delivery = {
            id: makeId('delivery'),
            productId: product.id,
            productName: product.name,
            customerId: customer.id,
            staffId: i.user.id,
            guildId: i.guildId,
            timestamp: Date.now()
          };

          data.deliveries.push(delivery);
          await saveData();

          let dmSent = true;

          try {
            await customer.send({
              components: [makePanel('Your Rover Product Delivery', [
                `Hello ${customer.username},`,
                `Your product **${product.name}** has been delivered.`,
                `**Description:** ${product.description || 'No description provided.'}`,
                `**Price:** ${product.price || 'Not specified'}`,
                product.purchaseUrl ? `**Product link:** ${product.purchaseUrl}` : '',
                `**Delivery reference:** ${delivery.id}`,
                'If you need assistance, please open a support ticket in the server.'
              ])],
              flags: MessageFlags.IsComponentsV2
            });
          } catch {
            dmSent = false;
          }

          return reply(i, 'Product Delivery Recorded', [
            `**Customer:** ${customer}`,
            `**Product:** ${product.name}`,
            `**Reference:** ${delivery.id}`,
            dmSent ? 'A delivery message was sent by DM.' : 'The delivery was recorded, but the customer’s DMs could not be reached.'
          ]);
        }

        case 'information': {
          if (!await requireAdmin(i)) return;

          const channel = i.options.getChannel('channel', true);

          const menu = new StringSelectMenuBuilder()
            .setCustomId('rover:information:select')
            .setPlaceholder('Choose an information topic')
            .addOptions(
              { label: 'About Rover', value: 'about', description: 'About the store' },
              { label: 'Products and Purchases', value: 'products', description: 'Catalogue and purchasing' },
              { label: 'Delivery and Support', value: 'delivery', description: 'Delivery and help' },
              { label: 'Giveaways', value: 'giveaways', description: 'Giveaway information' },
              { label: 'Safety and Privacy', value: 'safety', description: 'Keep your account safe' },
              { label: 'Terms and Refunds', value: 'terms', description: 'Store terms and disputes' }
            );

          const panel = payload('Rover Information Centre', [
            'Welcome to **Rover Official Store**.',
            'Choose a topic from the menu below to learn about the store, products, delivery, giveaways, safety and store terms.'
          ], false, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
          ]);

          await channel.send(panel);
          return reply(i, 'Information Panel Published', [
            `The information centre was posted in ${channel}.`
          ]);
        }

        case 'ticket': {
          if (!await requireAdmin(i)) return;

          const category = i.options.getChannel('category', true);
          data.ticketConfig.categoryId = category.id;
          data.ticketConfig.panelChannelId = i.channelId;
          await saveData();

          const panel = payload('Rover Support', [
            'Need help with a product, purchase or delivery?',
            'Open a private support ticket below. Please explain your issue clearly and include relevant order details.',
            'Never share passwords, authentication codes or full payment-card details.'
          ], false, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rover:ticket:open')
                  .setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
              ))
          ]);

          await i.channel.send(panel);
          return reply(i, 'Ticket Panel Published', [
            `New tickets will be created under **${category.name}**.`
          ]);
        }

        case 'giveaway': {
          if (!await requireAdmin(i)) return;

          if (i.options.getSubcommand() === 'setup') {
            return i.reply(payload('Giveaway Setup', [
              'Configure the prize, duration, winner count and optional details.'
            ], true, [
              new ContainerBuilder().setAccentColor(PURPLE)
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                  new ButtonBuilder().setCustomId('rover:giveaway:open')
                    .setLabel('Configure Giveaway').setStyle(ButtonStyle.Primary)
                ))
            ]));
          }

          const active = data.giveaways.filter(g => !g.ended);

          if (!active.length) return reply(i, 'No Active Giveaways', [
            'There are no active giveaways to end.'
          ]);

          const menu = new StringSelectMenuBuilder()
            .setCustomId('rover:giveaway:end:select')
            .setPlaceholder('Choose a giveaway')
            .addOptions(active.slice(0, 25).map(g => ({
              label: clean(g.prize, 100),
              description: `${(g.entrants || []).length} entries`,
              value: g.id
            })));

          return i.reply(payload('End a Giveaway', [
            'Choose a giveaway to end and draw the winner or winners.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
          ]));
        }

        case 'roles': {
          if (!await requireAdmin(i)) return;

          const roleDefinitions = [
            ['Owner', PermissionFlagsBits.Administrator],
            ['Administrator', PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageChannels],
            ['Moderator', PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ModerateMembers],
            ['Support', 0],
            ['Customer', 0],
            ['Verified', 0],
            ['Member', 0],
            ['Muted', 0]
          ];

          const created = [];

          for (const [name, permissions] of roleDefinitions) {
            let role = i.guild.roles.cache.find(r => r.name === name);

            if (!role) {
              role = await i.guild.roles.create({
                name,
                permissions,
                reason: 'Rover role setup'
              });
            }

            data.roles[name] = role.id;
            created.push(`${name}: ${role.id}`);
          }

          data.rolesSetupCompleted = true;
          await saveData();

          return reply(i, 'Rover Roles Ready', [
            'The roles have been created or matched and their IDs saved.',
            ...created
          ]);
        }

        case 'review-settings': {
          if (!await requireAdmin(i)) return;

          const channel = i.options.getChannel('channel', true);
          data.reviewConfig.channelId = channel.id;
          await saveData();

          return reply(i, 'Review Channel Saved', [
            `Public product reviews will be posted in ${channel}.`
          ]);
        }

        case 'review': {
          const product = productById(i.options.getString('product', true));

          if (!product) return reply(i, 'Product Not Found', [
            'Check the product ID and try again.'
          ]);

          const delivered = data.deliveries.some(d =>
            d.productId === product.id && d.customerId === i.user.id
          );

          if (!delivered) return reply(i, 'Verified Purchase Required', [
            'You can only review a product recorded as delivered to your account.'
          ]);

          if (data.reviews.some(r =>
            r.productId === product.id && r.userId === i.user.id
          )) return reply(i, 'Review Already Submitted', [
            'You have already reviewed this product.'
          ]);

          const rating = i.options.getInteger('rating', true);
          const comment = i.options.getString('comment', true);

          const review = {
            id: makeId('review'),
            productId: product.id,
            productName: product.name,
            userId: i.user.id,
            rating,
            comment,
            timestamp: Date.now()
          };

          data.reviews.push(review);
          await saveData();

          const channel = data.reviewConfig.channelId
            ? await client.channels.fetch(data.reviewConfig.channelId).catch(() => null)
            : null;

          if (channel?.isTextBased()) {
            await channel.send({
              components: [makePanel('Customer Product Review', [
                `**Product:** ${product.name}`,
                `**Rating:** ${rating}/5`,
                `**Customer:** ${i.user}`,
                `**Review:** ${comment}`
              ])],
              flags: MessageFlags.IsComponentsV2
            });
          }

          return reply(i, 'Review Submitted', [
            'Thank you. Your verified-purchase review has been recorded.'
          ]);
        }

        case 'announce': {
          if (!await requireAdmin(i)) return;

          const message = i.options.getString('message', true);

          await i.channel.send({
            components: [makePanel('Rover Announcement', [message])],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
          });

          return reply(i, 'Announcement Published', [
            'Your announcement has been posted.'
          ]);
        }

        case 'ban':
        case 'kick':
        case 'timeout': {
          if (!isAdmin(i)) return reply(i, 'Permission Required', [
            'You need the appropriate server moderation permissions.'
          ]);

          const user = i.options.getUser('user', true);
          const reason = i.options.getString('reason') || 'No reason provided.';
          const member = await i.guild.members.fetch(user.id).catch(() => null);

          if (!member) return reply(i, 'Member Not Found', [
            'That user is not currently a member of this server.'
          ]);

          if (user.id === i.user.id || user.id === client.user.id) {
            return reply(i, 'Invalid Target', [
              'You cannot perform this action on yourself or Rover.'
            ]);
          }

          if (i.commandName === 'ban') {
            try {
              await user.send({
                components: [makePanel('Moderation Notice', [
                  `You were banned from **${i.guild.name}**.`,
                  `**Reason:** ${reason}`
                ])],
                flags: MessageFlags.IsComponentsV2
              });
            } catch {}

            await member.ban({ reason: `${reason} | By ${i.user.tag}` });
          } else if (i.commandName === 'kick') {
            try {
              await user.send({
                components: [makePanel('Moderation Notice', [
                  `You were kicked from **${i.guild.name}**.`,
                  `**Reason:** ${reason}`
                ])],
                flags: MessageFlags.IsComponentsV2
              });
            } catch {}

            await member.kick(`${reason} | By ${i.user.tag}`);
          } else {
            const minutes = i.options.getInteger('minutes', true);

            try {
              await user.send({
                components: [makePanel('Moderation Notice', [
                  `You have been timed out in **${i.guild.name}**.`,
                  `**Duration:** ${minutes} minutes`,
                  `**Reason:** ${reason}`
                ])],
                flags: MessageFlags.IsComponentsV2
              });
            } catch {}

            await member.timeout(minutes * 60000, `${reason} | By ${i.user.tag}`);
          }

          data.moderation.push({
            id: makeId('mod'),
            action: i.commandName,
            userId: user.id,
            moderatorId: i.user.id,
            reason,
            timestamp: Date.now(),
            guildId: i.guildId
          });

          await saveData();

          return reply(i, 'Moderation Action Complete', [
            `**Action:** ${i.commandName}`,
            `**Member:** ${user.tag}`,
            `**Reason:** ${reason}`
          ]);
        }
      }
    }

    if (i.isButton()) {
      if (i.customId === 'rover:giveaway:open') {
        return i.showModal(giveawayModal());
      }

      if (i.customId === 'rover:ticket:open') {
        if (data.ticketBlacklist.includes(i.user.id)) {
          return reply(i, 'Ticket Access Restricted', [
            'You cannot open tickets in this server. Contact a server administrator.'
          ]);
        }

        const existing = Object.values(data.tickets).find(t =>
          t.guildId === i.guildId && t.userId === i.user.id && !t.closed
        );

        if (existing) return reply(i, 'Ticket Already Open', [
          `You already have an open ticket: <#${existing.channelId}>`
        ]);

        const categoryId = data.ticketConfig.categoryId;

        if (!categoryId) return reply(i, 'Tickets Not Configured', [
          'An administrator must run `/ticket setup` first.'
        ]);

        const category = await i.guild.channels.fetch(categoryId).catch(() => null);

        if (!category) return reply(i, 'Ticket Category Missing', [
          'The configured category no longer exists. Ask an administrator to set up tickets again.'
        ]);

        const channel = await i.guild.channels.create({
          name: `ticket-${i.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
          ]
        });

        const ticket = {
          id: makeId('ticket'),
          channelId: channel.id,
          guildId: i.guildId,
          userId: i.user.id,
          claimedBy: null,
          closed: false,
          createdAt: Date.now()
        };

        data.tickets[ticket.id] = ticket;
        await saveData();

        await channel.send({
          components: [makePanel('Rover Support Ticket', [
            `Opened by ${i.user}`,
            'Please describe your issue clearly. Staff will respond when available.',
            'Do not share passwords, account tokens or verification codes.'
          ])],
          flags: MessageFlags.IsComponentsV2
        });

        return reply(i, 'Ticket Created', [
          `Your private ticket is ready: ${channel}`
        ]);
      }

      if (i.customId === 'rover:ticket:close') {
        const ticket = Object.values(data.tickets).find(t => t.channelId === i.channelId);

        if (!ticket) return reply(i, 'Ticket Not Found', [
          'This channel is not a registered Rover ticket.'
        ]);

        if (i.user.id !== ticket.userId && !canManageTickets(i.member)) {
          return reply(i, 'Permission Required', [
            'Only the ticket opener or authorised staff can close this ticket.'
          ]);
        }

        ticket.closed = true;
        ticket.closedAt = Date.now();
        await saveData();

        await reply(i, 'Ticket Closed', [
          'This ticket is now closed.'
        ]);

        await i.channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false
        }).catch(() => {});

        return;
      }

      if (i.customId === 'rover:giveaway:join') {
        const id = i.message.id;
        const g = data.giveaways.find(x => x.messageId === id && !x.ended);

        if (!g) return reply(i, 'Giveaway Ended', [
          'This giveaway is no longer accepting entries.'
        ]);

        if (!g.entrants.includes(i.user.id)) {
          g.entrants.push(i.user.id);
          await saveData();
          return reply(i, 'Entry Confirmed', [
            `You have entered the giveaway for **${g.prize}**.`
          ]);
        }

        return reply(i, 'Already Entered', [
          'You are already entered in this giveaway.'
        ]);
      }
    }

    if (i.isStringSelectMenu()) {
      const selected = i.values[0];

      if (i.customId === 'rover:product:view') {
        const product = productById(selected);

        if (!product) return reply(i, 'Product Not Found', [
          'This product is no longer available.'
        ]);

        return reply(i, product.name, [
          product.description || 'No description provided.',
          `**Price:** ${product.price || 'Not specified'}`,
          `**Category:** ${product.category || 'Uncategorised'}`,
          product.purchaseUrl ? `[Purchase product](${product.purchaseUrl})` : 'No purchase link has been added yet.'
        ]);
      }

      if (i.customId === 'rover:product:edit:select') {
        const product = productById(selected);

        if (!product) return reply(i, 'Product Not Found', [
          'That product no longer exists.'
        ]);

        return i.showModal(productModal(product));
      }

      if (i.customId === 'rover:product:delete:select') {
        if (!await requireAdmin(i)) return;

        const product = productById(selected);

        if (!product) return reply(i, 'Product Not Found', [
          'That product no longer exists.'
        ]);

        data.products = data.products.filter(p => p.id !== selected);
        await saveData();

        return reply(i, 'Product Deleted', [
          `**${product.name}** has been removed from the catalogue.`
        ]);
      }

      if (i.customId === 'rover:information:select') {
        const topics = {
          about: ['About Rover', 'Rover Official Store provides a catalogue of products with descriptions, prices and available purchase links.'],
          products: ['Products and Purchases', 'Browse products using `/purchase`. Read the full description and check the price before buying. Only use purchase links provided by the store.'],
          delivery: ['Delivery and Support', 'When staff record a delivery, Rover attempts to DM the customer with the product details. If the DM fails, contact support through a ticket.'],
          giveaways: ['Giveaways', 'Use the entry button on an active giveaway post. Winners are selected randomly from valid entries. Never pay someone to claim a giveaway prize.'],
          safety: ['Safety and Privacy', 'Never share passwords, authentication codes, account tokens or full payment-card details. Staff should not need your password to help you.'],
          terms: ['Terms and Refunds', 'Check the product description and terms before purchasing. For delivery issues or a dispute, open a ticket and provide your order details. Refunds are reviewed by the store team.']
        };

        const [title, text] = topics[selected] || topics.about;
        return reply(i, title, [text]);
      }

      if (i.customId === 'rover:giveaway:end:select') {
        if (!await requireAdmin(i)) return;

        const giveaway = data.giveaways.find(g => g.id === selected && !g.ended);

        if (!giveaway) return reply(i, 'Giveaway Not Found', [
          'That giveaway has already ended or no longer exists.'
        ]);

        await finishGiveaway(giveaway);
        return reply(i, 'Giveaway Ended', [
          `The giveaway for **${giveaway.prize}** has ended.`
        ]);
      }
    }

    if (i.isModalSubmit()) {
      if (i.customId === 'rover:product:create' || i.customId.startsWith('rover:product:edit:')) {
        if (!await requireAdmin(i)) return;

        const name = i.fields.getTextInputValue('name').trim();
        const price = i.fields.getTextInputValue('price').trim();
        const description = i.fields.getTextInputValue('description').trim();
        const purchaseUrl = i.fields.getTextInputValue('url').trim();
        const category = i.fields.getTextInputValue('category').trim();

        if (purchaseUrl) {
          try {
            if (!['http:', 'https:'].includes(new URL(purchaseUrl).protocol)) throw new Error();
          } catch {
            return reply(i, 'Invalid Purchase Link', [
              'Use a complete link beginning with `https://` or `http://`.'
            ]);
          }
        }

        if (i.customId === 'rover:product:create') {
          data.products.push({
            id: makeId('product'),
            name, price, description, purchaseUrl, category,
            active: true,
            createdBy: i.user.id,
            createdAt: Date.now()
          });
        } else {
          const id = i.customId.slice('rover:product:edit:'.length);
          const product = productById(id);

          if (!product) return reply(i, 'Product Not Found', [
            'The product you were editing no longer exists.'
          ]);

          Object.assign(product, { name, price, description, purchaseUrl, category, updatedAt: Date.now() });
        }

        await saveData();
        return reply(i, 'Product Saved', [
          `**Name:** ${name}`,
          `**Price:** ${price}`,
          `**Category:** ${category}`
        ]);
      }

      if (i.customId === 'rover:giveaway:create') {
        if (!await requireAdmin(i)) return;

        const prize = i.fields.getTextInputValue('prize').trim();
        const duration = parseDuration(i.fields.getTextInputValue('duration'));
        const winnerCount = Number(i.fields.getTextInputValue('winners'));
        const details = i.fields.getTextInputValue('details').trim();

        if (!duration) return reply(i, 'Invalid Duration', [
          'Use a duration such as `30m`, `2h` or `1d`. Maximum duration is seven days.'
        ]);

        if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 10) {
          return reply(i, 'Invalid Winner Count', [
            'Choose between one and ten winners.'
          ]);
        }

        const giveaway = {
          id: makeId('giveaway'),
          prize,
          details,
          winnerCount,
          endsAt: Date.now() + duration,
          entrants: [],
          ended: false,
          guildId: i.guildId,
          channelId: i.channelId,
          messageId: null,
          createdBy: i.user.id
        };

        const joinButton = new ButtonBuilder()
          .setCustomId('rover:giveaway:join')
          .setLabel('Enter Giveaway')
          .setStyle(ButtonStyle.Primary);

        const post = await i.channel.send({
          components: [
            makePanel('Rover Giveaway', [
              `**Prize:** ${prize}`,
              details,
              `**Winners:** ${winnerCount}`,
              `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
              '**Entries:** 0'
            ]),
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(joinButton))
          ],
          flags: MessageFlags.IsComponentsV2
        });

        giveaway.messageId = post.id;
        data.giveaways.push(giveaway);
        await saveData();
        scheduleGiveaway(giveaway);

        return reply(i, 'Giveaway Published', [
          `The giveaway for **${prize}** is now live in ${i.channel}.`
        ]);
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    const message = 'An unexpected error occurred. Check the bot console for details.';

    try {
      if (i.deferred || i.replied) {
        await i.followUp({
          components: [makePanel('Error', [message])],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
      } else {
        await reply(i, 'Error', [message]);
      }
    } catch {}
  }
});

client.login(TOKEN);
