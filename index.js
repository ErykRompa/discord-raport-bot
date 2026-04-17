const { 
  Client, 
  GatewayIntentBits, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  MessageFlags, 
  AttachmentBuilder 
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
require("dotenv").config();

// ===== CONFIG =====
const LOG_CHANNEL_ID = "1494360618457895023";

const reportTypes = {
  spisek: { label: "🕵️ Spisek", price: 130000, requiresPeople: true },
  cenna: { label: "💎 Cenna", price: 130000, requiresPeople: true },
  paczki_ladowanie: { label: "📦 Paczki ladowanie", price: 20000, requiresPeople: false },
  paczki_oddanie: { label: "📦 Paczki oddanie", price: 10000, requiresPeople: false },
  magazyny: { label: "🏭 Magazyny", price: 20000, requiresPeople: false },
  capt_win: { label: "🏆 Capt Win", price: 5000, requiresPeople: false },
  capt_lose: { label: "❌ Capt Lose", price: 0, requiresPeople: false },
  korekta: { label: "⚖️ Korekta", price: 0, requiresPeople: false }
};

// ===== DB SETUP =====
const db = new sqlite3.Database("./database.db");
const dbRun = (query, params = []) => new Promise((res, rej) => db.run(query, params, (err) => err ? rej(err) : res()));
const dbAll = (query, params = []) => new Promise((res, rej) => db.all(query, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (query, params = []) => new Promise((res, rej) => db.get(query, params, (err, row) => err ? rej(err) : res(row)));

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, type TEXT, amount INTEGER, imageUrl TEXT, date TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS users (discordId TEXT PRIMARY KEY, gameId TEXT, verified INTEGER DEFAULT 0)");
});

// ===== KOMENDY =====
const commands = [
  new SlashCommandBuilder()
    .setName("rejestracja")
    .setDescription("Zarejestruj swoje ID z gry")
    .addStringOption(opt => opt.setName("id").setDescription("Twoje ID w grze").setRequired(true)),

  new SlashCommandBuilder()
    .setName("raport")
    .setDescription("Dodaj raport z akcji")
    .addStringOption(opt => 
      opt.setName("typ").setDescription("Typ akcji").setRequired(true)
        .addChoices(...Object.entries(reportTypes).filter(([k]) => k !== "korekta").map(([k, v]) => ({ name: v.label, value: k }))))
    .addAttachmentOption(opt => opt.setName("screen").setDescription("Dowod (zdjecie)").setRequired(true))
    .addIntegerOption(opt => opt.setName("osoby").setDescription("Liczba osob").setMinValue(1)),

  new SlashCommandBuilder().setName("raport_stats").setDescription("Twoje statystyki"),

  new SlashCommandBuilder()
    .setName("weryfikuj")
    .setDescription("Zatwierdz ID uzytkownika (Admin)")
    .addUserOption(opt => opt.setName("gracz").setDescription("Gracz").setRequired(true))
    .addBooleanOption(opt => opt.setName("status").setDescription("Zatwierdzic?").setRequired(true))
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder()
    .setName("raport_korekta")
    .setDescription("Dodaj/odejmij srodki (Admin)")
    .addUserOption(opt => opt.setName("gracz").setDescription("Gracz").setRequired(true))
    .addIntegerOption(opt => opt.setName("kwota").setDescription("Kwota (minus aby odjac)").setRequired(true))
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder().setName("raport_summary").setDescription("Lista wyplat na czacie (Admin)").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_export").setDescription("Generuj plik TXT do wyplat (Admin)").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_reset").setDescription("Czysci baze (Admin)").setDefaultMemberPermissions(0)
].map(cmd => cmd.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("✅ Komendy zarejestrowane.");
  } catch (err) { console.error(err); }
})();

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "rejestracja") {
      const gId = interaction.options.getString("id");
      await dbRun("INSERT OR REPLACE INTO users (discordId, gameId, verified) VALUES (?, ?, 0)", [interaction.user.id, gId]);
      const logChan = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChan) logChan.send("🔔 **Weryfikacja:** <@" + interaction.user.id + "> zglosil ID: " + gId);
      return interaction.reply({ content: "✅ Zapisano. Czekaj na weryfikacje Admina.", flags: [MessageFlags.Ephemeral] });
    }

    if (interaction.commandName === "weryfikuj") {
      const target = interaction.options.getUser("gracz");
      const status = interaction.options.getBoolean("status");
      await dbRun("UPDATE users SET verified = ? WHERE discordId = ?", [status ? 1 : 0, target.id]);
      return interaction.reply("Status <@" + target.id + ">: " + (status ? "✅ Zweryfikowany" : "❌ Zablokowany"));
    }

    if (interaction.commandName === "raport") {
      const u = await dbGet("SELECT * FROM users WHERE discordId = ? AND verified = 1", [interaction.user.id]);
      if (!u) return interaction.reply({ content: "❌ Brak weryfikacji ID! Uzyj `/rejestracja`.", flags: [MessageFlags.Ephemeral] });

      const type = interaction.options.getString("typ");
      const people = interaction.options.getInteger("osoby");
      const screen = interaction.options.getAttachment("screen");
      const cfg = reportTypes[type];

      if (cfg.requiresPeople && !people) return interaction.reply({ content: "❌ Podaj liczbe osob!", flags: [MessageFlags.Ephemeral] });

      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const amt = cfg.requiresPeople ? Math.floor(cfg.price / people) : cfg.price;

      await dbRun("INSERT INTO reports (userId, type, amount, imageUrl, date) VALUES (?, ?, ?, ?, datetime('now'))", 
        [interaction.user.id, type, amt, screen.url]);

      const logChan = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChan) {
        logChan.send({
          content: "📑 **Raport:** <@" + interaction.user.id + "> | ID: " + u.gameId + "\n**Typ:** " + cfg.label + "\n**Zarobek:** " + amt.toLocaleString() + "$",
          files: [screen.url]
        });
      }
      return interaction.editReply("✅ Wyslano! +**" + amt.toLocaleString() + "$**");
    }

    if (interaction.commandName === "raport_korekta") {
      const target = interaction.options.getUser("gracz");
      const amt = interaction.options.getInteger("kwota");
      const u = await dbGet("SELECT gameId FROM users WHERE discordId = ?", [target.id]);
      if (!u) return interaction.reply({ content: "❌ Ten gracz nie ma zarejestrowanego ID!", flags: [MessageFlags.Ephemeral] });

      await dbRun("INSERT INTO reports (userId, type, amount, imageUrl, date) VALUES (?, 'korekta', ?, 'KOREKTA', datetime('now'))", 
        [target.id, amt]);
      return interaction.reply("✅ Korekta dla <@" + target.id + ">: **" + amt.toLocaleString() + "$**");
    }

    if (interaction.commandName === "raport_stats") {
      const r = await dbGet("SELECT SUM(amount) as total FROM reports WHERE userId = ?", [interaction.user.id]);
      return interaction.reply("💰 Twoja suma: **" + (r.total || 0).toLocaleString() + "$**");
    }

    if (interaction.commandName === "raport_summary") {
      const rows = await dbAll("SELECT r.userId, u.gameId, SUM(r.amount) as total, COUNT(r.id) as count FROM reports r JOIN users u ON r.userId = u.discordId GROUP BY u.gameId ORDER BY total DESC");
      if (rows.length === 0) return interaction.reply("Baza jest pusta.");

      let msg = "📊 **Podsumowanie zarobkow:**\n";
      rows.forEach(r => {
        msg += "<@" + r.userId + "> | ID: `" + r.gameId + "` | Wyplata: **" + r.total.toLocaleString() + "$** | Kontrakty: `" + r.count + "`\n";
      });
      return interaction.reply(msg);
    }

    if (interaction.commandName === "raport_export") {
      const rows = await dbAll("SELECT u.gameId, SUM(r.amount) as total FROM reports r JOIN users u ON r.userId = u.discordId GROUP BY u.gameId");
      if (rows.length === 0) return interaction.reply("Brak danych do eksportu.");

      // Nagłówek pliku TXT
      let txt = "staticId;amount;comment\n"; 
      
      rows.forEach(r => {
        txt += r.gameId + ";" + r.total + ";wyplata\n";
      });

      fs.writeFileSync("wyplaty.txt", txt);
      const file = new AttachmentBuilder("wyplaty.txt");
      await interaction.reply({ content: "📂 Wygenerowano plik do wyplat:", files: [file] });
      return fs.unlinkSync("wyplaty.txt");
    }

    if (interaction.commandName === "raport_reset") {
      await dbRun("DELETE FROM reports");
      return interaction.reply("🧨 Wyczyszczono baze raportow.");
    }

  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.reply({ content: "Blad!", flags: [MessageFlags.Ephemeral] });
  }
});

client.login(process.env.TOKEN);