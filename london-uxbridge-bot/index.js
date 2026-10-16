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

const makeId = p => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const clean = (v, n = 1000) => String(v ?? '').trim().slice(0, n);
const validUrl = v => {
  if (!v) return true;
  try { return ['http:', 'https:'].includes(new URL(v).protocol); }
  catch { return false; }
};

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

function productOptions(products) {
  return products.filter(p => p && p.id && p.name).slice(0, 25).map(p => ({
    label: clean(p.name, 100),
    description: clean(`${p.category || 'Uncategorised'} | ${p.price || 'Price not set'}`, 100),
    value: String(p.id)
  }));
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

function textInput(id, label, required = true, value = '', max = 1000, paragraph = false) {
  const t = new TextInputBuilder()
    .setCustomId(id).setLabel(label)
    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required).setMaxLength(max);
  if (value) t.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(t);
}

function staffRoleId(name) { return data.roles?.[name] || null; }

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

function roleDefinitions() {
  return [
    { name: 'Owner', color: 0xE74C3C, permissions: [PermissionFlagsBits.Administrator] },
    { name: 'Administrator', color: PURPLE, permissions: [
      PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ViewAuditLog
    ] },
    { name: 'Moderator', color: 0x5865F2, permissions: [
      PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers, PermissionFlagsBits.ViewAuditLog
    ] },
    { name: 'Support', color: 0x2ECC71, permissions: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ] },
    { name: 'Customer', color: 0xF1C40F, permissions: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands
    ] },
    { name: 'Verified', color: 0x1ABC9C, permissions: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands
    ] },
    { name: 'Member', color: 0x95A5A6, permissions: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands
    ] },
    { name: 'Muted', color: 0xD35400, permissions: [] }
  ];
}

async function createRoverRoles(guild) {
  const bot = guild.members.me;
  if (!bot?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Rover needs Manage Roles permission.');
  }

  const created = {};
  for (const def of roleDefinitions()) {
    let role = guild.roles.cache.find(r => r.name === def.name);
    if (!role) {
      role = await guild.roles.create({
        name: def.name, color: def.color, permissions: def.permissions,
        reason: 'Rover role setup'
      });
    } else if (!data.rolesSetupCompleted) {
      await role.setColor(def.color).catch(() => {});
      await role.setPermissions(def.permissions).catch(() => {});
    }

    if (role.position >= bot.roles.highest.position) {
      throw new Error(`Move Rover's role above **${role.name}**, then run /roles again.`);
    }
    created[def.name] = role.id;
  }

  data.roles = created;
  data.rolesSetupCompleted = true;
  await saveData();
  return created;
}

function ticketControls(ticket) {
  return new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rover:ticket:claim:${ticket.channelId}`)
        .setLabel(ticket.claimedBy ? 'Claimed' : 'Claim')
        .setStyle(ButtonStyle.Primary).setDisabled(Boolean(ticket.claimedBy)),
      new ButtonBuilder().setCustomId(`rover:ticket:close:${ticket.channelId}`)
        .setLabel('Close').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`rover:ticket:mod:${ticket.channelId}`)
        .setLabel('Mod Panel').setStyle(ButtonStyle.Secondary)
    )
  );
}

function ticketModControls(ticket) {
  const blacklisted = data.ticketBlacklist.includes(ticket.openerId);
  return new ContainerBuilder().setAccentColor(PURPLE)
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rover:ticket:escalate:${ticket.channelId}`)
        .setLabel('Escalate').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`rover:ticket:rename:${ticket.channelId}`)
        .setLabel('Rename ticket').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rover:ticket:add:${ticket.channelId}`)
        .setLabel('Add member').setStyle(ButtonStyle.Secondary)
    ))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rover:ticket:blacklist:${ticket.channelId}`)
        .setLabel('Blacklist opener').setStyle(ButtonStyle.Danger).setDisabled(blacklisted),
      new ButtonBuilder().setCustomId(`rover:ticket:unblacklist:${ticket.channelId}`)
        .setLabel('Unblacklist opener').setStyle(ButtonStyle.Success).setDisabled(!blacklisted)
    ));
}

async function publishTicketPanel(channel) {
  return channel.send({
    components: [
      makePanel('Rover Support Tickets', [
        'Need help with a purchase, delivery or store question?',
        'Press **Open Ticket** to create a private support channel.',
        'Never share passwords, account tokens or payment card details.'
      ]),
      new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('rover:ticket:open')
            .setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
        )
      )
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  });
}

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription("Check Rover's response time"),
  new SlashCommandBuilder().setName('create-product').setDescription('Add a product').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('edit-product').setDescription('Edit a product').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('delete-product').setDescription('Delete a product').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('purchase').setDescription('Privately browse products'),
  new SlashCommandBuilder().setName('embed').setDescription('Build a custom purple panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('information').setDescription('Post the information centre').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Panel channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  new SlashCommandBuilder().setName('giveaway').setDescription('Create a giveaway').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('end-giveaway').setDescription('End a giveaway').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('give-product').setDescription('Record product delivery').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('announce').setDescription('Publish a webhook announcement').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true).setMaxLength(1900)),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(500)),
  new SlashCommandBuilder().setName('roles').setDescription('Create Rover roles once').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName('ticket').setDescription('Set up Rover tickets')
    .addSubcommand(s => s.setName('setup').setDescription('Create the ticket panel'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('review').setDescription('Leave a verified product review'),
  new SlashCommandBuilder().setName('review-settings').setDescription('Set or view review channel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('channel').setDescription('Review channel').setRequired(false).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
];

const giveawayTimers = new Map();

function parseDuration(v) {
  const m = clean(v, 20).toLowerCase().match(/^(\d+)\s*(m|min|mins|h|hr|hrs|d|day|days)$/);
  if (!m || Number(m[1]) < 1) return null;
  const ms = Number(m[1]) * (m[2].startsWith('m') ? 60000 : m[2].startsWith('h') ? 3600000 : 86400000);
  return ms <= 7 * 86400000 ? ms : null;
}

async function finishGiveaway(g) {
  if (!g || g.ended) return;
  g.ended = true;
  clearTimeout(giveawayTimers.get(g.id));
  const pool = [...new Set(g.entrants || [])];
  const winners = [];
  while (pool.length && winners.length < g.winnerCount) {
    winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  g.winners = winners;
  await saveData();
  const channel = await client.channels.fetch(g.channelId).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send({
      components: [makePanel('Giveaway Results', [
        `**Prize:** ${g.prize}`,
        winners.length ? `**Winner(s):** ${winners.map(id => `<@${id}>`).join(', ')}` : 'No entries received.'
      ])],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { users: winners }
    });
  }
}

function scheduleGiveaway(g) {
  if (!g || g.ended) return;
  const delay = Math.min(Math.max(0, g.endsAt - Date.now()), 2147000000);
  giveawayTimers.set(g.id, setTimeout(() => finishGiveaway(g).catch(console.error), delay));
}

client.once('clientReady', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(c => c.toJSON())
    });
    console.log(`Registered ${commands.length} Rover commands.`);
    data.giveaways.filter(g => !g.ended).forEach(scheduleGiveaway);
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
            `Latency: **${client.ws.ping} ms**`,
            `Active products: **${activeProducts().length}**`
          ]);

        case 'roles':
          if (!await requireAdmin(i)) return;
          if (data.rolesSetupCompleted) {
            return reply(i, 'Roles Already Set Up', ['Rover role setup has already completed. No duplicate roles were created.']);
          }
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          try {
            const roles = await createRoverRoles(i.guild);
            return reply(i, 'Roles Created', Object.entries(roles).map(([name, id]) => `**${name}:** <@&${id}>`));
          } catch (e) {
            console.error('Role setup failed:', e);
            return reply(i, 'Role Setup Needs Attention', [e.message]);
          }

        case 'ticket':
          if (!await requireAdmin(i)) return;
          return i.reply(payload('Ticket Setup', [
            'Choose the category where private tickets should be created.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rover:ticket:category')
                  .setPlaceholder('Choose a ticket category')
                  .addOptions(i.guild.channels.cache
                    .filter(c => c.type === ChannelType.GuildCategory)
                    .map(c => ({ label: clean(c.name, 100), value: c.id }))
                    .slice(0, 25))
              )
            )
          ]));

        case 'review-settings': {
          if (!await requireAdmin(i)) return;
          const channel = i.options.getChannel('channel');
          if (channel) {
            data.reviewConfig.channelId = channel.id;
            await saveData();
            return reply(i, 'Review Channel Saved', [`Product reviews will be posted in ${channel}.`]);
          }
          const existing = data.reviewConfig.channelId;
          return reply(i, 'Review Settings', [
            existing ? `Current review channel: <#${existing}>` : 'No review channel has been configured.',
            'Use `/review-settings channel:#channel` to set it.'
          ]);
        }

        case 'review': {
          const options = productOptions(activeProducts());
          if (!options.length) return reply(i, 'No Products', ['There are no active products to review.']);
          return i.reply(payload('Verified Product Review', [
            'Choose a product you have received. Only customers with a recorded delivery can submit a review.'
          ], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rover:review:product')
                  .setPlaceholder('Choose a delivered product').addOptions(options)
              )
            )
          ]));
        }

        case 'create-product':
          if (!await requireAdmin(i)) return;
          return i.showModal(productModal());

        case 'edit-product': {
          if (!await requireAdmin(i)) return;
          const options = productOptions(data.products);
          if (!options.length) return reply(i, 'No Products', ['Create a product first.']);
          return i.reply(payload('Edit Product', ['Choose a product.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rover:product:editselect')
                  .setPlaceholder('Choose a product').addOptions(options)
              )
            )
          ]));
        }

        case 'delete-product': {
          if (!await requireAdmin(i)) return;
          const options = productOptions(data.products);
          if (!options.length) return reply(i, 'No Products', ['There are no products to delete.']);
          return i.reply(payload('Delete Product', ['Choose a product to delete.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rover:product:deleteselect')
                  .setPlaceholder('Choose a product').addOptions(options)
              )
            )
          ]));
        }

        case 'purchase': {
          const options = productOptions(activeProducts());
          if (!options.length) return reply(i, 'No Products', ['No active products are available.']);
          return i.reply(payload('Purchase Centre', ['Choose a product to view its details.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rover:purchase')
                  .setPlaceholder('Choose a product').addOptions(options)
              )
            )
          ]));
        }

        case 'give-product': {
          if (!await requireAdmin(i)) return;
          const options = productOptions(activeProducts());
          if (!options.length) return reply(i, 'No Products', ['Create a product first.']);
          return i.reply(payload('Record Delivery', ['Choose the delivered product.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId('rover:delivery:product')
                  .setPlaceholder('Choose a product').addOptions(options)
              )
            )
          ]));
        }

        case 'information': {
          if (!await requireAdmin(i)) return;
          const channel = i.options.getChannel('channel', true);
          await channel.send(payload('Rover Official Store | Information Centre', [
            'Welcome to Rover Official Store.',
            'Our product categories are **Assets**, **Maps** and **Scripts**.',
            'Use `/purchase` to privately browse available products.'
          ], false));
          return reply(i, 'Information Panel Posted', [`Published in ${channel}.`]);
        }

        case 'embed':
          if (!await requireAdmin(i)) return;
          return reply(i, 'Custom Panel', ['Use the custom panel builder in a future update.']);

        case 'giveaway':
          if (!await requireAdmin(i)) return;
          return reply(i, 'Giveaway', ['Giveaway creation is not included in this recovery build.']);

        case 'end-giveaway': {
          if (!await requireAdmin(i)) return;
          const g = data.giveaways.find(x => !x.ended);
          if (!g) return reply(i, 'No Active Giveaway', ['There are no active giveaways.']);
          await finishGiveaway(g);
          return reply(i, 'Giveaway Ended', [`Ended giveaway: **${g.prize}**`]);
        }

        case 'announce':
          if (!await requireAdmin(i)) return;
          return reply(i, 'Announcement', [
            'Announcement command received.',
            clean(i.options.getString('message'), 1900)
          ], false);

        case 'ban':
        case 'kick':
        case 'timeout':
        case 'untimeout': {
          const target = i.options.getUser('user');
          const reason = clean(i.options.getString('reason') || 'No reason provided.', 500);
          const member = await i.guild.members.fetch(target.id).catch(() => null);
          if (!member) return reply(i, 'Member Not Found', ['That user is not in this server.']);
          if (target.id === i.user.id || target.id === i.guild.ownerId) {
            return reply(i, 'Action Not Allowed', ['You cannot moderate yourself or the server owner.']);
          }
          const actor = await i.guild.members.fetch(i.user.id).catch(() => null);
          const bot = i.guild.members.me;
          const cmd = i.commandName;
          const perm = cmd === 'ban' ? PermissionFlagsBits.BanMembers :
            cmd === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.ModerateMembers;
          if (!i.memberPermissions.has(PermissionFlagsBits.Administrator) && !i.memberPermissions.has(perm)) {
            return reply(i, 'Permission Required', ['You do not have the required moderation permission.']);
          }
          if (!bot?.permissions.has(perm)) return reply(i, 'Rover Missing Permission', ['Give Rover the required moderation permission.']);
          if (member.roles.highest.position >= bot.roles.highest.position) {
            return reply(i, 'Role Hierarchy', ['Move Rover above the target member’s highest role.']);
          }
          if (cmd === 'ban') await member.ban({ reason });
          else if (cmd === 'kick') await member.kick(reason);
          else if (cmd === 'timeout') await member.timeout(i.options.getInteger('minutes') * 60000, reason);
          else await member.timeout(null, reason);
          data.moderation.push({ id: makeId('mod'), action: cmd, targetId: target.id, moderatorId: i.user.id, reason, createdAt: Date.now() });
          await saveData();
          return reply(i, 'Moderation Completed', [`**Action:** ${cmd}`, `**Member:** ${target.tag}`, `**Reason:** ${reason}`]);
        }
      }
    }

    if (i.isStringSelectMenu()) {
      const cid = i.customId;
      const value = i.values[0];

      if (cid === 'rover:ticket:category') {
        if (!await requireAdmin(i)) return;
        data.ticketConfig.categoryId = value;
        data.ticketConfig.panelChannelId = i.channelId;
        await saveData();
        await publishTicketPanel(i.channel);
        return reply(i, 'Ticket Panel Published', ['Your Rover ticket panel has been posted.']);
      }

      if (cid === 'rover:purchase') {
        const p = productById(value);
        return p ? reply(i, 'Product Details', [
          `**${p.name}**`, p.description || 'No description provided.',
          `**Price:** ${p.price || 'Not set'}`,
          p.purchaseUrl && validUrl(p.purchaseUrl) ? `[Purchase link](${p.purchaseUrl})` : 'No valid purchase link is set.'
        ]) : reply(i, 'Product Not Found', ['This product no longer exists.']);
      }

      if (cid === 'rover:product:editselect') {
        if (!await requireAdmin(i)) return;
        const p = productById(value);
        if (!p) return reply(i, 'Product Not Found', ['Product not found.']);
        return i.showModal(productModal(p));
      }

      if (cid === 'rover:product:deleteselect') {
        if (!await requireAdmin(i)) return;
        const p = productById(value);
        if (!p) return reply(i, 'Product Not Found', ['Product not found.']);
        data.products = data.products.filter(x => x.id !== value);
        await saveData();
        return reply(i, 'Product Deleted', [`Deleted **${p.name}**.`]);
      }

      if (cid === 'rover:delivery:product') {
        if (!await requireAdmin(i)) return;
        const p = productById(value);
        if (!p) return reply(i, 'Product Not Found', ['Product not found.']);
        return i.reply(payload('Choose Customer', [`Product: **${p.name}**`], true, [
          new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder().setCustomId(`rover:delivery:customer:${p.id}`)
                .setPlaceholder('Choose customer').setMinValues(1).setMaxValues(1)
            )
          )
        ]));
      }

      if (cid === 'rover:review:product') {
        const p = productById(value);
        if (!p) return reply(i, 'Product Not Found', ['Product not found.']);
        const delivered = data.deliveries.some(d => d.productId === p.id && d.customerId === i.user.id);
        if (!delivered) return reply(i, 'Delivery Required', ['You can only review a product after staff have recorded its delivery.']);
        if (data.reviews.some(r => r.productId === p.id && r.userId === i.user.id)) {
          return reply(i, 'Review Already Submitted', ['You have already reviewed this product.']);
        }
        return i.showModal(new ModalBuilder().setCustomId(`rover:review:submit:${p.id}`)
          .setTitle('Submit Product Review')
          .addComponents(
            textInput('rating', 'Rating from 1 to 5', true, '', 1),
            textInput('review', 'Your review', true, '', 900, true)
          ));
      }
    }

    if (i.isUserSelectMenu() && i.customId.startsWith('rover:delivery:customer:')) {
      if (!await requireAdmin(i)) return;
      const p = productById(i.customId.split(':').pop());
      const customer = i.users.first();
      if (!p || !customer) return reply(i, 'Delivery Failed', ['Product or customer not found.']);
      data.deliveries.push({
        id: makeId('delivery'), productId: p.id, productName: p.name,
        customerId: customer.id, moderatorId: i.user.id, createdAt: Date.now()
      });
      await saveData();
      return reply(i, 'Delivery Recorded', [`**Product:** ${p.name}`, `**Customer:** ${customer.tag || customer.username}`]);
    }

    if (i.isButton()) {
      const parts = i.customId.split(':');
      if (i.customId === 'rover:ticket:open') {
        if (data.ticketBlacklist.includes(i.user.id)) {
          return reply(i, 'Ticket Access Restricted', ['You are currently blacklisted from opening support tickets. Contact a server administrator.']);
        }
        const categoryId = data.ticketConfig.categoryId;
        const category = categoryId ? i.guild.channels.cache.get(categoryId) : null;
        if (!category || category.type !== ChannelType.GuildCategory) {
          return reply(i, 'Ticket Setup Missing', ['An administrator needs to run `/ticket setup` again.']);
        }
        const existing = Object.values(data.tickets).find(t => t.openerId === i.user.id && i.guild.channels.cache.has(t.channelId));
        if (existing) return reply(i, 'Ticket Already Open', [`You already have a ticket: <#${existing.channelId}>`]);

        const supportId = staffRoleId('Support');
        const overwrites = [
          { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ];
        if (supportId) overwrites.push({ id: supportId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

        const channel = await i.guild.channels.create({
          name: `ticket-${clean(i.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-'), 70)}`,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: overwrites,
          reason: 'Rover support ticket'
        });

        const ticket = { channelId: channel.id, openerId: i.user.id, claimedBy: null, createdAt: Date.now() };
        data.tickets[channel.id] = ticket;
        await saveData();

        await channel.send({
          content: `${supportId ? `<@&${supportId}> ` : ''}<@${i.user.id}>`,
          components: [
            makePanel('Support Ticket', ['Please explain your issue clearly. Staff will respond as soon as possible.']),
            ticketControls(ticket)
          ],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { users: [i.user.id], roles: supportId ? [supportId] : [] }
        });
        return reply(i, 'Ticket Created', [`Your private ticket is ready: ${channel}`]);
      }

      if (parts[0] === 'rover' && parts[1] === 'ticket') {
        const action = parts[2];
        const channelId = parts[3];
        const ticket = data.tickets[channelId];
        if (!ticket) return reply(i, 'Ticket Not Found', ['This ticket is no longer recorded.']);
        const member = await i.guild.members.fetch(i.user.id).catch(() => null);
        const staff = canManageTickets(member);

        if (action === 'claim') {
          if (!staff) return reply(i, 'Staff Only', ['Only support staff can claim tickets.']);
          ticket.claimedBy = i.user.id;
          await saveData();
          await i.message.edit({ components: [ticketControls(ticket)] }).catch(() => {});
          return reply(i, 'Ticket Claimed', [`Claimed by ${i.user}.`]);
        }

        if (action === 'close') {
          if (!staff && ticket.openerId !== i.user.id) return reply(i, 'Not Allowed', ['Only the opener or staff can close this ticket.']);
          return i.reply(payload('Close Ticket?', ['Confirm below to delete this ticket channel.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`rover:ticket:closeconfirm:${channelId}`).setLabel('Confirm close').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('rover:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
              )
            )
          ]));
        }

        if (action === 'closeconfirm') {
          if (!staff && ticket.openerId !== i.user.id) return reply(i, 'Not Allowed', ['Only the opener or staff can close this ticket.']);
          await reply(i, 'Closing Ticket', ['This ticket will now be deleted.']);
          delete data.tickets[channelId];
          await saveData();
          const ch = i.guild.channels.cache.get(channelId);
          if (ch) await ch.delete('Ticket closed').catch(console.error);
          return;
        }

        if (action === 'mod') {
          if (!staff) return reply(i, 'Staff Only', ['Only staff can use the ticket moderator panel.']);
          return i.reply(payload('Ticket Moderator Panel', [
            `Ticket opener: <@${ticket.openerId}>`,
            ticket.claimedBy ? `Claimed by <@${ticket.claimedBy}>` : 'Ticket is unclaimed.'
          ], true, [ticketModControls(ticket)]));
        }

        if (action === 'escalate') {
          if (!staff) return reply(i, 'Staff Only', ['Only staff can escalate tickets.']);
          const adminId = staffRoleId('Administrator');
          if (!adminId) return reply(i, 'Administrator Role Missing', ['Run `/roles` first.']);
          await i.channel.send({ content: `<@&${adminId}> Ticket escalated by ${i.user}.`, allowedMentions: { roles: [adminId], users: [i.user.id] } });
          return reply(i, 'Ticket Escalated', ['Administrator role has been notified.']);
        }

        if (action === 'blacklist' || action === 'unblacklist') {
          if (!canBlacklistTickets(member)) return reply(i, 'Permission Required', ['Only Owners, Administrators and Moderators can blacklist or unblacklist ticket openers.']);
          const id = ticket.openerId;
          if (action === 'blacklist') {
            if (!data.ticketBlacklist.includes(id)) data.ticketBlacklist.push(id);
          } else {
            data.ticketBlacklist = data.ticketBlacklist.filter(x => x !== id);
          }
          await saveData();
          return reply(i, action === 'blacklist' ? 'Ticket Opener Blacklisted' : 'Ticket Opener Unblacklisted', [
            `<@${id}>`,
            action === 'blacklist' ? 'This member can no longer open tickets.' : 'This member can open tickets again.'
          ]);
        }

        if (action === 'rename') {
          if (!staff) return reply(i, 'Staff Only', ['Only staff can rename tickets.']);
          return i.showModal(new ModalBuilder().setCustomId(`rover:ticket:renamemodal:${channelId}`)
            .setTitle('Rename Ticket')
            .addComponents(textInput('name', 'New channel name', true, '', 90)));
        }

        if (action === 'add') {
          if (!staff) return reply(i, 'Staff Only', ['Only staff can add members.']);
          return i.reply(payload('Add Member', ['Choose a member to add to this ticket.'], true, [
            new ContainerBuilder().setAccentColor(PURPLE).addActionRowComponents(
              new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder().setCustomId(`rover:ticket:addmember:${channelId}`)
                  .setPlaceholder('Choose member').setMinValues(1).setMaxValues(1)
              )
            )
          ]));
        }
      }
    }

    if (i.isUserSelectMenu() && i.customId.startsWith('rover:ticket:addmember:')) {
      const channelId = i.customId.split(':').pop();
      const member = await i.guild.members.fetch(i.user.id).catch(() => null);
      if (!canManageTickets(member)) return reply(i, 'Staff Only', ['Only staff can add members.']);
      const user = i.users.first();
      const channel = i.guild.channels.cache.get(channelId);
      if (!user || !channel) return reply(i, 'Not Found', ['Member or ticket not found.']);
      await channel.permissionOverwrites.edit(user.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true
      });
      await channel.send(`${user} was added to this ticket by ${i.user}.`);
      return reply(i, 'Member Added', [`Added ${user} to the ticket.`]);
    }

    if (i.isModalSubmit()) {
      if (i.customId === 'rover:product:create' || i.customId.startsWith('rover:product:edit:')) {
        if (!await requireAdmin(i)) return;
        const p = {
          name: clean(i.fields.getTextInputValue('name'), 100),
          price: clean(i.fields.getTextInputValue('price'), 80),
          description: clean(i.fields.getTextInputValue('description'), 1000),
          purchaseUrl: clean(i.fields.getTextInputValue('url'), 300),
          category: clean(i.fields.getTextInputValue('category'), 20)
        };
        const cats = { assets: 'Assets', maps: 'Maps', scripts: 'Scripts' };
        if (!cats[p.category.toLowerCase()]) return reply(i, 'Invalid Category', ['Use Assets, Maps or Scripts.']);
        p.category = cats[p.category.toLowerCase()];
        if (p.purchaseUrl && !validUrl(p.purchaseUrl)) return reply(i, 'Invalid URL', ['Use a valid HTTP or HTTPS URL.']);

        if (i.customId === 'rover:product:create') {
          data.products.push({ id: makeId('product'), ...p, active: true, createdAt: Date.now() });
          await saveData();
          return reply(i, 'Product Created', [`Added **${p.name}**.`]);
        }

        const existing = productById(i.customId.split(':').pop());
        if (!existing) return reply(i, 'Product Not Found', ['Product not found.']);
        Object.assign(existing, p, { updatedAt: Date.now() });
        await saveData();
        return reply(i, 'Product Updated', [`Updated **${p.name}**.`]);
      }

      if (i.customId.startsWith('rover:review:submit:')) {
        const productId = i.customId.split(':').pop();
        const p = productById(productId);
        if (!p) return reply(i, 'Product Not Found', ['Product not found.']);
        const delivered = data.deliveries.some(d => d.productId === productId && d.customerId === i.user.id);
        if (!delivered) return reply(i, 'Delivery Required', ['Only customers with recorded deliveries can review this product.']);
        if (data.reviews.some(r => r.productId === productId && r.userId === i.user.id)) {
          return reply(i, 'Review Already Exists', ['You have already reviewed this product.']);
        }
        const rating = Number(i.fields.getTextInputValue('rating'));
        const text = clean(i.fields.getTextInputValue('review'), 900);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          return reply(i, 'Invalid Rating', ['Enter a rating from 1 to 5.']);
        }
        const channelId = data.reviewConfig.channelId;
        const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
        if (!channel?.isTextBased()) return reply(i, 'Review Channel Missing', ['An administrator must set the review channel with `/review-settings`.']);

        const review = {
          id: makeId('review'), productId, productName: p.name,
          userId: i.user.id, rating, text, createdAt: Date.now()
        };
        data.reviews.push(review);
        await saveData();
        await channel.send({
          components: [makePanel('Verified Product Review', [
            `**Product:** ${p.name}`,
            `**Rating:** ${'★'.repeat(rating)}${'☆'.repeat(5 - rating)} (${rating}/5)`,
            `**Customer:** <@${i.user.id}>`,
            text
          ])],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { users: [i.user.id] }
        });
        return reply(i, 'Review Submitted', ['Thank you. Your verified review has been posted.']);
      }

      if (i.customId.startsWith('rover:ticket:renamemodal:')) {
        const channelId = i.customId.split(':').pop();
        const member = await i.guild.members.fetch(i.user.id).catch(() => null);
        if (!canManageTickets(member)) return reply(i, 'Staff Only', ['Only staff can rename tickets.']);
        const name = clean(i.fields.getTextInputValue('name'), 90).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        if (!name) return reply(i, 'Invalid Name', ['Enter a valid channel name.']);
        const channel = i.guild.channels.cache.get(channelId);
        if (!channel) return reply(i, 'Ticket Not Found', ['Ticket not found.']);
        await channel.setName(name);
        return reply(i, 'Ticket Renamed', [`The ticket is now called **${name}**.`]);
      }
    }
  } catch (e) {
    console.error('Interaction error:', e);
    const msg = {
      content: 'Rover encountered an error. Please try again or contact an administrator.',
      flags: MessageFlags.Ephemeral
    };
    try {
      if (i.isRepliable()) {
        if (i.deferred || i.replied) await i.followUp(msg);
        else await i.reply(msg);
      }
    } catch {}
  }
});

client.login(TOKEN).catch(e => {
  console.error('Discord login failed:', e);
  process.exit(1);
});
