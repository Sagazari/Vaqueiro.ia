const { Client, GatewayIntentBits, PermissionFlagsBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const Groq = require('groq-sdk').default || require('groq-sdk');
const http = require('http');
require('dotenv').config();

// ── Keep alive ─────────────────────────────────────────────────────────────────
http.createServer((req, res) => { res.writeHead(200); res.end('ServerCreator online!'); })
  .listen(process.env.PORT || 3000, () => console.log('✅ HTTP ativo'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Gera estrutura do servidor via Groq ────────────────────────────────────────
async function generateServerStructure(prompt) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 3000,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `You are a Discord server architect. Generate complete server structures in JSON. Respond ONLY with valid JSON, no markdown, no extra text.`
      },
      {
        role: 'user',
        content: `Create a complete Discord server structure for: "${prompt}"

Respond ONLY with this JSON format:
{
  "roles": [
    { "name": "Role Name", "color": "#hex", "permissions": ["ADMINISTRATOR"] }
  ],
  "categories": [
    {
      "name": "CATEGORY NAME",
      "channels": [
        { "name": "channel-name", "type": "text", "topic": "Channel topic", "allowedRoles": ["Role Name"] }
      ]
    }
  ],
  "welcomeMessage": "Welcome message for the server"
}

Permission options: ADMINISTRATOR, MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES, KICK_MEMBERS, BAN_MEMBERS, SEND_MESSAGES, READ_MESSAGE_HISTORY, VIEW_CHANNEL
Channel types: text, voice, announcement`
      }
    ],
  });

  let raw = response.choices[0].message.content.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('IA não retornou estrutura válida.');
  return JSON.parse(raw.substring(start, end + 1));
}

// ── Aplica estrutura no servidor ───────────────────────────────────────────────
async function applyStructure(guild, structure, onStep) {

  // 1. Apaga todos os canais
  await onStep('🗑️', 'Removendo canais existentes...');
  const channels = await guild.channels.fetch();
  for (const [, channel] of channels) {
    await channel.delete().catch(() => {});
  }

  // 2. Apaga todos os cargos (exceto @everyone e bot)
  await onStep('🗑️', 'Removendo cargos existentes...');
  const roles = await guild.roles.fetch();
  for (const [, role] of roles) {
    if (!role.managed && role.name !== '@everyone') {
      await role.delete().catch(() => {});
    }
  }

  // 3. Cria cargos
  await onStep('👥', 'Criando cargos...');
  const createdRoles = new Map();
  for (const roleData of structure.roles || []) {
    try {
      const perms = buildPermissions(roleData.permissions || []);
      const role  = await guild.roles.create({
        name:        roleData.name,
        color:       roleData.color || '#99aab5',
        permissions: perms,
        reason:      'ServerCreator Bot',
      });
      createdRoles.set(roleData.name, role);
      await onStep('✅', `Cargo criado: **${roleData.name}**`);
    } catch (e) { console.error(`Erro ao criar cargo ${roleData.name}:`, e.message); }
  }

  // 4. Cria categorias e canais
  for (const category of structure.categories || []) {
    await onStep('📁', `Criando categoria: **${category.name}**`);

    const cat = await guild.channels.create({
      name: category.name,
      type: ChannelType.GuildCategory,
    });

    for (const ch of category.channels || []) {
      try {
        const type = ch.type === 'voice'        ? ChannelType.GuildVoice :
                     ch.type === 'announcement' ? ChannelType.GuildAnnouncement :
                     ChannelType.GuildText;

        // Build permission overwrites
        const overwrites = [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // deny @everyone by default if restricted
        ];

        if (ch.allowedRoles && ch.allowedRoles.length > 0) {
          for (const roleName of ch.allowedRoles) {
            const role = createdRoles.get(roleName);
            if (role) {
              overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
            }
          }
        } else {
          // Public channel
          overwrites.push({ id: guild.id, allow: [PermissionFlagsBits.ViewChannel] });
        }

        await guild.channels.create({
          name:                ch.name,
          type,
          topic:               ch.topic || '',
          parent:              cat.id,
          permissionOverwrites: overwrites,
        });

        await onStep('💬', `Canal criado: **#${ch.name}**`);
      } catch (e) { console.error(`Erro canal ${ch.name}:`, e.message); }
    }
  }

  // 5. Manda mensagem de boas vindas no primeiro canal de texto
  if (structure.welcomeMessage) {
    await onStep('📨', 'Enviando mensagem de boas vindas...');
    const firstText = guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (firstText) {
      await firstText.send(structure.welcomeMessage).catch(() => {});
    }
  }
}

// ── Monta permissões ───────────────────────────────────────────────────────────
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

// ── Interactions ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'criar_servidor') return;

  // Verifica permissão
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Você precisa ser **Administrador** para usar este comando!', ephemeral: true });
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

    await update('📋', `Estrutura gerada! ${structure.roles?.length || 0} cargos, ${structure.categories?.length || 0} categorias`);
    await update('🚀', 'Aplicando no servidor...');

    await applyStructure(guild, structure, update);

    await update('✅', 'Servidor criado com sucesso!');

    // Final embed — busca primeiro canal de texto disponível
    const firstChannel = guild.channels.cache.find(c => c.type === ChannelType.GuildText);

    const finalEmbed = new EmbedBuilder()
      .setTitle('✅ Servidor Criado!')
      .setColor(0x2ecc71)
      .addFields(
        { name: '📋 Prompt',     value: prompt,                              inline: false },
        { name: '👥 Cargos',     value: String(structure.roles?.length || 0),     inline: true  },
        { name: '📁 Categorias', value: String(structure.categories?.length || 0), inline: true  },
      )
      .setFooter({ text: 'ServerCreator • Powered by Alzhayds' })
      .setTimestamp();

    if (firstChannel) {
      await firstChannel.send({ embeds: [finalEmbed] }).catch(() => {});
    }

  } catch (err) {
    console.error(err);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Erro')
        .setColor(0xe74c3c)
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
      { name: '📋 Prompt',     value: prompt, inline: false },
      { name: '📊 Progresso', value: `\`\`\`\n${log}\n\`\`\``, inline: false },
    )
    .setFooter({ text: 'ServerCreator • Powered by Alzhayds' })
    .setTimestamp();
}

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Online como ${client.user.tag}`);
  client.user.setActivity('/criar_servidor | ServerCreator', { type: 3 });

  const commands = [
    new SlashCommandBuilder()
      .setName('criar_servidor')
      .setDescription('Cria um servidor completo com IA baseado no seu prompt')
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
