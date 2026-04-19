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

// ===== KONFIGURACJA =====
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

// ===== BAZA DANYCH =====
const db = new sqlite3.Database("./database.db");
const dbRun = (q, p = []) => new Promise((res, rej) => db.run(q, p, e => e ? rej(e) : res()));
const dbAll = (q, p = []) => new Promise((res, rej) => db.all(q, p, (e, r) => e ? rej(e) : res(r)));
const dbGet = (q, p = []) => new Promise((res, rej) => db.get(q, p, (e, r) => e ? rej(e) : res(r)));

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (discordId TEXT PRIMARY KEY, gameId TEXT, verified INTEGER)");
  db.run("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, type TEXT, amount INTEGER, imageUrl TEXT, date TEXT)");
});

// ===== DEFINICJA KOMEND =====
const commands = [
  new SlashCommandBuilder()
    .setName("rejestracja")
    .setDescription("Zarejestruj swoje ID z gry")
    .addStringOption(o => o.setName("id").setDescription("Twoje ID w grze").setRequired(true)),

  new SlashCommandBuilder()
    .setName("raport")
    .setDescription("Dodaj raport z akcji")
    .addStringOption(o => o.setName("typ").setDescription("Typ akcji").setRequired(true)
      .addChoices(...Object.entries(reportTypes).filter(([k]) => k !== "korekta").map(([k, v]) => ({ name: v.label, value: k }))))
    .addAttachmentOption(o => o.setName("screen").setDescription("Dowód (zdjęcie)").setRequired(true))
    .addIntegerOption(o => o.setName("osoby").setDescription("Liczba osób (wymagane przy Spisku/Cennej)").setMinValue(1)),

  new SlashCommandBuilder().setName("raport_stats").setDescription("Twoje statystyki zarobków"),
  
  new SlashCommandBuilder()
    .setName("weryfikuj")
    .setDescription("Zatwierdź ID użytkownika (Admin)")
    .addUserOption(o => o.setName("gracz").setDescription("Gracz do weryfikacji").setRequired(true))
    .addBooleanOption(o => o.setName("status").setDescription("Czy zatwierdzić?").setRequired(true))
    .setDefaultMemberPermissions(0),

 new SlashCommandBuilder()
    .setName("raport_korekta")
    .setDescription("Dodaj/odejmij środki graczowi (Admin)")
    .addUserOption(o => o.setName("gracz").setDescription("Wybierz gracza").setRequired(true)) // Dodano opis
    .addIntegerOption(o => o.setName("kwota").setDescription("Kwota (użyj minusa aby odjąć)").setRequired(true))
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder().setName("raport_summary").setDescription("Podsumowanie wszystkich wypłat (Admin)").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_export").setDescription("Generuj plik TXT do wypłat (Admin)").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_reset").setDescription("Czyści całą bazę raportów (Admin)").setDefaultMemberPermissions(0)
].map(c => c.toJSON());

// ===== INICJALIZACJA BOTA =====
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  console.log(`✅ Zalogowano jako ${client.user.tag}`);
  try {
    console.log("⏳ Rejestrowanie komend slash...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Komendy zarejestrowane pomyślnie!");
  } catch (err) {
    console.error("❌ Błąd podczas rejestracji komend:", err);
  }
});

// ===== OBSŁUGA INTERAKCJI =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  try {
    // 1. REJESTRACJA
    if (i.commandName === "rejestracja") {
      const id = i.options.getString("id");
      await dbRun("INSERT OR REPLACE INTO users (discordId, gameId, verified) VALUES (?, ?, 0)", [i.user.id, id]);
      const logChan = i.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChan) logChan.send(`🔔 **Weryfikacja:** <@${i.user.id}> zgłosił ID: \`${id}\``);
      return i.reply({ content: "✅ Zapisano ID. Poczekaj, aż Admin Cię zweryfikuje.", flags: [MessageFlags.Ephemeral] });
    }

    // 2. RAPORT (Główna logika z poprawionym podziałem osób)
    if (i.commandName === "raport") {
      const u = await dbGet("SELECT * FROM users WHERE discordId = ? AND verified = 1", [i.user.id]);
      if (!u) return i.reply({ content: "❌ Twoje ID nie jest zweryfikowane! Użyj `/rejestracja` i czekaj na Admina.", flags: [MessageFlags.Ephemeral] });

      const type = i.options.getString("typ");
      const screen = i.options.getAttachment("screen");
      let people = i.options.getInteger("osoby") || 1;
      const cfg = reportTypes[type];

      // Walidacja liczby osób
      if (cfg.requiresPeople && (!i.options.getInteger("osoby") || people < 1)) {
        return i.reply({ content: `❌ Ten typ akcji (**${cfg.label}**) wymaga podania liczby osób!`, flags: [MessageFlags.Ephemeral] });
      }

      await i.deferReply({ flags: [MessageFlags.Ephemeral] });

      // Obliczanie kwoty (jeśli akcja nie wymaga podziału, people wynosi 1)
      const amt = cfg.requiresPeople ? Math.floor(cfg.price / people) : cfg.price;

      await dbRun("INSERT INTO reports (userId, type, amount, imageUrl, date) VALUES (?, ?, ?, ?, datetime('now'))", [i.user.id, type, amt, screen.url]);

      const logChan = i.guild.channels.cache.get(LOG_CHANNEL_ID);
      if (logChan) {
        logChan.send({
          content: `📑 **Nowy Raport:** <@${i.user.id}> | ID Gry: \`${u.gameId}\`\n**Typ:** ${cfg.label}\n**Podział na:** ${cfg.requiresPeople ? people + " os." : "Brak"}\n**Zarobek dla gracza:** ${amt.toLocaleString()}$`,
          files: [screen.url]
        });
      }
      return i.editReply(`✅ Raport wysłany! Naliczono: **+${amt.toLocaleString()}$**`);
    }

    // 3. STATYSTYKI OSOBISTE
    if (i.commandName === "raport_stats") {
      const r = await dbGet("SELECT SUM(amount) as total FROM reports WHERE userId = ?", [i.user.id]);
      const rows = await dbAll("SELECT type, COUNT(*) as count FROM reports WHERE userId = ? GROUP BY type", [i.user.id]);
      
      let msg = `💰 Twój łączny zarobek: **${(r.total || 0).toLocaleString()}$**\n\n**Wykonane akcje:**\n`;
      if (rows.length === 0) msg += "_Brak zarejestrowanych akcji._";
      rows.forEach(row => {
        msg += `- ${reportTypes[row.type]?.label || row.type}: \`${row.count}\`\n`;
      });
      return i.reply({ content: msg, flags: [MessageFlags.Ephemeral] });
    }

    // 4. WERYFIKACJA (ADMIN)
    if (i.commandName === "weryfikuj") {
      const target = i.options.getUser("gracz");
      const status = i.options.getBoolean("status");
      await dbRun("UPDATE users SET verified = ? WHERE discordId = ?", [status ? 1 : 0, target.id]);
      return i.reply(`Status gracza <@${target.id}> został zmieniony na: ${status ? "✅ Zweryfikowany" : "❌ Niezweryfikowany"}`);
    }

    // 5. KOREKTA (ADMIN)
    if (i.commandName === "raport_korekta") {
      const target = i.options.getUser("gracz");
      const amt = i.options.getInteger("kwota");
      await dbRun("INSERT INTO reports (userId, type, amount, imageUrl, date) VALUES (?, 'korekta', ?, 'KOREKTA', datetime('now'))", [target.id, amt]);
      return i.reply(`✅ Wykonano korektę dla <@${target.id}> o kwotę: **${amt.toLocaleString()}$**`);
    }

    // 6. PODSUMOWANIE (ADMIN)
    if (i.commandName === "raport_summary") {
      const rows = await dbAll("SELECT r.userId, u.gameId, SUM(r.amount) as total, COUNT(r.id) as count FROM reports r JOIN users u ON r.userId = u.discordId GROUP BY u.gameId ORDER BY total DESC");
      if (rows.length === 0) return i.reply("Baza danych raportów jest pusta.");

      let msg = "📊 **Podsumowanie zarobków wszystkich graczy:**\n";
      rows.forEach(r => {
        msg += `<@${r.userId}> | ID: \`${r.gameId}\` | Do wypłaty: **${r.total.toLocaleString()}$** (Akcje: ${r.count})\n`;
      });
      return i.reply(msg);
    }

    // 7. EKSPORT DO PLIKU (ADMIN)
    if (i.commandName === "raport_export") {
      const rows = await dbAll("SELECT u.gameId, SUM(r.amount) as total FROM reports r JOIN users u ON r.userId = u.discordId GROUP BY u.gameId");
      if (rows.length === 0) return i.reply("Brak danych do eksportu.");

      let txt = "staticId;amount;comment\n";
      rows.forEach(r => { txt += `${r.gameId};${r.total};wyplata\n`; });

      const fileName = "wyplaty.txt";
      fs.writeFileSync(fileName, txt);
      await i.reply({ content: "📂 Plik z wypłatami został wygenerowany:", files: [new AttachmentBuilder(fileName)] });
      return fs.unlinkSync(fileName);
    }

    // 8. RESET (ADMIN)
    if (i.commandName === "raport_reset") {
      await dbRun("DELETE FROM reports");
      return i.reply("🧨 **Baza danych raportów została wyczyszczona!** Wszystkie statystyki zostały zresetowane.");
    }

  } catch (err) {
    console.error(err);
    if (!i.replied && !i.deferred) {
        await i.reply({ content: "Wystąpił nieoczekiwany błąd!", flags: [MessageFlags.Ephemeral] });
    } else {
        await i.editReply({ content: "Wystąpił błąd podczas przetwarzania!" });
    }
  }
});

client.login(process.env.TOKEN);