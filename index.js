const { Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const fetch = require('node-fetch');
const http  = require('http');
require('dotenv').config();

http.createServer((req, res) => { res.writeHead(200); res.end('ServerCreator online!'); })
  .listen(process.env.PORT || 3000, () => console.log('✅ HTTP ativo'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

async function generateServerStructure(prompt) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      max_tokens:  3000,
      temperature: 0.3,
      messages: [
        {
          role:    'system',
          content: 'You are a Discord server architect. Generate complete server structures in JSON. Respond ONLY with valid JSON, no markdown, no extra text.'
        },
        {
          role:    'user',
          content: `Create a complete Discord server structure for: "${prompt}"\n\nRespond ONLY with this JSON:\n{"roles":[{"name":"Role Name","color":"#hex","permissions":["ADMINISTRATOR"]}],"categories":[{"name":"CATEGORY NAME","channels":[{"name":"channel-name","type":"text","topic":"Channel topic","allowedRoles":["Role Name"]}]}],"welcomeMessage":"Welcome message"}`
        }
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  let raw = data.choices[0].message.content.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou estrutura válida.');
  return JSON.parse(raw.substring(start, end + 1));
}

async function applyStructure(guild, structure, onStep) {
  await onStep('🗑️', 'Removendo canais existentes...');
  const channels = await guild.channels.fetch();
  for (const [, ch] of channels) await ch.delete().catch(() => {});

  await onStep('🗑️', 'Removendo cargos existentes...');
  const roles = await guild.roles.fetch();
  for (const [, role] of roles) {
    if (!role.managed && role.name !== '@everyone') await role.delete().catch(() => {});
  }

  await onStep('👥', 'Criando cargos...');
  const createdRoles = new Map();
  for (const roleData of structure.roles || []) {
    try {
      const role = await guild.roles.create({
        name:        roleData.name,
        color:       roleData.color || '#99aab5',
        permissions: buildPermissions(roleData.permissions || []),
        reason:      'ServerCreator',
      });
      createdRoles.set(roleData.name, role);
      await onStep('✅', `Cargo: **${roleData.name}**`);
    } catch (e) { console.error(e.message); }
  }

  for (const category of structure.categories || []) {
    await onStep('📁', `Categoria: **${category.name}**`);
    const cat = await guild.channels.create({ name: category.name, type: ChannelType.GuildCategory });

    for (const ch of category.channels || []) {
      try {
        const type = ch.type === 'voice' ? ChannelType.GuildVoice :
                     ch.type === 'announcement' ? ChannelType.GuildAnnouncement :
                     ChannelType.GuildText;

        const overwrites = ch.allowedRoles?.length > 0
          ? [
              { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
              ...ch.allowedRoles.map(r => createdRoles.get(r)).filter(Boolean).map(r => ({
                id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
              }))
            ]
          : [{ id: guild.id, allow: [PermissionFlagsBits.ViewChannel] }];

        await guild.channels.create({ name: ch.name, type, topic: ch.topic || '', parent: cat.id, permissionOverwrites: overwrites });
        await onStep('💬', `Canal: **#${ch.name}**`);
      } catch (e) { console.error(e.message); }
    }
  }

  if (structure.welcomeMessage) {
    const first = guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (first) await first.send(structure.welcomeMessage).catch(() => {});
  }
}

function buildPermissions(perms) {
  const map = {
    ADMINISTRATOR:        PermissionFlagsBits.Administrator,
    MANAGE_GUILD:         PermissionFlagsBits.ManageGuild,
    MANAGE_CHANNELS:      PermissionFlagsBits.ManageChannels,
    MANAGE_ROLES:         PermissionFlagsBits.ManageRoles,
    KICK_MEMBERS:         PermissionFlagsBits.KickMembers,
    BAN_MEMBERS:          PermissionFlagsBits.BanMembers,
    SEND_MESSAGES:        PermissionFlagsBits.SendMessages,
    READ_MESSAGE_HISTORY: PermissionFlagsBits.ReadMessageHistory,
    VIEW_CHANNEL:         PermissionFlagsBits.ViewChannel,
  };
  return perms.reduce((acc, p) => map[p] ? acc | map[p] : acc, 0n);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'criar_servidor') return;

  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Você precisa ser **Administrador**!', ephemeral: true });
  }

  const prompt = interaction.options.getString('prompt');
  const steps  = [];
  const guild  = interaction.guild;

  await interaction.reply({ embeds: [buildEmbed(prompt, steps)] });

  const update = async (icon, msg) => {
    steps.push(`${icon} ${msg}`);
    await interaction.editReply({ embeds: [buildEmbed(prompt, steps)] }).catch(() => {});
  };

  try {
    await update('🧠', 'Analisando prompt...');
    await update('⚙️', 'Gerando estrutura com IA...');
    const structure = await generateServerStructure(prompt);
    await update('📋', `${structure.roles?.length || 0} cargos, ${structure.categories?.length || 0} categorias`);
    await update('🚀', 'Aplicando no servidor...');
    await applyStructure(guild, structure, update);
    await update('✅', 'Pronto!');
  } catch (err) {
    console.error(err);
    await interaction.editReply({
      embeds: [new EmbedBuilder().setTitle('❌ Erro').setColor(0xe74c3c)
        .setDescription(`\`\`\`${err.message}\`\`\``)
        .setFooter({ text: 'Tente reformular o prompt.' })]
    }).catch(() => {});
  }
});

function buildEmbed(prompt, steps) {
  const log = steps.length > 0
    ? steps.map((s, i) => i === steps.length - 1 ? `▶ ${s}` : `✔ ${s}`).join('\n')
    : '▶ Aguardando...';
  return new EmbedBuilder()
    .setTitle('🏗️ ServerCreator — Construindo...')
    .setColor(0x9b59b6)
    .addFields(
      { name: '📋 Prompt',    value: prompt, inline: false },
      { name: '📊 Progresso', value: `\`\`\`\n${log}\n\`\`\``, inline: false },
    )
    .setFooter({ text: 'ServerCreator • Powered by Alzhayds' })
    .setTimestamp();
}

client.once('ready', async () => {
  console.log(`✅ Online como ${client.user.tag}`);
  client.user.setActivity('/criar_servidor | ServerCreator', { type: 3 });
  const commands = [
    new SlashCommandBuilder()
      .setName('criar_servidor')
      .setDescription('Cria um servidor completo com IA')
      .addStringOption(opt =>
        opt.setName('prompt')
          .setDescription('Descreva o servidor (ex: Comunidade Brasileira de Games)')
          .setRequired(true))
      .toJSON()
  ];
  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Comandos registrados!');
});

client.login(process.env.DISCORD_TOKEN);
