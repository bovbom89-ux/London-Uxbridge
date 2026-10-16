require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType,
  PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle
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
  reviews: []
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
      moderation: Array.isArray(d.moderation) ? d.moderation : [],
      roles: d.roles && typeof d.roles === 'object' ? d.roles : {},
      rolesSetupCompleted: Boolean(d.rolesSetupCompleted),
      ticketConfig: d.ticketConfig && typeof d.ticketConfig === 'object'
        ? d.ticketConfig
        : { categoryId: null, panelChannelId: null },
      tickets: d.tickets && typeof d.tickets === 'object' ? d.tickets : {},
      ticketBlacklist: Array.isArray(d.ticketBlacklist) ? d.ticketBlacklist : [],
      reviewConfig: d.reviewConfig && typeof d.reviewConfig === 'object'
        ? d.reviewConfig
        : { channelId: null },
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

const makeId = prefix =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const clean = (v, max = 1000) =>
  String(v ?? '').trim().slice(0, max);

const validUrl = v => {
  if (!v) return true;

  try {
    return ['http:', 'https:'].includes(new URL(v).protocol);
  } catch {
    return false;
  }
};

const activeProducts = () =>
  (Array.isArray(data.products) ? data.products : []).filter(p =>
    p &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    p.active !== false &&
    typeof p.id === 'string' &&
    p.id.trim().length > 0 &&
    p.id.length <= 100 &&
    typeof p.name === 'string' &&
    p.name.trim().length > 0
  );

const productById = id =>
  (Array.isArray(data.products) ? data.products : []).find(p =>
    p &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    p.id === id
  );

const isAdmin = i => Boolean(
  i.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
  i.memberPermissions?.has(PermissionFlagsBits.Administrator)
);

async function requireAdmin(i) {
  if (isAdmin(i)) return true;

  await panelReply(i, 'Permission Required', [
    'You need **Manage Server** or **Administrator** to use this command.'
  ]);

  return false;
}

function makePanel(title, sections = []) {
  const c = new ContainerBuilder().setAccentColor(PURPLE);

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}`)
  );

  for (const section of sections.filter(Boolean)) {
    c.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(String(section))
    );
  }

  c.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true)
  );

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${FOOTER}`)
  );

  return c;
}

function panelPayload(title, sections = [], ephemeral = true, extra = []) {
  return {
    components: [makePanel(title, sections), ...extra],
    flags: MessageFlags.IsComponentsV2 |
      (ephemeral ? MessageFlags.Ephemeral : 0),
    allowedMentions: { parse: [] }
  };
}

async function panelReply(i, title, sections = [], ephemeral = true) {
  const payload = panelPayload(title, sections, ephemeral);

  return (i.deferred || i.replied)
    ? i.editReply(payload)
    : i.reply(payload);
}

function productOptions(products) {
  const seen = new Set();
  const options = [];

  for (const p of Array.isArray(products) ? products : []) {
    if (!p || typeof p !== 'object') continue;

    const id = clean(p.id, 100);
    if (!id || id !== p.id || seen.has(id)) continue;

    const label = clean(p.name, 100) || 'Unnamed product';
    const category = clean(p.category, 30) || 'Uncategorised';
    const price = clean(p.price, 40) || 'Not set';

    options.push({
      label,
      description: clean(`Category: ${category} | Price: ${price}`, 100),
      value: id
    });

    seen.add(id);
    if (options.length >= 25) break;
  }

  return options;
}

function productSummary(p) {
  const out = [
    `**${clean(p.name, 100) || 'Unnamed product'}**`,
    clean(p.description, 1000) || 'No description provided.',
    `**Price:** ${clean(p.price, 80) || 'Not set'}`
  ];

  if (p.category) out.push(`**Category:** ${p.category}`);
  if (p.purchaseUrl) out.push(`[Purchase link](${p.purchaseUrl})`);

  return out.join('\n');
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

  if (value) input.setValue(String(value).slice(0, max));

  return new ActionRowBuilder().addComponents(input);
}

function productModal(p = null) {
  const editing = Boolean(p);

  return new ModalBuilder()
    .setCustomId(editing ? `rover:product:edit:${p.id}` : 'rover:product:create')
    .setTitle(editing ? 'Edit product' : 'Create product')
    .addComponents(
      textInput('name', 'Product name', TextInputStyle.Short, true, p?.name || '', 100),
      textInput('price', 'Price (e.g. £4.99 or Free)', TextInputStyle.Short, true, p?.price || '', 80),
      textInput('description', 'Product description', TextInputStyle.Paragraph, true, p?.description || '', 1000),
      textInput('url', 'Purchase URL (optional)', TextInputStyle.Short, false, p?.purchaseUrl || '', 300),
      textInput('category', 'Category: Assets, Maps or Scripts', TextInputStyle.Short, true, p?.category || '', 20)
    );
}

function embedModal() {
  return new ModalBuilder()
    .setCustomId('rover:embed:create')
    .setTitle('Build custom panel')
    .addComponents(
      textInput('title', 'Panel title', TextInputStyle.Short, true, '', 100),
      textInput('message', 'Panel message', TextInputStyle.Paragraph, true, '', 3500),
      textInput('label', 'Optional link button label', TextInputStyle.Short, false, '', 80),
      textInput('url', 'Optional link URL', TextInputStyle.Short, false, '', 300)
    );
}

function giveawayModal() {
  return new ModalBuilder()
    .setCustomId('rover:giveaway:create')
    .setTitle('Configure giveaway')
    .addComponents(
      textInput('prize', 'Giveaway prize', TextInputStyle.Short, true, '', 150),
      textInput('duration', 'Duration (30m, 2h or 1d)', TextInputStyle.Short, true, '', 20),
      textInput('winners', 'Number of winners (1–10)', TextInputStyle.Short, true, '', 2),
      textInput('details', 'Extra details (optional)', TextInputStyle.Paragraph, false, '', 500)
    );
}

function parseDuration(v) {
  const m = clean(v, 20).toLowerCase().match(
    /^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/
  );

  if (!m || Number(m[1]) < 1) return null;

  const ms = Number(m[1]) *
    (m[2].startsWith('m') ? 60000 :
      m[2].startsWith('h') ? 3600000 : 86400000);

  return ms <= 7 * 86400000 ? ms : null;
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
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('Channel where the information panel should be posted')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
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
    .addStringOption(o => o
      .setName('message')
      .setDescription('Announcement text')
      .setRequired(true)
      .setMaxLength(1900)
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member and send a moderation notice')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o
      .setName('user')
      .setDescription('Member to ban')
      .setRequired(true)
    )
    .addStringOption(o => o
      .setName('reason')
      .setDescription('Reason for the ban')
      .setRequired(false)
      .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member and send a moderation notice')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o
      .setName('user')
      .setDescription('Member to kick')
      .setRequired(true)
    )
    .addStringOption(o => o
      .setName('reason')
      .setDescription('Reason for the kick')
      .setRequired(false)
      .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member and send a moderation notice')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o
      .setName('user')
      .setDescription('Member to timeout')
      .setRequired(true)
    )
    .addIntegerOption(o => o
      .setName('minutes')
      .setDescription('Duration in minutes')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(40320)
    )
    .addStringOption(o => o
      .setName('reason')
      .setDescription('Reason for timeout')
      .setRequired(false)
      .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription("Remove a member's timeout")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o
      .setName('user')
      .setDescription('Member to untimeout')
      .setRequired(true)
    )
    .addStringOption(o => o
      .setName('reason')
      .setDescription('Reason for removing timeout')
      .setRequired(false)
      .setMaxLength(500)
    ),

  new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Create Rover store roles once')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Configure Rover tickets')
    .addSubcommand(sc => sc
      .setName('setup')
      .setDescription('Set up the ticket panel')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('Leave a verified product review'),

  new SlashCommandBuilder()
    .setName('review-settings')
    .setDescription('Configure the review channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o
      .setName('channel')
      .setDescription('Channel to receive reviews')
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    )
];

const ticketSetupSessions = new Map();

function staffRoleId(name) {
  return data.roles?.[name] || null;
}

function memberHasNamedRole(member, names) {
  if (!member?.roles?.cache) return false;

  return names.some(name => {
    const id = staffRoleId(name);
    return id && member.roles.cache.has(id);
  });
}

function canManageTickets(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    memberHasNamedRole(member, ['Owner', 'Administrator', 'Moderator', 'Support'])
  );
}

function canBlacklistTickets(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    memberHasNamedRole(member, ['Owner', 'Administrator', 'Moderator'])
  );
}

function ticketControlComponents(ticket) {
  return new ContainerBuilder()
    .setAccentColor(PURPLE)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rover:ticket:claim:${ticket.channelId}`)
          .setLabel(ticket.claimedBy ? 'Claimed' : 'Claim')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(Boolean(ticket.claimedBy)),

        new ButtonBuilder()
          .setCustomId(`rover:ticket:close:${ticket.channelId}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(`rover:ticket:mod:${ticket.channelId}`)
          .setLabel('Mod Panel')
          .setStyle(ButtonStyle.Secondary)
      )
    );
}

function ticketModComponents(ticket) {
  const blacklisted = (data.ticketBlacklist || []).includes(ticket.openerId);

  return new ContainerBuilder()
    .setAccentColor(PURPLE)
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rover:ticket:escalate:${ticket.channelId}`)
          .setLabel('Escalate')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(`rover:ticket:rename:${ticket.channelId}`)
          .setLabel('Rename ticket')
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(`rover:ticket:add:${ticket.channelId}`)
          .setLabel('Add member')
          .setStyle(ButtonStyle.Secondary)
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rover:ticket:blacklist:${ticket.channelId}`)
          .setLabel('Blacklist opener')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(blacklisted),

        new ButtonBuilder()
          .setCustomId(`rover:ticket:unblacklist:${ticket.channelId}`)
          .setLabel('Unblacklist opener')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!blacklisted)
      )
    );
}

function roleDefinitions() {
  return [
    {
      name: 'Owner',
      color: 0xE74C3C,
      permissions: [PermissionFlagsBits.Administrator]
    },
    {
      name: 'Administrator',
      color: PURPLE,
      permissions: [
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ViewAuditLog
      ]
    },
    {
      name: 'Moderator',
      color: 0x5865F2,
      permissions: [
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ViewAuditLog
      ]
    },
    {
      name: 'Support',
      color: 0x2ECC71,
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles
      ]
    },
    {
      name: 'Customer',
      color: 0xF1C40F,
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseApplicationCommands
      ]
    },
    {
      name: 'Verified',
      color: 0x1ABC9C,
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseApplicationCommands
      ]
    },
    {
      name: 'Member',
      color: 0x95A5A6,
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.UseApplicationCommands
      ]
    },
    {
      name: 'Muted',
      color: 0xD35400,
      permissions: []
    }
  ];
}

async function createRoverRoles(guild) {
  const botMember = guild.members.me;

  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Rover needs Manage Roles.');
  }

  const roles = {};

  for (const def of roleDefinitions()) {
    let role = guild.roles.cache.find(r => r.name === def.name);

    if (!role) {
      role = await guild.roles.create({
        name: def.name,
        color: def.color,
        permissions: def.permissions,
        reason: 'Rover initial role setup'
      });
    } else if (!data.rolesSetupCompleted) {
      await role.setColor(def.color).catch(() => {});
      await role.setPermissions(def.permissions).catch(() => {});
    }

    if (role.position >= botMember.roles.highest.position) {
      throw new Error(
        `Move Rover's bot role above **${role.name}** and run /roles again. Existing roles were reused; no duplicates were created.`
      );
    }

    roles[def.name] = role.id;
  }

  data.roles = roles;
  data.rolesSetupCompleted = true;
  await saveData();

  return roles;
}

async function publishTicketPanel(channel) {
  return channel.send({
    components: [
      makePanel('Rover Support Tickets', [
        'Need help with a purchase, delivery or store question?',
        'Press **Open Ticket** to create a private support channel. Please explain your issue clearly and include relevant order details.',
        'Do not share passwords, account tokens or payment card details.'
      ]),
      new ContainerBuilder()
        .setAccentColor(PURPLE)
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('rover:ticket:open')
              .setLabel('Open Ticket')
              .setStyle(ButtonStyle.Primary)
          )
        )
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  });
}
