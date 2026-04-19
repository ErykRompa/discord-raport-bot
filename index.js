const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, MessageFlags, AttachmentBuilder } = require("discord.js");
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
  airdrop_win: { label: "📦 Airdrop Win", price: 20000, requiresPeople: false },
  mcl_win: { label: "🏍️ MCL Win", price: 20000, requiresPeople: false },
  dealer_win: { label: "💰 Dealer Win", price: 20000, requiresPeople: false },
  grover: { label: "🌿 Ty Grover", price: 240000, requiresPeople: false },
  korekta: { label: "⚖️ Korekta", price: 0, requiresPeople: false }
};

// ===== DB SETUP =====
const db = new sqlite3.Database("./database.db");
const dbRun = (q, p = []) => new Promise((res, rej) => db.run(q, p, e => e ? rej(e) : res()));
const dbAll = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => e ? rej(e) : res(r)));
const dbGet = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => e ? rej(e) : res(r)));

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (discordId TEXT PRIMARY KEY, gameId TEXT, verified INTEGER)");
  db.run("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, type TEXT, amount INTEGER, imageUrl TEXT, date TEXT)");
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName("rejestracja").setDescription("Zarejestruj swoje ID").addStringOption(o => o.setName("id").setDescription("Twoje ID").setRequired(true)),
  new SlashCommandBuilder().setName("raport").setDescription("Dodaj raport").addStringOption(o => o.setName("typ").setDescription("Typ").setRequired(true).addChoices(...Object.entries(reportTypes).filter(([k]) => k !== "korekta").map(([k, v]) => ({ name: v.label, value: k })))).addAttachmentOption(o => o.setName("screen").setDescription("Dowod").setRequired(true)).addIntegerOption(o => o.setName("osoby").setDescription("Liczba osob").setMinValue(1)),
  new SlashCommandBuilder().setName("raport_stats").setDescription("Statystyki"),
  new SlashCommandBuilder().setName("weryfikuj").setDescription("Admin").addUserOption(o => o.setName("gracz").setRequired(true)).addBooleanOption(o => o.setName("status").setRequired(true)).setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_korekta").setDescription("Admin - Korekta").addUserOption(o => o.setName("gracz").setRequired(true)).addIntegerOption(o => o.setName("kwota").setRequired(true)).setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_summary").setDescription("Lista wyplat").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_export").setDescription("Plik TXT").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_reset").setDescription("Reset bazy").setDefaultMemberPermissions(0)
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("⏳ Rejestrowanie komend...");
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log("✅ Komendy gotowe");
  } catch (err) { console.error("❌ Błąd REST:", err); }
})();

client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  try {
    if (i.commandName === "rejestracja") {
      const id = i.options.getString("id");
      await dbRun("INSERT OR REPLACE INTO users VALUES(?,?,0)", [i.user.id, id]);
      const logChan = i.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChan) logChan.send(`🔔 **Weryfikacja:** <@${i.user.id}> zgłosił ID: ${id}`);
      return i.reply({ content: "✅ Zapisano. Czekaj na weryfikację.", flags: [MessageFlags.Ephemeral] });
    }

    if (i.commandName === "weryfikuj") {
      const target = i.options.getUser("gracz");
      const status = i.options.getBoolean("status");
      await dbRun("UPDATE users SET verified = ? WHERE discordId = ?", [status ? 1 : 0, target.id]);
      return i.reply(`Status <@${target.id}>: ${status ? "✅ Zweryfikowany" : "❌ Zablokowany"}`);
    }

    if (i.commandName === "raport") {
      const u = await dbGet("SELECT * FROM users WHERE discordId = ? AND verified = 1", [i.user.id]);
      if (!u) return i.reply({ content: "❌ Brak weryfikacji ID!", flags: [MessageFlags.Ephemeral] });
      const type = i.options.getString("typ");
      const people = i.options.getInteger("osoby");
      const screen = i.options.getAttachment("screen");
      const cfg = reportTypes[type];
      if (cfg.requiresPeople && !people) return i.reply({ content: "❌ Podaj liczbę osób!", flags: [MessageFlags.Ephemeral] });
      await i.deferReply({ flags: [MessageFlags.Ephemeral] });
      const amt = cfg.requiresPeople ? Math.floor(cfg.price / people) : cfg.price;
      await dbRun("INSERT INTO reports (userId, type, amount, imageUrl, date) VALUES (?, ?, ?, ?, datetime('now'))", [i.user.id, type, amt, screen.url]);
      const logChan = i.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChan) logChan.send({ content: `📑 **Raport:** <@${i.user.id}> | ID: ${u.gameId}\n**Typ:** ${cfg.label}\n**Zarobek:** ${amt.toLocaleString()}$`, files: [screen.url] });
      return i.editReply(`✅ Wysłano! +**${amt.toLocaleString()}$**`);
    }

    if (i.commandName === "raport_stats") {
      const r = await dbGet("SELECT SUM(amount) as total FROM reports WHERE userId = ?", [i.user.id]);
      const rows = await dbAll("SELECT type, COUNT(*) as count FROM reports WHERE userId = ? GROUP BY type", [i.user.id]);
      let msg = `💰 Twoja suma: **${(r.total || 0).toLocaleString()}$**\n\n`;
      rows.forEach(row => { msg += `${reportTypes[row.type]?.label || row.type}: ${row.count}\n`; });
      return i.reply(msg);
    }

    if (i.commandName === "raport_summary") {
      const rows = await dbAll("SELECT r.userId, u.gameId, SUM(r.amount) as total, COUNT(r.id) as count FROM reports r JOIN users u ON r.userId = u.discordId GROUP BY u.gameId ORDER BY total DESC");
      if (rows.length === 0) return i.reply("Baza jest pusta.");
      let msg = "📊 **Podsumowanie zarobków:**\n";
      rows.forEach(r => { msg += `<@${r.userId}> | ID: \`${r.gameId}\` | Wypłata: **${r.total.toLocaleString()}$** | Kontrakty: \`${r.count}\`\n`; });
      return i.reply(msg);
    }

    if (i.commandName === "raport_korekta") {
        const target = i.options.getUser("gracz");
        const amt = i.options.getInteger("kwota");
        await dbRun("INSERT INTO reports (userId, type, amount, imageUrl, date) VALUES (?, 'korekta', ?, 'KOREKTA', datetime('now'))", [target.id, amt]);
        return i.reply(`✅ Korekta dla <@${target.id}>: **${amt.toLocaleString()}$**`);
    }

    if (i.commandName === "raport_export") {
      const rows = await dbAll("SELECT u.gameId, SUM(r.amount) as total FROM reports r JOIN users u ON r.userId = u.discordId GROUP BY u.gameId");
      if (rows.length === 0) return i.reply("Brak danych.");
      let txt = "staticId;amount;comment\n";
      rows.forEach(r => { txt += `${r.gameId};${r.total};wyplata\n`; });
      fs.writeFileSync("wyplaty.txt", txt);
      await i.reply({ content: "📂 Wygenerowano plik:", files: [new AttachmentBuilder("wyplaty.txt")] });
      return fs.unlinkSync("wyplaty.txt");
    }

    if (i.commandName === "raport_reset") {
      await dbRun("DELETE FROM reports");
      return i.reply("🧨 Reset bazy wykonany.");
    }
  } catch (err) {
    console.error(err);
    if (!i.replied) i.reply({ content: "Wystąpił błąd!", flags: [MessageFlags.Ephemeral] });
  }
});

client.login(process.env.TOKEN);