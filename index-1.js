const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Groq = require('groq-sdk');
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
    await update('🧠', `Analisando: ${prompt}`);
    await update('📡', 'Conectando com Groq AI...');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 8000,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `You are an expert ${language} developer. Write clean, professional, well-commented code. For Luau, follow Roblox best practices. ALWAYS respond with valid JSON only, no extra text.`
        },
        {
          role: 'user',
          content: `Create a complete "${prompt}" system in ${language}. Respond ONLY with this JSON (no markdown, no backticks, no extra text before or after):\n{"summary":"description","files":[{"name":"FileName.ext","description":"what this does","content":"full code here"}]}`
        }
      ],
    });

    let raw = response.choices[0].message.content.trim();

    // Strip any markdown fences
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

    // Find JSON boundaries safely
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('IA não retornou JSON válido. Tente novamente.');
    raw = raw.substring(start, end + 1);

    const parsed = JSON.parse(raw);
    const files  = parsed.files || [];

    for (const file of files) {
      await update('🗂️', `Criando arquivo: \`${file.name}\``);
      await new Promise(r => setTimeout(r, 300));
    }

    await update('✅', `${files.length} arquivo(s) gerado(s)!`);

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
      .setFooter({ text: 'ScriptGenerator • Powered by Groq AI' })
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
    .setFooter({ text: 'ScriptGenerator • Powered by Groq AI' })
    .setTimestamp();
}

client.login(process.env.DISCORD_TOKEN);
