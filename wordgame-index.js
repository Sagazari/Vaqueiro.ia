const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Groq     = require('groq-sdk').default || require('groq-sdk');
const Database = require('better-sqlite3');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const db   = new Database('game.db');

// ── Database ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS topglobal (
    userId   TEXT PRIMARY KEY,
    username TEXT,
    wins     INTEGER DEFAULT 0,
    words    INTEGER DEFAULT 0
  );
`);

// ── Active games { channelId: gameState } ─────────────────────────────────────
const games = new Map();

// ── Generate word via Groq ─────────────────────────────────────────────────────
async function generateWord(round) {
  const difficulty =
    round <= 3  ? 'very easy, all uppercase, like GATO or CASA' :
    round <= 6  ? 'medium, mixed case like SaBoneTe or CaRrO' :
    round <= 9  ? 'hard, tricky mixed case like shAMpOO or pAtInS' :
                  'very hard, random caps like pRoFeSsOr or BiCiClEtA';

  const res = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 20,
    temperature: 0.95,
    messages: [
      { role: 'system', content: 'You generate single words for a typing game. Respond ONLY with the word. No punctuation, no explanation, nothing else.' },
      { role: 'user',   content: `Generate one ${difficulty} Brazilian Portuguese word. Round ${round}. Just the word.` },
    ],
  });

  return res.choices[0].message.content.trim().replace(/[^a-zA-ZÀ-ú]/g, '');
}

function formatLives(lives) {
  return '❤️'.repeat(lives) + '🖤'.repeat(3 - lives);
}

// ── Round logic ────────────────────────────────────────────────────────────────
async function startRound(channel, gs) {
  if (!gs.active) return;

  const alive = [...gs.players.values()].filter(p => p.lives > 0);
  if (alive.length <= 1) return endGame(channel, gs);

  gs.round++;
  const word  = await generateWord(gs.round);
  gs.word     = word;
  gs.answered = false;
  gs.roundAnswered = new Set();

  const embed = new EmbedBuilder()
    .setTitle(`⌨️ RODADA ${gs.round}`)
    .setColor(0x3498db)
    .setDescription(`# ${word}`)
    .addFields({
      name:  '👥 Jogadores',
      value: alive.map(p => `**${p.username}** ${formatLives(p.lives)}`).join('\n'),
    })
    .setFooter({ text: 'Digite a palavra EXATAMENTE como aparece! Você tem 30 segundos.' })
    .setTimestamp();

  await channel.send({ embeds: [embed] });

  const collector = channel.createMessageCollector({
    filter: m => gs.players.has(m.author.id) && gs.players.get(m.author.id).lives > 0,
    time:   30000,
  });

  gs.collector = collector;

  collector.on('collect', async msg => {
    if (!gs.active) return;
    const player = gs.players.get(msg.author.id);
    if (!player || gs.roundAnswered.has(msg.author.id)) return;

    if (msg.content === gs.word) {
      gs.roundAnswered.add(msg.author.id);
      player.words++;
      await msg.react('✅');

      if (!gs.answered) {
        gs.answered = true;
        // update words in db
        db.prepare(`INSERT INTO topglobal (userId, username, wins, words) VALUES (?, ?, 0, 1)
          ON CONFLICT(userId) DO UPDATE SET words = words + 1, username = ?`)
          .run(msg.author.id, msg.author.username, msg.author.username);
      }
    } else {
      gs.roundAnswered.add(msg.author.id);
      player.lives--;
      await msg.react('❌');
      if (player.lives <= 0) {
        await channel.send(`💀 **${player.username}** ficou sem vidas e foi **eliminado!**`);
      }
    }
  });

  collector.on('end', async () => {
    if (!gs.active) return;

    // Penalize players who didn't answer
    for (const [id, player] of gs.players) {
      if (player.lives > 0 && !gs.roundAnswered.has(id)) {
        player.lives--;
        if (player.lives <= 0) {
          await channel.send(`💀 **${player.username}** não respondeu a tempo e foi **eliminado!**`);
        }
      }
    }

    await new Promise(r => setTimeout(r, 2000));
    startRound(channel, gs);
  });
}

async function endGame(channel, gs) {
  gs.active = false;
  games.delete(channel.id);

  const alive  = [...gs.players.values()].filter(p => p.lives > 0);
  const winner = alive[0] || null;

  if (winner) {
    db.prepare(`INSERT INTO topglobal (userId, username, wins, words) VALUES (?, ?, 1, ?)
      ON CONFLICT(userId) DO UPDATE SET wins = wins + 1, username = ?, words = words + ?`)
      .run(winner.userId, winner.username, winner.words, winner.username, winner.words);
  }

  const embed = new EmbedBuilder()
    .setTitle('🏆 Fim de Jogo!')
    .setColor(0xf1c40f)
    .setDescription(winner ? `🥇 **${winner.username}** venceu a partida!` : '😮 Ninguém sobreviveu!')
    .addFields({
      name:  '📊 Resultado Final',
      value: [...gs.players.values()]
        .map(p => `**${p.username}** ${formatLives(p.lives)} — ⌨️ ${p.words} palavras`)
        .join('\n'),
    })
    .setFooter({ text: 'Use /topglobal para ver o ranking! • Powered by Alzhayds' })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

// ── Interactions ───────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, channelId, channel } = interaction;

  if (commandName === 'jogar') {
    if (games.has(channelId)) return interaction.reply({ content: '⚠️ Já existe uma partida neste canal!', ephemeral: true });

    const gs = { host: user.id, active: false, started: false, round: 0, word: '', players: new Map() };
    gs.players.set(user.id, { userId: user.id, username: user.username, lives: 3, words: 0 });
    games.set(channelId, gs);

    const embed = new EmbedBuilder()
      .setTitle('🎮 Partida Criada!')
      .setColor(0x2ecc71)
      .setDescription(`**${user.username}** criou uma partida!\n\nUse **/entrar** para participar!\nUse **/iniciar** para começar!`)
      .addFields({ name: '👥 Jogadores (1)', value: `• ${user.username}` })
      .setFooter({ text: 'Mínimo 2 jogadores.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === 'entrar') {
    const gs = games.get(channelId);
    if (!gs)          return interaction.reply({ content: '❌ Nenhuma partida neste canal. Use **/jogar**!', ephemeral: true });
    if (gs.started)   return interaction.reply({ content: '⚠️ A partida já começou!', ephemeral: true });
    if (gs.players.has(user.id)) return interaction.reply({ content: '⚠️ Você já está na partida!', ephemeral: true });

    gs.players.set(user.id, { userId: user.id, username: user.username, lives: 3, words: 0 });
    const list = [...gs.players.values()].map(p => `• ${p.username}`).join('\n');

    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('✅ Jogador Entrou!').setColor(0x2ecc71)
        .setDescription(`**${user.username}** entrou!`)
        .addFields({ name: `👥 Jogadores (${gs.players.size})`, value: list })
        .setTimestamp()],
    });
  }

  else if (commandName === 'iniciar') {
    const gs = games.get(channelId);
    if (!gs)                   return interaction.reply({ content: '❌ Nenhuma partida neste canal!', ephemeral: true });
    if (gs.host !== user.id)   return interaction.reply({ content: '❌ Apenas o criador pode iniciar!', ephemeral: true });
    if (gs.started)            return interaction.reply({ content: '⚠️ Já começou!', ephemeral: true });
    if (gs.players.size < 2)   return interaction.reply({ content: '❌ Precisa de pelo menos **2 jogadores**!', ephemeral: true });

    gs.started = true;
    gs.active  = true;
    await interaction.reply({ content: '🚀 **A partida vai começar! Preparem-se...**' });
    await new Promise(r => setTimeout(r, 2000));
    startRound(channel, gs);
  }

  else if (commandName === 'topglobal') {
    const rows = db.prepare('SELECT * FROM topglobal ORDER BY wins DESC, words DESC LIMIT 10').all();
    const list = rows.length > 0
      ? rows.map((r, i) => `**${i + 1}.** ${r.username} — 🏆 ${r.wins} vitórias | ⌨️ ${r.words} palavras`).join('\n')
      : '_Nenhum jogador ainda._';

    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle('🏆 Top Global — Jogo de Palavras').setColor(0xf1c40f)
        .setDescription(list).setFooter({ text: 'Powered by Alzhayds' }).setTimestamp()],
    });
  }

  else if (commandName === 'sair') {
    const gs = games.get(channelId);
    if (!gs)                 return interaction.reply({ content: '❌ Nenhuma partida ativa!', ephemeral: true });
    if (gs.host !== user.id) return interaction.reply({ content: '❌ Apenas o criador pode encerrar!', ephemeral: true });
    if (gs.collector) gs.collector.stop();
    gs.active = false;
    games.delete(channelId);
    await interaction.reply({ content: '🛑 Partida encerrada.' });
  }
});

// ── Ready ──────────────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Online como ${client.user.tag}`);
  client.user.setActivity('/jogar | WordGame', { type: 3 });

  const commands = [
    new SlashCommandBuilder().setName('jogar').setDescription('Cria uma partida do jogo de palavras!'),
    new SlashCommandBuilder().setName('entrar').setDescription('Entra na partida atual!'),
    new SlashCommandBuilder().setName('iniciar').setDescription('Inicia a partida!'),
    new SlashCommandBuilder().setName('topglobal').setDescription('Veja o ranking global!'),
    new SlashCommandBuilder().setName('sair').setDescription('Encerra a partida atual.'),
  ].map(c => c.toJSON());

  const rest = new REST().setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('✅ Comandos registrados!');
});

client.login(process.env.DISCORD_TOKEN);
