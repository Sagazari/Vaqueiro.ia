const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const fetch = require('node-fetch');
const http  = require('http');
require('dotenv').config();

// ── Keep alive (Render + UptimeRobot) ─────────────────────────────────────────
http.createServer((req, res) => { res.writeHead(200); res.end('MusicGenerator online!'); })
  .listen(process.env.PORT || 3000, () => console.log('✅ HTTP ativo'));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const HF_TOKEN = process.env.HF_TOKEN;
const API_URL  = 'https://api-inference.huggingface.co/models/facebook/musicgen-small';

const ESTILOS = {
  lofi:     'lofi hip hop, relaxing, chill, lo-fi beats, study music',
  funk:     'brazilian funk, baile funk, heavy bass, 150bpm, party',
  trap:     'trap beat, 808 bass, hi-hats, dark, aggressive',
  samba:    'samba, brazilian rhythm, percussion, acoustic guitar',
  eletroni: 'electronic dance music, EDM, synth, 128bpm, energetic',
  rock:     'rock, electric guitar, drums, powerful, energetic',
  classico: 'classical music, orchestra, piano, elegant, peaceful',
  pagode:   'pagode, brazilian pagode, cavaquinho, tamborim, happy',
};

async function generateMusic(prompt, style, onStep) {
  const fullPrompt = style ? `${ESTILOS[style]}, ${prompt}` : prompt;

  if (onStep) await onStep('🎵', 'Compondo a música...');

  let attempts = 0;
  while (attempts < 5) {
    const response = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        inputs: fullPrompt,
        parameters: { max_new_tokens: 256 },
      }),
    });

    if (response.status === 503) {
      attempts++;
      if (onStep) await onStep('⏳', `Modelo carregando... (${attempts}/5)`);
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Hugging Face error ${response.status}: ${err}`);
    }

    if (onStep) await onStep('🎚️', 'Finalizando produção...');
    return await response.buffer();
  }

  throw new Error('Modelo demorou demais. Tente novamente em alguns segundos.');
}

function buildEmbed(prompt, style, steps) {
  const log = steps.length > 0
    ? steps.map((s, i) => i === steps.length - 1 ? `▶ ${s}` : `✔ ${s}`).join('\n')
    : '▶ Aguardando...';

  return new EmbedBuilder()
    .setTitle('🎵 MusicGenerator — Gerando...')
    .setColor(0x1db954)
    .addFields(
      { name: '📋 Prompt', value: prompt,                    inline: true },
      { name: '🎨 Estilo', value: style || 'Livre',          inline: true },
      { name: '📊 Progresso', value: `\`\`\`\n${log}\n\`\`\``, inline: false },
    )
    .setFooter({ text: 'MusicGenerator • Powered by Alzhayds' })
    .setTimestamp();
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'gerar') return;

  const prompt = interaction.options.getString('prompt');
  const style  = interaction.options.getString('estilo') || null;
  const steps  = [];

  await interaction.reply({ embeds: [buildEmbed(prompt, style || 'Livre', steps)] });

  const update = async (icon, msg) => {
    steps.push(`${icon} ${msg}`);
    await interaction.editReply({ embeds: [buildEmbed(prompt, style || 'Livre', steps)] }).catch(() => {});
  };

  try {
    await update('⚙️', 'Iniciando geração...');
    await update('🎼', `Estilo: ${style || 'Livre'}`);

    const audioBuffer = await generateMusic(prompt, style, update);

    await update('✅', 'Música gerada!');
    await update('📤', 'Enviando arquivo...');

    const attachment = new AttachmentBuilder(audioBuffer, { name: 'musica.wav' });

    const finalEmbed = new EmbedBuilder()
      .setTitle('✅ Música Gerada!')
      .setColor(0x1db954)
      .addFields(
        { name: '📋 Prompt', value: prompt,           inline: false },
        { name: '🎨 Estilo', value: style || 'Livre', inline: true  },
        { name: '📁 Arquivo', value: '`musica.wav`',  inline: true  },
      )
      .setFooter({ text: 'MusicGenerator • Powered by Alzhayds' })
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed], files: [attachment] });

  } catch (err) {
    console.error(err);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Erro na Geração')
        .setColor(0xe74c3c)
        .setDescription(`\`\`\`${err.message}\`\`\``)
        .addFields({ name: '💡 Dica', value: 'Se o modelo estiver carregando, aguarde 30s e tente novamente.' })
        .setFooter({ text: 'MusicGenerator • Powered by Alzhayds' })]
    }).catch(() => {});
  }
});

client.once('ready', async () => {
  console.log(`✅ Online como ${client.user.tag}`);
  client.user.setActivity('/gerar | MusicGenerator', { type: 3 });

  const commands = [
    new SlashCommandBuilder()
      .setName('gerar')
      .setDescription('Gera uma música com IA')
      .addStringOption(opt =>
        opt.setName('prompt')
          .setDescription('Descreva a música (ex: chill beat para estudar)')
          .setRequired(true))
      .addStringOption(opt =>
        opt.setName('estilo')
          .setDescription('Estilo musical (opcional)')
          .setRequired(false)
          .addChoices(
            { name: '😌 Lo-fi',        value: 'lofi'     },
            { name: '🇧🇷 Funk BR',     value: 'funk'     },
            { name: '🔥 Trap',         value: 'trap'     },
            { name: '🥁 Samba',        value: 'samba'    },
            { name: '⚡ Eletrônico',   value: 'eletroni' },
            { name: '🎸 Rock',         value: 'rock'     },
            { name: '🎻 Clássico',     value: 'classico' },
            { name: '🎶 Pagode',       value: 'pagode'   },
          ))
      .toJSON()
  ];

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Comandos registrados!');
});

client.login(process.env.DISCORD_TOKEN);
