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
  reviews: []
});

function loadData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults(), null, 2));
  }

  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const base = defaults();

    return {
      ...base,
      ...d,
      products: Array.isArray(d.products) ? d.products : [],
      giveaways: Array.isArray(d.giveaways) ? d.giveaways : [],
      deliveries: Array.isArray(d.deliveries) ? d.deliveries : [],
      moderation: Array.isArray(d.moderation) ? d.moderation : [],
      roles: d.roles && typeof d.roles === 'object' ? d.roles : {},
      rolesSetupCompleted: Boolean(d.rolesSetupCompleted),
      ticketConfig: { ...base.ticketConfig, ...(d.ticketConfig || {}) },
      tickets: d.tickets && typeof d.tickets === 'object' ? d.tickets : {},
      ticketBlacklist: Array.isArray(d.ticketBlacklist) ? d.ticketBlacklist : [],
      reviewConfig: { ...base.reviewConfig, ...(d.reviewConfig || {}) },
      reviews: Array.isArray(d.reviews) ? d.reviews : []
    };
  } catch (error) {
    console.error('Could not read bot-data.json:', error);
    console.error('Your existing data file has not been overwritten.');
    return defaults();
  }
}

let data = loadData();
let saveQueue = Promise.resolve();

function saveData() {
  saveQueue = saveQueue.catch(() => {}).then(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
    fs.renameSync(tempFile, DATA_FILE);
  });

  return saveQueue;
}

const makeId = prefix =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

const clean = (value, max = 1000) =>
  String(value ?? '').trim().slice(0, max);

const activeProducts = () => data.products.filter(p =>
  p && typeof p === 'object' &&
  p.active !== false &&
  typeof p.id === 'string' &&
  typeof p.name === 'string' &&
  p.name.trim()
);

const productById = id =>
  data.products.find(p => p && p.id === id);

const isAdmin = interaction => Boolean(
  interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
  interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
);

function makePanel(title, sections = []) {
  const container = new ContainerBuilder().setAccentColor(PURPLE);

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
    flags: MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] }
  };
}

async function reply(interaction, title, sections = [], ephemeral = true, extra = []) {
  const response = panelPayload(title, sections, ephemeral, extra);

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(response);
  }

  return interaction.reply(response);
}

async function requireAdmin(interaction) {
  if (isAdmin(interaction)) return true;

  await reply(interaction, 'Permission Required', [
    'You need **Manage Server** or **Administrator** to use this command.'
  ]);

  return false;
}

function textInput(
  id,
  label,
  required = true,
  value = '',
  max = 1000,
  paragraph = false
) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(max);

  if (value) input.setValue(String(value).slice(0, max));

  return new ActionRowBuilder().addComponents(input);
}

function staffRoleId(name) {
  return data.roles?.[name] || null;
}

function hasRole(member, names) {
  return names.some(name => {
    const roleId = staffRoleId(name);
    return roleId && member?.roles?.cache?.has(roleId);
  });
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
    member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    hasRole(member, ['Owner', 'Administrator', 'Moderator'])
  );
}

function productOptions(products) {
  return products.slice(0, 25).map(product => ({
    label: clean(product.name, 100),
    description: clean(
      `${product.category || 'Uncategorised'} | ${product.price || 'Price not set'}`,
      100
    ),
    value: String(product.id)
  }));
}

function productModal(product = null) {
  return new ModalBuilder()
    .setCustomId(product ? `rover:product:edit:${product.id}` : 'rover:product:create')
    .setTitle(product ? 'Edit Store Product' : 'Create Store Product')
    .addComponents(
      textInput('name', 'Product name', true, product?.name || '', 100),
      textInput('price', 'Price', true, product?.price || '', 80),
      textInput('description', 'Full product description', true, product?.description || '', 1000, true),
      textInput('url', 'Purchase URL (optional)', false, product?.purchaseUrl || '', 300),
      textInput('category', 'Assets, Maps or Scripts', true, product?.category || '', 20)
    );
}

function giveawayModal() {
  return new ModalBuilder()
    .setCustomId('rover:giveaway:create')
    .setTitle('Create a Giveaway')
    .addComponents(
      textInput('prize', 'Giveaway prize', true, '', 150),
      textInput('duration', 'Duration: 30m, 2h or 1d', true, '', 20),
      textInput('winners', 'Number of winners (1–10)', true, '1', 2),
      textInput('details', 'Rules and extra information', false, '', 700, true)
    );
}

function reviewModal(productId) {
  return new ModalBuilder()
    .setCustomId(`rover:review:submit:${productId}`)
    .setTitle('Submit Product Review')
    .addComponents(
      textInput('rating', 'Rating from 1 to 5', true, '5', 1),
      textInput('comment', 'Your detailed review', true, '', 800, true)
    );
}

function announceModal() {
  return new ModalBuilder()
    .setCustomId('rover:announce:modal')
    .setTitle('Create Announcement')
    .addComponents(
      textInput('message', 'Announcement message', true, '', 1800, true),
      textInput('username', 'Webhook display name', false, 'Rover Official Store', 80),
      textInput('avatar', 'Webhook avatar URL (optional)', false, '', 300)
    );
}

function parseDuration(value) {
  const match = clean(value, 20).toLowerCase()
    .match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/);

  if (!match || Number(match[1]) < 1) return null;

  const multiplier = match[2].startsWith('m')
    ? 60000
    : match[2].startsWith('h')
      ? 3600000
      : 86400000;

  const duration = Number(match[1]) * multiplier;

  return duration <= 7 * 86400000 ? duration : null;
}

function ticketForChannel(channelId) {
  return Object.values(data.tickets).find(ticket =>
    ticket.channelId === channelId && !ticket.closed
  );
}

function ticketButtons(ticket) {
  const claimLabel = ticket.claimedBy
    ? 'Claimed'
    : 'Claim Ticket';

  return new ContainerBuilder()
    .setAccentColor(PURPLE)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rover:ticket:claim')
          .setLabel(claimLabel)
          .setStyle(ButtonStyle.Primary)
          .setDisabled(Boolean(ticket.claimedBy)),

        new ButtonBuilder()
          .setCustomId('rover:ticket:modpanel')
          .setLabel('Staff Panel')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('rover:ticket:close')
          .setLabel('Close Ticket')
          .setStyle(ButtonStyle.Danger)
      )
    );
}

function ticketStaffButtons() {
  return new ContainerBuilder()
    .setAccentColor(PURPLE)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rover:ticket:escalate')
          .setLabel('Escalate')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('rover:ticket:rename')
          .setLabel('Rename')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('rover:ticket:addmember')
          .setLabel('Add Member')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId('rover:ticket:blacklist')
          .setLabel('Blacklist Opener')
          .setStyle(ButtonStyle.Danger)
      )
    );
}

function informationMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId('rover:information:select')
    .setPlaceholder('Select an information category')
    .addOptions(
      { label: 'About Rover', value: 'about', description: 'Who we are and how the store works' },
      { label: 'Products and Purchasing', value: 'products', description: 'Product types, prices and purchases' },
      { label: 'Delivery and Order Support', value: 'delivery', description: 'Delivery process and order issues' },
      { label: 'Giveaways and Winners', value: 'giveaways', description: 'Entering giveaways and claiming prizes' },
      { label: 'Account Safety and Privacy', value: 'safety', description: 'Protecting your account and information' },
      { label: 'Terms, Refunds and Disputes', value: 'terms', description: 'Store expectations and disputes' }
    );
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check Rover response time'),

  new SlashCommandBuilder()
    .setName('create-product')
    .setDescription('Open the product creation panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('edit-product')
    .setDescription('Open the product editing panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('delete-product')
    .setDescription('Open the product removal panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('purchase')
    .setDescription('Browse products in the Rover store'),

  new SlashCommandBuilder()
    .setName('give-product')
    .setDescription('Open the product delivery panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('information')
    .setDescription('Publish the detailed Rover information centre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for the information centre')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure the Rover support ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('setup')
        .setDescription('Create or update the ticket panel')
        .addChannelOption(option =>
          option.setName('category')
            .setDescription('Category where new tickets will be created')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildCategory)
        )
    ),

  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create or manage store giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('setup').setDescription('Open the giveaway creation panel')
    )
    .addSubcommand(sub =>
      sub.setName('end').setDescription('End an active giveaway')
    ),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Create or update Rover roles; use /ban to ban members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('review-settings')
    .setDescription('Set the channel where customer reviews appear')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Public product review channel')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText)
    ),

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Open the customer product review panel'),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Open the announcement panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Where to publish the announcement')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Choose a normal message or a webhook message')
        .setRequired(true)
        .addChoices(
          { name: 'Normal message', value: 'normal' },
          { name: 'Webhook message', value: 'webhook' }
        )
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to ban').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for the ban').setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to kick').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for the kick').setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('user').setDescription('Member to timeout').setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('minutes').setDescription('Timeout length in minutes')
        .setRequired(true).setMinValue(1).setMaxValue(40320)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason for the timeout').setMaxLength(500)
    )
];

const giveawayTimers = new Map();

function scheduleGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  clearTimeout(giveawayTimers.get(giveaway.id));

  const delay = Math.max(0, giveaway.endsAt - Date.now());

  giveawayTimers.set(giveaway.id, setTimeout(() => {
    finishGiveaway(giveaway).catch(console.error);
  }, Math.min(delay, 2147000000)));
}

async function updateGiveawayMessage(giveaway, ended = false) {
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = giveaway.messageId
    ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
    : null;

  if (!message) return;

  const winnerText = ended
    ? (giveaway.winners?.length
      ? giveaway.winners.map(id => `<@${id}>`).join(', ')
      : 'No eligible entries.')
    : 'Not selected yet';

  const sections = [
    `**Prize:** ${giveaway.prize}`,
    giveaway.details ? `**Details:**\n${giveaway.details}` : '',
    `**Entries:** ${(giveaway.entrants || []).length}`,
    `**Winner:** ${winnerText}`,
    ended
      ? `**Status:** Ended <t:${Math.floor((giveaway.endedAt || Date.now()) / 1000)}:R>`
      : `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
    `**Winners to draw:** ${giveaway.winnerCount}`
  ];

  const components = [
    makePanel(ended ? 'Rover Giveaway — Ended' : 'Rover Giveaway', sections)
  ];

  if (!ended) {
    components.push(
      new ContainerBuilder()
        .setAccentColor(PURPLE)
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('rover:giveaway:join')
              .setLabel('Enter Giveaway')
              .setStyle(ButtonStyle.Primary)
          )
        )
    );
  }

  await message.edit({
    components,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  }).catch(console.error);
}

async function finishGiveaway(giveaway) {
  if (!giveaway || giveaway.ended) return;

  giveaway.ended = true;
  giveaway.endedAt = Date.now();

  clearTimeout(giveawayTimers.get(giveaway.id));
  giveawayTimers.delete(giveaway.id);

  const eligible = [...new Set(giveaway.entrants || [])];
  const winners = [];

  while (eligible.length && winners.length < giveaway.winnerCount) {
    const index = Math.floor(Math.random() * eligible.length);
    winners.push(eligible.splice(index, 1)[0]);
  }

  giveaway.winners = winners;
  await saveData();
  await updateGiveawayMessage(giveaway, true);

  for (const userId of winners) {
    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) continue;

    await user.send({
      components: [
        makePanel('You Won a Rover Giveaway', [
          `Congratulations! You won **${giveaway.prize}**.`,
          'Please contact the Rover team to arrange collection of your prize.',
          'Never share your password or account verification codes.'
        ])
      ],
      flags: MessageFlags.IsComponentsV2
    }).catch(() => {});
  }
}

client.once('clientReady', async () => {
  console.log(`Rover is online as ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(command => command.toJSON())
    });

    console.log(`Registered ${commands.length} Rover slash commands.`);

    for (const giveaway of data.giveaways) {
      if (!giveaway.ended) scheduleGiveaway(giveaway);
    }
  } catch (error) {
    console.error('Slash command registration failed:', error);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'ping':
          return reply(interaction, 'Rover System Status', [
            `**Bot:** Online`,
            `**Latency:** ${client.ws.ping} ms`,
            `**Products:** ${activeProducts().length}`,
            `**Active giveaways:** ${data.giveaways.filter(g => !g.ended).length}`,
            `**Open tickets:** ${Object.values(data.tickets).filter(t => !t.closed).length}`
          ]);

        case 'create-product': {
          if (!await requireAdmin(interaction)) return;

          return reply(interaction, 'Create a Store Product', [
            'Use the button below to open the product builder.',
            '',
            '**Product details**',
            'Enter the product name, price, full description, category and optional purchase URL.',
            '',
            '**Categories**',
            'Assets, Maps and Scripts.',
            '',
            'Your product will be saved in Rover’s product catalogue and can then be selected through `/purchase`.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('rover:product:create:open')
                  .setLabel('Create Product')
                  .setStyle(ButtonStyle.Primary)
              ))
          ]);
        }

        case 'edit-product': {
          if (!await requireAdmin(interaction)) return;

          const products = activeProducts();
          if (!products.length) {
            return reply(interaction, 'No Products Found', [
              'Create a product before opening the editing panel.'
            ]);
          }

          return reply(interaction, 'Edit a Store Product', [
            'Select the product you want to update.',
            'You can change its name, price, description, purchase link and category.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('rover:product:edit:select')
                  .setPlaceholder('Choose a product')
                  .addOptions(productOptions(products))
              ))
          ]);
        }

        case 'delete-product': {
          if (!await requireAdmin(interaction)) return;

          const products = activeProducts();
          if (!products.length) {
            return reply(interaction, 'No Products Found', [
              'There are no products in the catalogue to remove.'
            ]);
          }

          return reply(interaction, 'Remove a Store Product', [
            'Select the product to delete.',
            'This removes it from the active catalogue. Previously recorded delivery and review history is retained.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('rover:product:delete:select')
                  .setPlaceholder('Choose a product')
                  .addOptions(productOptions(products))
              ))
          ]);
        }

        case 'purchase': {
          const products = activeProducts();

          if (!products.length) {
            return reply(interaction, 'Rover Product Catalogue', [
              'There are currently no products available.',
              'Please check back later or contact the store team.'
            ]);
          }

          return reply(interaction, 'Rover Product Catalogue', [
            'Welcome to the Rover Official Store.',
            'Choose a product below to see its full description, category, price and purchase link.',
            '',
            `**Available products:** ${products.length}`
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('rover:product:view')
                  .setPlaceholder('Select a product')
                  .addOptions(productOptions(products))
              ))
          ]);
        }

        case 'give-product': {
          if (!await requireAdmin(interaction)) return;

          const products = activeProducts();

          if (!products.length) {
            return reply(interaction, 'No Products Available', [
              'Create a product before delivering it to a customer.'
            ]);
          }

          return reply(interaction, 'Product Delivery Centre', [
            'Use this panel to select a product and a customer.',
            '',
            '**What happens next?**',
            '1. Select the product.',
            '2. Select the customer.',
            '3. Confirm the delivery.',
            '4. Rover records the delivery and attempts to DM the customer with the product details.',
            '',
            'Recorded deliveries can be used to verify customer product reviews.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('rover:delivery:product')
                  .setPlaceholder('Step 1 — Select product')
                  .addOptions(productOptions(products))
              ))
          ]);
        }

        case 'information': {
          if (!await requireAdmin(interaction)) return;

          const channel = interaction.options.getChannel('channel', true);

          const panel = panelPayload('Rover Official Store | Information Centre', [
            'Welcome to **Rover Official Store**.',
            'This information centre explains how the store works, how to browse products, what to expect from delivery, how giveaways operate and how to get help.',
            '',
            '**Please read the relevant section before purchasing or opening a support ticket.**',
            'Choose a topic below to view the full information.'
          ], false, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(informationMenu()))
          ]);

          await channel.send(panel);

          return reply(interaction, 'Information Centre Published', [
            `The information centre has been published in ${channel}.`
          ]);
        }

        case 'ticket': {
          if (!await requireAdmin(interaction)) return;

          const category = interaction.options.getChannel('category', true);

          data.ticketConfig.categoryId = category.id;
          data.ticketConfig.panelChannelId = interaction.channelId;
          await saveData();

          await interaction.channel.send(
            panelPayload('Rover Customer Support', [
              'Welcome to Rover Support.',
              '',
              '**When should I open a ticket?**',
              'Open a ticket for product questions, order or delivery problems, purchase assistance, account-related store enquiries or other matters that require staff support.',
              '',
              '**Before opening a ticket**',
              'Explain your issue clearly and provide any relevant order reference. Please do not share passwords, authentication codes, tokens or full payment-card details.',
              '',
              'A private channel will be created for you and authorised staff. Please be patient while your request is reviewed.'
            ], false, [
              new ContainerBuilder().setAccentColor(PURPLE)
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId('rover:ticket:open')
                    .setLabel('Open Support Ticket')
                    .setStyle(ButtonStyle.Primary)
                ))
            ])
          );

          return reply(interaction, 'Ticket System Configured', [
            `Ticket category: **${category.name}**`,
            'The support panel has been published.',
            'Run `/ticket setup` again whenever you need to change the category or publish another panel.'
          ]);
        }

        case 'giveaway': {
          if (!await requireAdmin(interaction)) return;

          if (interaction.options.getSubcommand() === 'setup') {
            return reply(interaction, 'Giveaway Management', [
              'Create a giveaway with a prize, duration, number of winners and additional rules.',
              '',
              '**Entry tracking**',
              'When a member enters, the entry count increases. The entry count is separate from the winner field.',
              '',
              '**Automatic ending**',
              'When the giveaway ends, the original post remains in the channel. Its winner field is updated with the randomly selected winner or winners.'
            ], true, [
              new ContainerBuilder().setAccentColor(PURPLE)
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId('rover:giveaway:open')
                    .setLabel('Configure Giveaway')
                    .setStyle(ButtonStyle.Primary)
                ))
            ]);
          }

          const active = data.giveaways.filter(g => !g.ended);

          if (!active.length) {
            return reply(interaction, 'No Active Giveaways', [
              'There are no active giveaways to end.'
            ]);
          }

          return reply(interaction, 'End a Giveaway', [
            'Select the giveaway you want to end.',
            'Rover will randomly select winners from the recorded entries and update the original giveaway post.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('rover:giveaway:end:select')
                  .setPlaceholder('Choose a giveaway')
                  .addOptions(active.slice(0, 25).map(g => ({
                    label: clean(g.prize, 100),
                    description: `${(g.entrants || []).length} entries`,
                    value: g.id
                  })))
              ))
          ]);
        }

        case 'roles': {
          if (!await requireAdmin(interaction)) return;

          const definitions = [
            { name: 'Owner', permissions: [PermissionFlagsBits.Administrator] },
            { name: 'Administrator', permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageChannels] },
            { name: 'Moderator', permissions: [PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers] },
            { name: 'Support', permissions: [] },
            { name: 'Customer', permissions: [] },
            { name: 'Verified', permissions: [] },
            { name: 'Member', permissions: [] },
            { name: 'Muted', permissions: [] }
          ];

          const results = [];

          for (const definition of definitions) {
            let role = interaction.guild.roles.cache.find(r => r.name === definition.name);

            if (!role) {
              role = await interaction.guild.roles.create({
                name: definition.name,
                permissions: definition.permissions,
                reason: 'Rover role setup'
              });

              results.push(`Created **${role.name}**.`);
            } else {
              await role.setPermissions(definition.permissions, 'Rover role setup refresh')
                .catch(() => {});

              results.push(`Updated existing **${role.name}**.`);
            }

            data.roles[definition.name] = role.id;
          }

          data.rolesSetupCompleted = true;
          await saveData();

          return reply(interaction, 'Rover Roles Setup', [
            'The role setup has completed successfully.',
            '',
            ...results,
            '',
            '**Safe to run again:** `/roles` reuses existing roles with matching names instead of creating duplicates.',
            '',
            '**Moderation:** Use `/ban` to ban a member. The Owner role grants administrator permissions, so only give it to trusted people.'
          ]);
        }

        case 'review-settings': {
          if (!await requireAdmin(interaction)) return;

          const channel = interaction.options.getChannel('channel', true);

          data.reviewConfig.channelId = channel.id;
          await saveData();

          return reply(interaction, 'Review Channel Configured', [
            `Customer reviews will be published in ${channel}.`,
            'Reviews submitted through the review panel will be recorded against the selected product.'
          ]);
        }

        case 'review': {
          const products = activeProducts();

          if (!products.length) {
            return reply(interaction, 'Customer Reviews', [
              'There are no active products to review at the moment.'
            ]);
          }

          return reply(interaction, 'Rover Customer Reviews', [
            'Share your experience with a Rover product.',
            '',
            '**Who can review?**',
            'Reviews are restricted to customers with a recorded delivery for the selected product.',
            '',
            '**How it works**',
            '1. Select your product.',
            '2. Enter a rating from 1 to 5.',
            '3. Write a helpful, honest review.',
            '',
            'Only one review per customer per product is accepted.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId('rover:review:product')
                  .setPlaceholder('Select a product to review')
                  .addOptions(productOptions(products))
              ))
          ]);
        }

        case 'announce': {
          if (!await requireAdmin(interaction)) return;

          const channel = interaction.options.getChannel('channel', true);
          const type = interaction.options.getString('type', true);

          return reply(interaction, 'Announcement Composer', [
            `**Destination:** ${channel}`,
            `**Message type:** ${type === 'webhook' ? 'Webhook message' : 'Normal message'}`,
            '',
            type === 'webhook'
              ? 'A webhook message uses a custom display name and optional avatar. Clicking its profile will not open the Rover bot profile.'
              : 'A normal message is sent by Rover using its regular bot identity.',
            '',
            'Press the button to compose your announcement.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`rover:announce:open:${channel.id}:${type}`)
                  .setLabel('Compose Announcement')
                  .setStyle(ButtonStyle.Primary)
              ))
          ]);
        }

        case 'ban':
        case 'kick':
        case 'timeout': {
          const user = interaction.options.getUser('user', true);
          const reason = interaction.options.getString('reason') || 'No reason provided.';
          const member = await interaction.guild.members.fetch(user.id).catch(() => null);

          if (!member) {
            return reply(interaction, 'Member Not Found', [
              'The selected user is not currently a member of this server.'
            ]);
          }

          if (user.id === interaction.user.id || user.id === client.user.id) {
            return reply(interaction, 'Invalid Target', [
              'You cannot perform this action on yourself or Rover.'
            ]);
          }

          if (interaction.commandName === 'ban' && !interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
            return reply(interaction, 'Permission Required', ['You need the **Ban Members** permission.']);
          }

          if (interaction.commandName === 'kick' && !interaction.memberPermissions.has(PermissionFlagsBits.KickMembers)) {
            return reply(interaction, 'Permission Required', ['You need the **Kick Members** permission.']);
          }

          if (interaction.commandName === 'timeout' && !interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
            return reply(interaction, 'Permission Required', ['You need the **Moderate Members** permission.']);
          }

          if (interaction.commandName === 'ban') {
            await user.send(panelPayload('Server Moderation Notice', [
              `You were banned from **${interaction.guild.name}**.`,
              `**Reason:** ${reason}`
            ])).catch(() => {});

            await member.ban({ reason: `${reason} | By ${interaction.user.tag}` });
          } else if (interaction.commandName === 'kick') {
            await user.send(panelPayload('Server Moderation Notice', [
              `You were kicked from **${interaction.guild.name}**.`,
              `**Reason:** ${reason}`
            ])).catch(() => {});

            await member.kick(`${reason} | By ${interaction.user.tag}`);
          } else {
            const minutes = interaction.options.getInteger('minutes', true);

            await user.send(panelPayload('Server Moderation Notice', [
              `You were timed out in **${interaction.guild.name}**.`,
              `**Duration:** ${minutes} minutes`,
              `**Reason:** ${reason}`
            ])).catch(() => {});

            await member.timeout(minutes * 60000, `${reason} | By ${interaction.user.tag}`);
          }

          data.moderation.push({
            id: makeId('moderation'),
            action: interaction.commandName,
            userId: user.id,
            moderatorId: interaction.user.id,
            guildId: interaction.guildId,
            reason,
            timestamp: Date.now()
          });

          await saveData();

          return reply(interaction, 'Moderation Action Completed', [
            `**Action:** ${interaction.commandName}`,
            `**Member:** ${user.tag}`,
            `**Reason:** ${reason}`
          ]);
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'rover:product:create:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(productModal());
      }

      if (interaction.customId === 'rover:giveaway:open') {
        if (!await requireAdmin(interaction)) return;
        return interaction.showModal(giveawayModal());
      }

      if (interaction.customId.startsWith('rover:announce:open:')) {
        if (!await requireAdmin(interaction)) return;

        const [, , , channelId, type] = interaction.customId.split(':');

        const modal = announceModal();
        modal.setCustomId(`rover:announce:modal:${channelId}:${type}`);

        return interaction.showModal(modal);
      }

      if (interaction.customId === 'rover:ticket:open') {
        if (data.ticketBlacklist.includes(interaction.user.id)) {
          return reply(interaction, 'Ticket Access Restricted', [
            'You cannot open a support ticket at the moment. Please contact a server administrator.'
          ]);
        }

        const existing = Object.values(data.tickets).find(ticket =>
          ticket.guildId === interaction.guildId &&
          ticket.userId === interaction.user.id &&
          !ticket.closed
        );

        if (existing) {
          return reply(interaction, 'Ticket Already Open', [
            `You already have an open ticket: <#${existing.channelId}>`
          ]);
        }

        const categoryId = data.ticketConfig.categoryId;

        if (!categoryId) {
          return reply(interaction, 'Ticket System Not Configured', [
            'An administrator needs to run `/ticket setup` before tickets can be opened.'
          ]);
        }

        const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);

        if (!category || category.type !== ChannelType.GuildCategory) {
          return reply(interaction, 'Ticket Category Missing', [
            'The configured ticket category is missing. Ask an administrator to run `/ticket setup` again.'
          ]);
        }

        const permissionOverwrites = [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ReadMessageHistory
            ]
          }
        ];

        for (const roleName of ['Owner', 'Administrator', 'Moderator', 'Support']) {
          const roleId = staffRoleId(roleName);
          if (!roleId) continue;

          permissionOverwrites.push({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory
            ]
          });
        }

        const channel = await interaction.guild.channels.create({
          name: `ticket-${interaction.user.username}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .slice(0, 90),
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites,
          reason: `Support ticket opened by ${interaction.user.tag}`
        });

        const ticket = {
          id: makeId('ticket'),
          channelId: channel.id,
          guildId: interaction.guildId,
          userId: interaction.user.id,
          claimedBy: null,
          closed: false,
          escalated: false,
          createdAt: Date.now()
        };

        data.tickets[ticket.id] = ticket;
        await saveData();

        await channel.send({
          components: [
            makePanel('Rover Support Ticket', [
              `**Opened by:** ${interaction.user}`,
              `**Ticket reference:** ${ticket.id}`,
              '',
              'Welcome to Rover Support. Please explain the reason for your ticket and provide any relevant order or delivery reference.',
              '',
              '**What happens next?**',
              'An authorised staff member will review your request and respond when available.',
              '',
              '**Privacy and security**',
              'Do not send passwords, authentication codes, account tokens or full payment-card details.',
              '',
              'Use the controls below to claim the ticket, open staff tools or close the ticket when your issue has been resolved.'
            ]),
            ticketButtons(ticket)
          ],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] }
        });

        return reply(interaction, 'Support Ticket Created', [
          `Your private ticket is ready: ${channel}`,
          'Please continue your conversation inside the ticket channel.'
        ]);
      }

      if (interaction.customId === 'rover:ticket:claim') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket) {
          return reply(interaction, 'Ticket Not Found', [
            'This channel is not an active Rover ticket.'
          ]);
        }

        if (!canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised support staff can claim tickets.'
          ]);
        }

        if (ticket.claimedBy) {
          return reply(interaction, 'Already Claimed', [
            `This ticket has already been claimed by <@${ticket.claimedBy}>.`
          ]);
        }

        ticket.claimedBy = interaction.user.id;
        ticket.claimedAt = Date.now();
        await saveData();

        await interaction.message.edit({
          components: [
            makePanel('Rover Support Ticket', [
              `**Opened by:** <@${ticket.userId}>`,
              `**Claimed by:** ${interaction.user}`,
              `**Ticket reference:** ${ticket.id}`,
              '',
              'A staff member is now handling this ticket. Please keep all relevant information in this channel.'
            ]),
            ticketButtons(ticket)
          ],
          flags: MessageFlags.IsComponentsV2
        });

        return reply(interaction, 'Ticket Claimed', [
          'You are now responsible for handling this ticket.'
        ]);
      }

      if (interaction.customId === 'rover:ticket:close') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket) {
          return reply(interaction, 'Ticket Not Found', [
            'This channel is not an active Rover ticket.'
          ]);
        }

        if (interaction.user.id !== ticket.userId && !canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only the ticket opener or authorised staff can close this ticket.'
          ]);
        }

        ticket.closed = true;
        ticket.closedAt = Date.now();
        ticket.closedBy = interaction.user.id;
        await saveData();

        await interaction.channel.permissionOverwrites.edit(ticket.userId, {
          SendMessages: false
        }).catch(() => {});

        await interaction.channel.send({
          components: [
            makePanel('Ticket Closed', [
              `This ticket was closed by ${interaction.user}.`,
              'The channel will remain available for authorised staff to review.'
            ])
          ],
          flags: MessageFlags.IsComponentsV2
        });

        return reply(interaction, 'Ticket Closed', [
          'The ticket has been marked as closed.'
        ]);
      }

      if (interaction.customId === 'rover:ticket:modpanel') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket) {
          return reply(interaction, 'Ticket Not Found', [
            'This channel is not an active Rover ticket.'
          ]);
        }

        if (!canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised staff can use the ticket staff panel.'
          ]);
        }

        return reply(interaction, 'Ticket Staff Panel', [
          `**Ticket opener:** <@${ticket.userId}>`,
          `**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody yet'}`,
          `**Escalated:** ${ticket.escalated ? 'Yes' : 'No'}`,
          '',
          'Choose a staff action below.',
          '',
          '**Escalate:** Give the configured escalation role access to the ticket.',
          '**Rename:** Change the ticket channel name.',
          '**Add Member:** Grant a selected member access.',
          '**Blacklist Opener:** Prevent the ticket opener from opening future tickets.'
        ], true, [ticketStaffButtons()]);
      }

      if (interaction.customId === 'rover:ticket:escalate') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket || !canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised staff can escalate a ticket.'
          ]);
        }

        const escalationRoleId = process.env.TICKET_ESCALATION_ROLE_ID;

        if (!escalationRoleId) {
          return reply(interaction, 'Escalation Role Not Configured', [
            'Add `TICKET_ESCALATION_ROLE_ID` to your environment variables and restart Rover.'
          ]);
        }

        await interaction.channel.permissionOverwrites.edit(escalationRoleId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });

        ticket.escalated = true;
        ticket.escalatedBy = interaction.user.id;
        ticket.escalatedAt = Date.now();
        await saveData();

        await interaction.channel.send({
          components: [
            makePanel('Ticket Escalated', [
              `This ticket was escalated by ${interaction.user}.`,
              `<@&${escalationRoleId}> has been given access to assist.`
            ])
          ],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] }
        });

        return reply(interaction, 'Ticket Escalated', [
          'The configured escalation role has been given access to the ticket.'
        ]);
      }

      if (interaction.customId === 'rover:ticket:rename') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket || !canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised staff can rename tickets.'
          ]);
        }

        const modal = new ModalBuilder()
          .setCustomId('rover:ticket:rename:modal')
          .setTitle('Rename Ticket')
          .addComponents(
            textInput('name', 'New channel name', true, interaction.channel.name, 90)
          );

        return interaction.showModal(modal);
      }

      if (interaction.customId === 'rover:ticket:addmember') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket || !canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised staff can add members to tickets.'
          ]);
        }

        return reply(interaction, 'Add a Member to This Ticket', [
          'Select the member who should receive access to this ticket.'
        ], true, [
          new ContainerBuilder().setAccentColor(PURPLE)
            .addActionRowComponents(new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId('rover:ticket:addmember:select')
                .setPlaceholder('Choose a member')
                .setMinValues(1)
                .setMaxValues(1)
            ))
        ]);
      }

      if (interaction.customId === 'rover:ticket:blacklist') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket || !canBlacklistTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only administrators, owners and authorised moderators can blacklist ticket openers.'
          ]);
        }

        const alreadyBlacklisted = data.ticketBlacklist.includes(ticket.userId);

        if (alreadyBlacklisted) {
          data.ticketBlacklist = data.ticketBlacklist.filter(id => id !== ticket.userId);
        } else {
          data.ticketBlacklist.push(ticket.userId);
        }

        await saveData();

        return reply(interaction,
          alreadyBlacklisted ? 'Ticket Blacklist Updated' : 'Ticket Opener Blacklisted',
          [
            `<@${ticket.userId}> ${alreadyBlacklisted ? 'has been removed from' : 'has been added to'} the ticket blacklist.`,
            'This setting controls whether the user can open new Rover tickets.'
          ]
        );
      }

      if (interaction.customId === 'rover:giveaway:join') {
        const giveaway = data.giveaways.find(g =>
          g.messageId === interaction.message.id && !g.ended
        );

        if (!giveaway) {
          return reply(interaction, 'Giveaway Ended', [
            'This giveaway is no longer accepting entries.'
          ]);
        }

        if (giveaway.entrants.includes(interaction.user.id)) {
          return reply(interaction, 'Already Entered', [
            'You have already entered this giveaway.'
          ]);
        }

        giveaway.entrants.push(interaction.user.id);
        await saveData();
        await updateGiveawayMessage(giveaway, false);

        return reply(interaction, 'Giveaway Entry Confirmed', [
          `You have entered the giveaway for **${giveaway.prize}**.`,
          `**Current entries:** ${giveaway.entrants.length}`,
          'Good luck!'
        ]);
      }
    }

    if (interaction.isStringSelectMenu()) {
      const selected = interaction.values[0];

      if (interaction.customId === 'rover:product:view') {
        const product = productById(selected);

        if (!product || product.active === false) {
          return reply(interaction, 'Product Unavailable', [
            'This product is no longer available in the catalogue.'
          ]);
        }

        return reply(interaction, product.name, [
          `**Price:** ${product.price || 'Not specified'}`,
          `**Category:** ${product.category || 'Uncategorised'}`,
          '',
          '**Product Description**',
          product.description || 'No description has been provided.',
          '',
          product.purchaseUrl
            ? `**Purchase link:** ${product.purchaseUrl}`
            : 'A purchase link has not been added yet.',
          '',
          'If you need help with this product, open a Rover support ticket.'
        ]);
      }

      if (interaction.customId === 'rover:product:edit:select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(selected);
        if (!product) {
          return reply(interaction, 'Product Not Found', [
            'That product no longer exists.'
          ]);
        }

        return interaction.showModal(productModal(product));
      }

      if (interaction.customId === 'rover:product:delete:select') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(selected);
        if (!product) {
          return reply(interaction, 'Product Not Found', [
            'That product no longer exists.'
          ]);
        }

        data.products = data.products.filter(p => p.id !== selected);
        await saveData();

        return reply(interaction, 'Product Removed', [
          `**${product.name}** has been removed from the active catalogue.`,
          'Historical delivery and review records have been retained.'
        ]);
      }

      if (interaction.customId === 'rover:delivery:product') {
        if (!await requireAdmin(interaction)) return;

        const product = productById(selected);
        if (!product || product.active === false) {
          return reply(interaction, 'Product Unavailable', [
            'That product cannot currently be delivered.'
          ]);
        }

        return reply(interaction, 'Choose the Customer', [
          `**Selected product:** ${product.name}`,
          `**Price:** ${product.price || 'Not specified'}`,
          '',
          'Select the customer who should receive this product.'
        ], true, [
          new ContainerBuilder().setAccentColor(PURPLE)
            .addActionRowComponents(new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId(`rover:delivery:customer:${product.id}`)
                .setPlaceholder('Step 2 — Select customer')
                .setMinValues(1)
                .setMaxValues(1)
            ))
        ]);
      }

      if (interaction.customId.startsWith('rover:delivery:product-confirm:')) {
        return reply(interaction, 'Delivery Confirmation', [
          'Please reopen `/give-product` and complete the delivery panel.'
        ]);
      }

      if (interaction.customId === 'rover:information:select') {
        const sections = {
          about: {
            title: 'About Rover Official Store',
            text: [
              '**Who we are**',
              'Rover Official Store is a product catalogue and delivery service. Product information is provided through the store so customers can review available items before purchasing.',
              '',
              '**How the store works**',
              'Browse the catalogue, select the product you are interested in and carefully read its description, category, price and purchase link. If you have questions, ask staff before purchasing.',
              '',
              '**Customer support**',
              'The support ticket system is the recommended way to discuss product questions, order issues and delivery problems privately with authorised staff.',
              '',
              '**Important**',
              'Only use purchase links provided through trusted store channels. Do not share passwords, account tokens or verification codes with anyone.'
            ].join('\n')
          },
          products: {
            title: 'Products and Purchasing',
            text: [
              '**Browsing the catalogue**',
              'Use `/purchase` to browse active products. Select a product from the dropdown to see its description, price, category and any available purchase link.',
              '',
              '**Product categories**',
              '**Assets:** Items or resources presented as assets in the store catalogue.',
              '**Maps:** Map-related products listed by the store.',
              '**Scripts:** Script-related products listed by the store.',
              '',
              '**Before purchasing**',
              'Read the full product description and check the listed price. Confirm that the product suits your needs before proceeding to an external purchase link.',
              '',
              '**Purchase links**',
              'Only follow links provided by trusted Rover store channels. If a link appears broken, unexpected or suspicious, do not proceed. Open a support ticket instead.',
              '',
              '**Product availability**',
              'The active catalogue can change. A product appearing in an old message does not guarantee that it remains available.'
            ].join('\n')
          },
          delivery: {
            title: 'Delivery and Order Support',
            text: [
              '**How delivery works**',
              'Once authorised staff record a delivery through the Rover delivery panel, Rover stores a delivery record and attempts to send the customer a private message with the product details.',
              '',
              '**Delivery messages**',
              'A successful delivery DM may include the product name, description, price, purchase link and delivery reference. If private messages are disabled, Rover may be unable to contact you.',
              '',
              '**I have not received my product**',
              'Open a support ticket and explain what you purchased, when you purchased it and what is missing. Include your order or delivery reference if you have one.',
              '',
              '**Please be patient**',
              'Staff may need time to review order details and verify the delivery record. Avoid opening multiple tickets for the same issue.',
              '',
              '**Keep your account safe**',
              'Support staff do not need your password, authentication codes or account token to review an order.'
            ].join('\n')
          },
          giveaways: {
            title: 'Giveaways and Winners',
            text: [
              '**Entering a giveaway**',
              'Find an active Rover giveaway post and press **Enter Giveaway**. Rover records your entry and updates the entry counter on the original post.',
              '',
              '**Entry counter**',
              'The entry count represents the number of recorded participants. It is separate from the winner field, which remains unselected until the giveaway ends.',
              '',
              '**How winners are selected**',
              'When the giveaway ends, Rover randomly selects up to the configured number of winners from the recorded entries. The original giveaway post remains visible and its winner field is updated.',
              '',
              '**Claiming a prize**',
              'Winners may receive a direct message from Rover. If you win, follow the instructions provided by the store team to arrange your prize.',
              '',
              '**Stay alert**',
              'Never pay a fee to someone claiming they can guarantee a win. Never share your password, account token or verification codes.'
            ].join('\n')
          },
          safety: {
            title: 'Account Safety and Privacy',
            text: [
              '**Protect your account**',
              'Never share your password, account token, authentication code or recovery codes with anyone. Be cautious of unexpected messages, suspicious links and people impersonating store staff.',
              '',
              '**Trusted links**',
              'Use links shared in official store channels. If you are unsure whether a link is genuine, ask staff in a support ticket before opening it.',
              '',
              '**Private support tickets**',
              'Tickets are designed to restrict access to the ticket opener and authorised staff. Do not post personal information that is not necessary to resolve your issue.',
              '',
              '**Messages and DMs**',
              'Rover may attempt to DM you about a recorded delivery or giveaway win. Direct messages can fail if your privacy settings prevent them.',
              '',
              '**Reporting concerns**',
              'If you believe someone is impersonating Rover or attempting to steal your account, preserve relevant evidence and contact server staff through an official channel.'
            ].join('\n')
          },
          terms: {
            title: 'Terms, Refunds and Disputes',
            text: [
              '**Before placing an order**',
              'Review the product description, price, category and purchase terms before completing a purchase. If anything is unclear, ask for clarification first.',
              '',
              '**Refunds and disputes**',
              'Refund requests and purchase disputes are reviewed by the store team according to the applicable purchase terms and circumstances. Submitting a request does not automatically guarantee a refund.',
              '',
              '**Delivery problems**',
              'If a delivery is missing, incomplete or incorrect, open a ticket and provide relevant order information so staff can investigate.',
              '',
              '**Fair use**',
              'Customers should communicate respectfully, provide accurate information and avoid abusing support or giveaway systems.',
              '',
              '**Account security**',
              'Rover staff should never need your password or authentication codes to resolve a store issue.',
              '',
              '**Need assistance?**',
              'Open a Rover support ticket to ask about a product, delivery, refund request or store dispute.'
            ].join('\n')
          }
        };

        const section = sections[selected] || sections.about;

        return reply(interaction, section.title, [section.text]);
      }

      if (interaction.customId === 'rover:review:product') {
        const product = productById(selected);

        if (!product || product.active === false) {
          return reply(interaction, 'Product Unavailable', [
            'This product is no longer available to review.'
          ]);
        }

        const delivered = data.deliveries.some(delivery =>
          delivery.productId === product.id &&
          delivery.customerId === interaction.user.id
        );

        if (!delivered) {
          return reply(interaction, 'Verified Delivery Required', [
            'Only customers with a recorded delivery for this product can submit a review.',
            'If you believe your delivery is missing from the records, open a support ticket.'
          ]);
        }

        if (data.reviews.some(review =>
          review.productId === product.id &&
          review.userId === interaction.user.id
        )) {
          return reply(interaction, 'Review Already Submitted', [
            'You have already submitted a review for this product.'
          ]);
        }

        return interaction.showModal(reviewModal(product.id));
      }

      if (interaction.customId === 'rover:giveaway:end:select') {
        if (!await requireAdmin(interaction)) return;

        const giveaway = data.giveaways.find(g =>
          g.id === selected && !g.ended
        );

        if (!giveaway) {
          return reply(interaction, 'Giveaway Not Found', [
            'That giveaway has already ended or no longer exists.'
          ]);
        }

        await finishGiveaway(giveaway);

        return reply(interaction, 'Giveaway Ended', [
          `The giveaway for **${giveaway.prize}** has ended.`,
          'The original post has been updated with the selected winner or winners.'
        ]);
      }
    }

    if (interaction.isUserSelectMenu()) {
      const userId = interaction.values[0];

      if (interaction.customId.startsWith('rover:delivery:customer:')) {
        if (!await requireAdmin(interaction)) return;

        const productId = interaction.customId.slice('rover:delivery:customer:'.length);
        const product = productById(productId);

        if (!product || product.active === false) {
          return reply(interaction, 'Product Unavailable', [
            'The selected product is no longer available.'
          ]);
        }

        return reply(interaction, 'Confirm Product Delivery', [
          `**Product:** ${product.name}`,
          `**Customer:** <@${userId}>`,
          `**Price:** ${product.price || 'Not specified'}`,
          '',
          'Confirming will record the delivery and attempt to send the customer a DM containing the product details.'
        ], true, [
          new ContainerBuilder().setAccentColor(PURPLE)
            .addActionRowComponents(new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`rover:delivery:confirm:${product.id}:${userId}`)
                .setLabel('Confirm Delivery')
                .setStyle(ButtonStyle.Primary)
            ))
        ]);
      }

      if (interaction.customId === 'rover:ticket:addmember:select') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket || !canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised staff can add members to a ticket.'
          ]);
        }

        await interaction.channel.permissionOverwrites.edit(userId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });

        await interaction.channel.send({
          components: [
            makePanel('Ticket Access Updated', [
              `<@${userId}> has been granted access to this ticket by ${interaction.user}.`
            ])
          ],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] }
        });

        return reply(interaction, 'Member Added', [
          `<@${userId}> has been granted access to this ticket.`
        ]);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'rover:product:create' ||
          interaction.customId.startsWith('rover:product:edit:')) {
        if (!await requireAdmin(interaction)) return;

        const name = interaction.fields.getTextInputValue('name').trim();
        const price = interaction.fields.getTextInputValue('price').trim();
        const description = interaction.fields.getTextInputValue('description').trim();
        const purchaseUrl = interaction.fields.getTextInputValue('url').trim();
        const category = interaction.fields.getTextInputValue('category').trim();

        if (purchaseUrl) {
          try {
            const parsed = new URL(purchaseUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
          } catch {
            return reply(interaction, 'Invalid Purchase URL', [
              'Enter a valid URL beginning with `https://` or `http://`, or leave the field empty.'
            ]);
          }
        }

        if (interaction.customId === 'rover:product:create') {
          const product = {
            id: makeId('product'),
            name,
            price,
            description,
            purchaseUrl,
            category,
            active: true,
            createdBy: interaction.user.id,
            createdAt: Date.now()
          };

          data.products.push(product);
          await saveData();

          return reply(interaction, 'Product Created Successfully', [
            `**Product:** ${product.name}`,
            `**Product ID:** ${product.id}`,
            `**Price:** ${product.price}`,
            `**Category:** ${product.category}`,
            '',
            'The product is now available in the `/purchase` catalogue.'
          ]);
        }

        const id = interaction.customId.slice('rover:product:edit:'.length);
        const product = productById(id);

        if (!product) {
          return reply(interaction, 'Product Not Found', [
            'The product you were editing no longer exists.'
          ]);
        }

        Object.assign(product, {
          name,
          price,
          description,
          purchaseUrl,
          category,
          updatedAt: Date.now(),
          updatedBy: interaction.user.id
        });

        await saveData();

        return reply(interaction, 'Product Updated Successfully', [
          `**Product:** ${product.name}`,
          `**Product ID:** ${product.id}`,
          `**Price:** ${product.price}`,
          `**Category:** ${product.category}`,
          '',
          'The updated details will appear in the product catalogue.'
        ]);
      }

      if (interaction.customId === 'rover:giveaway:create') {
        if (!await requireAdmin(interaction)) return;

        const prize = interaction.fields.getTextInputValue('prize').trim();
        const duration = parseDuration(interaction.fields.getTextInputValue('duration'));
        const winnerCount = Number(interaction.fields.getTextInputValue('winners'));
        const details = interaction.fields.getTextInputValue('details').trim();

        if (!duration) {
          return reply(interaction, 'Invalid Duration', [
            'Enter a duration such as `30m`, `2h` or `1d`. The maximum is seven days.'
          ]);
        }

        if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 10) {
          return reply(interaction, 'Invalid Winner Count', [
            'Choose a whole number from 1 to 10.'
          ]);
        }

        const giveaway = {
          id: makeId('giveaway'),
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

        const message = await interaction.channel.send({
          components: [
            makePanel('Rover Giveaway', [
              `**Prize:** ${prize}`,
              details ? `**Details:**\n${details}` : '',
              '**Entries:** 0',
              '**Winner:** Not selected yet',
              `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
              `**Winners to draw:** ${winnerCount}`
            ]),
            new ContainerBuilder().setAccentColor(PURPLE)
              .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId('rover:giveaway:join')
                  .setLabel('Enter Giveaway')
                  .setStyle(ButtonStyle.Primary)
              ))
          ],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] }
        });

        giveaway.messageId = message.id;
        data.giveaways.push(giveaway);
        await saveData();
        scheduleGiveaway(giveaway);

        return reply(interaction, 'Giveaway Published', [
          `The giveaway for **${prize}** is now live.`,
          `**Ends:** <t:${Math.floor(giveaway.endsAt / 1000)}:R>`,
          'The original giveaway post will remain after the draw and show the selected winner.'
        ]);
      }

      if (interaction.customId.startsWith('rover:review:submit:')) {
        const productId = interaction.customId.slice('rover:review:submit:'.length);
        const product = productById(productId);

        if (!product) {
          return reply(interaction, 'Product Not Found', [
            'The selected product no longer exists.'
          ]);
        }

        const delivered = data.deliveries.some(delivery =>
          delivery.productId === product.id &&
          delivery.customerId === interaction.user.id
        );

        if (!delivered) {
          return reply(interaction, 'Verified Delivery Required', [
            'A recorded delivery is required before a review can be submitted.'
          ]);
        }

        if (data.reviews.some(review =>
          review.productId === product.id &&
          review.userId === interaction.user.id
        )) {
          return reply(interaction, 'Review Already Submitted', [
            'You have already reviewed this product.'
          ]);
        }

        const rating = Number(interaction.fields.getTextInputValue('rating').trim());
        const comment = interaction.fields.getTextInputValue('comment').trim();

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          return reply(interaction, 'Invalid Rating', [
            'Your rating must be a whole number from 1 to 5.'
          ]);
        }

        const review = {
          id: makeId('review'),
          productId: product.id,
          productName: product.name,
          userId: interaction.user.id,
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
            components: [
              makePanel('Verified Customer Review', [
                `**Product:** ${product.name}`,
                `**Rating:** ${rating}/5`,
                `**Customer:** ${interaction.user.tag}`,
                '',
                '**Review**',
                comment
              ])
            ],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
          });
        }

        return reply(interaction, 'Review Submitted', [
          `Thank you for reviewing **${product.name}**.`,
          `**Your rating:** ${rating}/5`,
          'Your review has been recorded.'
        ]);
      }

      if (interaction.customId === 'rover:ticket:rename:modal') {
        const ticket = ticketForChannel(interaction.channelId);

        if (!ticket || !canManageTickets(interaction.member)) {
          return reply(interaction, 'Permission Required', [
            'Only authorised staff can rename tickets.'
          ]);
        }

        const name = interaction.fields.getTextInputValue('name')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .slice(0, 90);

        if (!name) {
          return reply(interaction, 'Invalid Channel Name', [
            'Enter a valid channel name.'
          ]);
        }

        await interaction.channel.setName(name);

        return reply(interaction, 'Ticket Renamed', [
          `The ticket channel is now named **${name}**.`
        ]);
      }

      if (interaction.customId.startsWith('rover:announce:modal:')) {
        if (!await requireAdmin(interaction)) return;

        const [, , , channelId, type] = interaction.customId.split(':');
        const channel = await client.channels.fetch(channelId).catch(() => null);

        if (!channel?.isTextBased()) {
          return reply(interaction, 'Channel Not Found', [
            'The announcement destination is no longer available.'
          ]);
        }

        const message = interaction.fields.getTextInputValue('message').trim();
        const username = interaction.fields.getTextInputValue('username').trim() || 'Rover Official Store';
        const avatar = interaction.fields.getTextInputValue('avatar').trim();

        if (avatar) {
          try {
            if (!['http:', 'https:'].includes(new URL(avatar).protocol)) throw new Error();
          } catch {
            return reply(interaction, 'Invalid Avatar URL', [
              'Use a valid HTTP or HTTPS image URL, or leave the avatar field empty.'
            ]);
          }
        }

        if (type === 'webhook') {
          if (!interaction.guild.members.me?.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) {
            return reply(interaction, 'Webhook Permission Required', [
              'Rover needs the **Manage Webhooks** permission in the destination channel to publish webhook announcements.'
            ]);
          }

          let webhook;

          try {
            const webhooks = await channel.fetchWebhooks();
            webhook = webhooks.find(hook => hook.owner?.id === client.user.id);

            if (!webhook) {
              webhook = await channel.createWebhook({
                name: 'Rover Announcements',
                reason: 'Rover announcement system'
              });
            }

            await webhook.send({
              content: message,
              username: clean(username, 80),
              avatarURL: avatar || undefined,
              allowedMentions: { parse: [] }
            });
          } catch (error) {
            console.error('Webhook announcement failed:', error);

            return reply(interaction, 'Webhook Announcement Failed', [
              'Rover could not publish the webhook message. Check that it has Manage Webhooks permission in the destination channel.'
            ]);
          }
        } else {
          await channel.send({
            content: message,
            allowedMentions: { parse: [] }
          });
        }

        return reply(interaction, 'Announcement Published', [
          `Your ${type === 'webhook' ? 'webhook' : 'normal'} message has been sent to ${channel}.`
        ]);
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          components: [
            makePanel('Something Went Wrong', [
              'Rover could not complete that action.',
              'Please try again. If the problem continues, check the bot console for the error details.'
            ])
          ],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
      } else {
        await reply(interaction, 'Something Went Wrong', [
          'Rover could not complete that action.',
          'Please try again. If the problem continues, check the bot console for the error details.'
        ]);
      }
    } catch {}
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('rover:delivery:confirm:')) return;

  try {
    if (!isAdmin(interaction)) {
      return reply(interaction, 'Permission Required', [
        'Only authorised staff can confirm product deliveries.'
      ]);
    }

    const parts = interaction.customId.split(':');
    const productId = parts[3];
    const customerId = parts[4];

    const product = productById(productId);
    if (!product || product.active === false) {
      return reply(interaction, 'Product Unavailable', [
        'The selected product no longer exists or is inactive.'
      ]);
    }

    const customer = await client.users.fetch(customerId).catch(() => null);

    if (!customer) {
      return reply(interaction, 'Customer Not Found', [
        'Rover could not find that customer.'
      ]);
    }

    const delivery = {
      id: makeId('delivery'),
      productId: product.id,
      productName: product.name,
      customerId: customer.id,
      staffId: interaction.user.id,
      guildId: interaction.guildId,
      timestamp: Date.now()
    };

    data.deliveries.push(delivery);
    await saveData();

    let dmSent = true;

    try {
      await customer.send({
        components: [
          makePanel('Your Rover Product Delivery', [
            `Hello ${customer.username},`,
            '',
            `Your product **${product.name}** has been delivered.`,
            '',
            '**Product details**',
            product.description || 'No description provided.',
            '',
            `**Price:** ${product.price || 'Not specified'}`,
            `**Category:** ${product.category || 'Uncategorised'}`,
            product.purchaseUrl ? `**Product link:** ${product.purchaseUrl}` : '',
            `**Delivery reference:** ${delivery.id}`,
            '',
            'If you need assistance, please open a support ticket in the Rover server.'
          ])
        ],
        flags: MessageFlags.IsComponentsV2
      });
    } catch {
      dmSent = false;
    }

    return reply(interaction, 'Product Delivery Recorded', [
      `**Customer:** ${customer.tag}`,
      `**Product:** ${product.name}`,
      `**Delivery reference:** ${delivery.id}`,
      dmSent
        ? 'The customer has been sent a delivery DM.'
        : 'The delivery was recorded, but the customer’s DMs could not be reached.'
    ]);
  } catch (error) {
    console.error('Delivery confirmation error:', error);

    return reply(interaction, 'Delivery Failed', [
      'Rover could not complete the delivery. Check the bot console for details.'
    ]).catch(() => {});
  }
});

client.login(TOKEN);
