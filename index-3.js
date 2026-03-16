const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Groq = require('groq-sdk').default || require('groq-sdk');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const groq   = new Groq({ apiKey: process.env.GROQ_API_KEY });

client.once('ready', async () => {
  console.log(`✅ Online como ${client.user.tag}`);
  client.user.setActivity('/gerar | ScriptGenerator', { type: 3 });

  const commands = [
    new SlashCommandBuilder()
      .setName('gerar')
      .setDescription('Gera um sistema completo com IA')
      .addStringOption(opt =>
        opt.setName('prompt')
          .setDescription('Descreva o sistema (ex: Sistema de Goleiro Roblox)')
          .setRequired(true))
      .addStringOption(opt =>
        opt.setName('linguagem')
          .setDescription('Linguagem (padrão: Luau)')
          .setRequired(false)
          .addChoices(
            { name: '🟡 Luau (Roblox)', value: 'luau'       },
            { name: '🐍 Python',        value: 'python'     },
            { name: '🟨 JavaScript',    value: 'javascript' },
            { name: '🔷 TypeScript',    value: 'typescript' },
          ))
      .toJSON()
  ];

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Comandos registrados!');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'gerar') return;

  const prompt   = interaction.options.getString('prompt');
  const language = interaction.options.getString('linguagem') || 'luau';
  const steps    = [];

  await interaction.reply({ embeds: [buildEmbed(prompt, language, steps)] });

  const update = async (icon, msg) => {
    steps.push(`${icon} ${msg}`);
    await interaction.editReply({ embeds: [buildEmbed(prompt, language, steps)] }).catch(() => {});
  };

  try {
    await update('⚙️', 'Iniciando geração...');
    await update('🧠', `Analisando sistema: ${prompt}`);

    // Pede pra IA primeiro planejar as partes do sistema
    const planResponse = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 500,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'You are a software architect. Respond ONLY with valid JSON, no markdown.'
        },
        {
          role: 'user',
          content: `List the main components/parts you will build for a "${prompt}" system in ${language}. Respond ONLY with JSON:\n{"parts":["Part name 1","Part name 2","Part name 3"]}`
        }
      ],
    });

    let planRaw = planResponse.choices[0].message.content.trim();
    planRaw = planRaw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim();
    const ps = planRaw.indexOf('{'), pe = planRaw.lastIndexOf('}');
    const parts = ps !== -1 && pe !== -1 ? JSON.parse(planRaw.substring(ps, pe+1)).parts || [] : [];

    // Mostra cada parte sendo "construída"
    for (const part of parts) {
      await update('🔨', `Fazendo ${part}...`);
      await new Promise(r => setTimeout(r, 600));
    }

    await update('📦', 'Finalizando e empacotando arquivos...');

    // Agora gera o sistema completo
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 8000,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You are an expert ${language} developer. ALWAYS respond with valid JSON only, no markdown, no extra text.`
        },
        {
          role: 'user',
          content: `Create a complete "${prompt}" system in ${language}. Respond ONLY with this JSON:\n{"summary":"description","files":[{"name":"FileName.ext","description":"what this does","content":"full code here"}]}`
        }
      ],
    });

    let raw = response.choices[0].message.content.trim();
    raw = raw.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/```$/i,'').trim();
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('IA não retornou JSON válido. Tente novamente.');
    const parsed = JSON.parse(raw.substring(start, end+1));
    const files  = parsed.files || [];

    for (const file of files) {
      await update('🗂️', `Salvando arquivo: \`${file.name}\``);
      await new Promise(r => setTimeout(r, 300));
    }

    await update('✅', `${files.length} arquivo(s) prontos!`);

    const attachments = files.map(f =>
      new AttachmentBuilder(Buffer.from(f.content), { name: f.name })
    );

    const finalEmbed = new EmbedBuilder()
      .setTitle('✅ Sistema Gerado!')
      .setColor(0x2ecc71)
      .addFields(
        { name: '📋 Prompt',    value: prompt,                                                         inline: false },
        { name: '💻 Linguagem', value: language,                                                       inline: true  },
        { name: '📦 Arquivos',  value: String(files.length),                                           inline: true  },
        { name: '📁 Arquivos',  value: files.map(f => `\`${f.name}\` — ${f.description}`).join('\n'), inline: false },
        { name: '📝 Resumo',    value: parsed.summary || 'Gerado com sucesso.',                        inline: false },
      )
      .setFooter({ text: 'ScriptGenerator • Powered by Alzhayds' })
      .setTimestamp();

    await interaction.editReply({ embeds: [finalEmbed], files: attachments.slice(0, 10) });

  } catch (err) {
    console.error(err);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Erro')
          .setColor(0xe74c3c)
          .setDescription(`\`\`\`${err.message}\`\`\``)
          .setFooter({ text: 'Tente reformular o prompt.' })
      ]
    }).catch(() => {});
  }
});

function buildEmbed(prompt, language, steps) {
  const log = steps.length > 0
    ? steps.map((s, i) => i === steps.length - 1 ? `▶ ${s}` : `✔ ${s}`).join('\n')
    : '▶ Aguardando...';

  return new EmbedBuilder()
    .setTitle('🤖 ScriptGenerator — Gerando...')
    .setColor(0x3498db)
    .addFields(
      { name: '📋 Prompt',    value: prompt,   inline: true },
      { name: '💻 Linguagem', value: language, inline: true },
      { name: '📊 Progresso', value: `\`\`\`\n${log}\n\`\`\``, inline: false },
    )
    .setFooter({ text: 'ScriptGenerator • Powered by Alzhayds' })
    .setTimestamp();
}

client.login(process.env.DISCORD_TOKEN);
