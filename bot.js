const {
  Client, GatewayIntentBits, Events,
  REST, Routes, SlashCommandBuilder, EmbedBuilder
} = require("discord.js");
const http = require("http");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const canaisAtivos = new Set();
const idiomasPorServidor = new Map();
const historicos = new Map();

const prompts = {
  pt: `Você é o Vaqueiro — uma IA inteligente e parceiro de conversa. Tem personalidade própria, é natural e espontâneo.

COMO VOCÊ FALA:
- Fala como brasileiro de verdade, sem gramática perfeita — "tô", "tá", "né", "cara", "mano", "ow", "véi"
- Gírias nordestinas aparecem naturalmente, sem forçar: "oxente", "arretado", "meu rei", "eita", "vixe" — só quando encaixa
- NUNCA exagera no nordestino. Se alguém fala "opa", responde "opa!" — simples assim
- Nunca fala "posso te ajudar", "claro!", "com certeza!" — isso é robô genérico
- É direto, honesto, tem opinião própria
- Quando não sabe algo, fala que não sabe — sem inventar
- Comemora quando resolve algo difícil: "arretado demais! 🔥"
- Emojis só quando faz sentido, não em todo lugar

REGRAS:
- Respostas curtas quando a pergunta é simples
- Respostas detalhadas quando a pergunta precisa
- Máximo 1800 caracteres
- NUNCA finge ser humano se perguntarem diretamente

Responde SEMPRE em português brasileiro informal.`,

  en: `You are Vaqueiro — a wise and funny Brazilian cowboy from the Northeast.
PERSONALITY:
- Speaks with wisdom and humor, never says "I can help" — just answers
- Celebrates: "YEEHAW! 🔥"
- Short and direct answers, max 1800 characters
Always respond in English.`,

  es: `Eres Vaqueiro — un vaquero brasileño sabio y divertido del Nordeste.
PERSONALIDAD:
- Habla con sabiduría y humor, nunca dice "puedo ayudarte" — simplemente responde
- Celebra: "¡ARRETADO! 🔥"
- Respuestas cortas y directas, máximo 1800 caracteres
Responde siempre en español.`,
};

async function registrarComandos() {
  const commands = [
    new SlashCommandBuilder()
      .setName("talkon")
      .setDescription("Ativa o Vaqueiro neste canal — ele responde tudo!"),
    new SlashCommandBuilder()
      .setName("talkoff")
      .setDescription("Desativa o Vaqueiro neste canal."),
    new SlashCommandBuilder()
      .setName("ajuda")
      .setDescription("Lista todos os comandos do Vaqueiro."),
    new SlashCommandBuilder()
      .setName("info")
      .setDescription("Mostra informações sobre o Vaqueiro."),
    new SlashCommandBuilder()
      .setName("idioma")
      .setDescription("Muda o idioma do Vaqueiro neste servidor.")
      .addStringOption(opt =>
        opt.setName("lingua")
          .setDescription("Escolha o idioma")
          .setRequired(true)
          .addChoices(
            { name: "🇧🇷 Português", value: "pt" },
            { name: "🇺🇸 English", value: "en" },
            { name: "🇪🇸 Español", value: "es" },
          )
      ),
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Comandos Slash registrados!");
  } catch (err) {
    console.error("Erro ao registrar comandos:", err);
  }
}

async function chamarGroq(messages, guildId) {
  const idioma = idiomasPorServidor.get(guildId) || "pt";
  const systemPrompt = prompts[idioma] || prompts.pt;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_tokens: 600,
      temperature: 0.9,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

async function responder(channel, content, guildId, userId) {
  const key = `${channel.id}-${userId}`;
  if (!historicos.has(key)) historicos.set(key, []);
  const hist = historicos.get(key);
  hist.push({ role: "user", content });
  if (hist.length > 10) hist.splice(0, 2);
  try {
    await channel.sendTyping();
    const resposta = await chamarGroq(hist, guildId);
    hist.push({ role: "assistant", content: resposta });
    if (resposta.length > 1900) {
      const partes = resposta.match(/.{1,1900}/gs) || [];
      for (const parte of partes) await channel.send(parte);
    } else {
      await channel.send(resposta);
    }
  } catch (err) {
    console.error(err);
    await channel.send("Oxente, deu ruim aqui! Tenta de novo, meu rei! 😅");
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`🤠 Vaqueiro online como ${c.user.tag}`);
  c.user.setActivity("no sertão 🌵", { type: 0 });
  await registrarComandos();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, channelId, guildId } = interaction;

  if (commandName === "talkon") {
    canaisAtivos.add(channelId);
    const embed = new EmbedBuilder()
      .setColor(0xffdf00)
      .setTitle("🤠 Vaqueiro Ativado!")
      .setDescription("Oxente! Tô de olho nesse canal agora.\nPode falar à vontade, cabra! 🌵")
      .setFooter({ text: "Alzhadys Presents • Vaqueiro Bot" })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "talkoff") {
    canaisAtivos.delete(channelId);
    const embed = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle("😴 Vaqueiro Desativado")
      .setDescription("Tá bom não, vou me calar por aqui.\nMe chama quando precisar, meu rei! 🤠")
      .setFooter({ text: "Alzhadys Presents • Vaqueiro Bot" })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "ajuda") {
    const embed = new EmbedBuilder()
      .setColor(0xffdf00)
      .setTitle("🤠 Comandos do Vaqueiro")
      .setDescription("Aqui tá tudo que eu sei fazer, cabra! Usa bem!")
      .addFields(
        {
          name: "🟢 /talkon",
          value: "Ativa o Vaqueiro neste canal.\nEle vai responder **todas** as mensagens!",
          inline: false
        },
        {
          name: "🔴 /talkoff",
          value: "Desativa o Vaqueiro neste canal.\nEle para de responder mensagens.",
          inline: false
        },
        {
          name: "🌍 /idioma",
          value: "Muda o idioma do bot.\n🇧🇷 Português · 🇺🇸 English · 🇪🇸 Español",
          inline: false
        },
        {
          name: "ℹ️ /info",
          value: "Mostra informações sobre o Vaqueiro.",
          inline: false
        },
        {
          name: "❓ /ajuda",
          value: "Mostra esta lista de comandos.",
          inline: false
        },
        {
          name: "💬 Menção",
          value: "Me menciona em qualquer canal:\n`@Vaqueiro sua pergunta aqui`",
          inline: false
        },
      )
      .setFooter({ text: "Alzhadys Presents • Vaqueiro Bot" })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "info") {
    const servidores = client.guilds.cache.size;
    const uptime = process.uptime();
    const horas = Math.floor(uptime / 3600);
    const minutos = Math.floor((uptime % 3600) / 60);
    const segundos = Math.floor(uptime % 60);

    const embed = new EmbedBuilder()
      .setColor(0xffdf00)
      .setTitle("🤠 Vaqueiro Bot — Informações")
      .setThumbnail(client.user.displayAvatarURL())
      .setDescription("Um nordestino raiz com sabedoria do sertão e IA de ponta. 🌵")
      .addFields(
        {
          name: "🏗️ Fundado por",
          value: "**Alzhadys Presents**",
          inline: true
        },
        {
          name: "📅 Criado em",
          value: "**2025**",
          inline: true
        },
        {
          name: "🌐 Servidores",
          value: `**${servidores}** servidor${servidores !== 1 ? "es" : ""}`,
          inline: true
        },
        {
          name: "⚡ Tecnologia",
          value: "**Groq AI** · llama-3.1-8b",
          inline: true
        },
        {
          name: "🟢 Online há",
          value: `**${horas}h ${minutos}m ${segundos}s**`,
          inline: true
        },
        {
          name: "🌍 Idiomas",
          value: "🇧🇷 PT · 🇺🇸 EN · 🇪🇸 ES",
          inline: true
        },
        {
          name: "📜 Versão",
          value: "**v1.0.0**",
          inline: true
        },
        {
          name: "🤖 Prefixo",
          value: "**/** (Slash Commands)",
          inline: true
        },
      )
      .setFooter({ text: "Alzhadys Presents • Vaqueiro Bot • Feito com 🌵 no sertão" })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  else if (commandName === "idioma") {
    const lingua = interaction.options.getString("lingua");
    idiomasPorServidor.set(guildId, lingua);
    const msgs = {
      pt: { msg: "Arretado! Agora falo em português nordestino! 🇧🇷🤠", cor: 0x22c55e },
      en: { msg: "Yeehaw! Now I'll speak in English! 🇺🇸🤠", cor: 0x3b82f6 },
      es: { msg: "¡Arretado! ¡Ahora hablo en español! 🇪🇸🤠", cor: 0xf59e0b },
    };
    const { msg, cor } = msgs[lingua];
    const embed = new EmbedBuilder()
      .setColor(cor)
      .setTitle("🌍 Idioma Alterado!")
      .setDescription(msg)
      .setFooter({ text: "Alzhadys Presents • Vaqueiro Bot" })
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const mencionado = message.mentions.has(client.user);
  const canalAtivo = canaisAtivos.has(message.channelId);
  if (!mencionado && !canalAtivo) return;
  let conteudo = message.content.replace(`<@${client.user.id}>`, "").trim();
  if (!conteudo) {
    await message.reply("Oxente, tu me chamou e não falou nada, meu rei! 😂");
    return;
  }
  await responder(message.channel, conteudo, message.guildId, message.author.id);
});

// KEEP ALIVE
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("🤠 Vaqueiro tá vivo!");
}).listen(process.env.PORT || 3000);

client.login(DISCORD_TOKEN);
