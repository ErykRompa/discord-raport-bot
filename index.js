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

  airdrop_win: { label: "📦 Airdrop Win", price: 20000, requiresPeople: false },
  mcl_win: { label: "🏍️ MCL Win", price: 20000, requiresPeople: false },
  dealer_win: { label: "💰 Dealer Win", price: 20000, requiresPeople: false },

  grover: { label: "🌿 Grover", price: 240000, requiresPeople: false },

  korekta: { label: "⚖️ Korekta", price: 0, requiresPeople: false }
};

// ===== DB =====
const db = new sqlite3.Database("./database.db");
const dbRun = (q,p=[])=>new Promise((res,rej)=>db.run(q,p,e=>e?rej(e):res()));
const dbAll = (q,p=[])=>new Promise((res,rej)=>db.all(q,p,(e,r)=>e?rej(e):res(r)));
const dbGet = (q,p=[])=>new Promise((res,rej)=>db.get(q,p,(e,r)=>e?rej(e):res(r)));

db.serialize(()=>{
  db.run("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, type TEXT, amount INTEGER, imageUrl TEXT, date TEXT)");
  db.run("CREATE TABLE IF NOT EXISTS users (discordId TEXT PRIMARY KEY, gameId TEXT, verified INTEGER DEFAULT 0)");
});

// ===== KOMENDY =====
const commands = [
  new SlashCommandBuilder()
    .setName("rejestracja")
    .setDescription("Zarejestruj swoje ID z gry")
    .addStringOption(opt => 
      opt.setName("id").setDescription("Twoje ID").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("raport2")
    .setDescription("Dodaj raport")
    .addStringOption(opt =>
      opt.setName("typ")
        .setDescription("Typ raportu")
        .setRequired(true)
        .addChoices(
          ...Object.entries(reportTypes)
            .filter(([k]) => k !== "korekta")
            .map(([k,v]) => ({ name: v.label, value: k }))
        )
    )
    .addAttachmentOption(opt => 
      opt.setName("screen")
        .setDescription("Dowód (zdjęcie)") // 🔥 FIX
        .setRequired(true)
    )
    .addIntegerOption(opt => 
      opt.setName("osoby")
        .setDescription("Liczba osób") // 🔥 też dodane dla bezpieczeństwa
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("raport_stats")
    .setDescription("Statystyki"),

  new SlashCommandBuilder()
    .setName("weryfikuj")
    .setDescription("Admin weryfikacja")
    .addUserOption(o=>o.setName("gracz").setDescription("Gracz").setRequired(true))
    .addBooleanOption(o=>o.setName("status").setDescription("Status").setRequired(true))
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder()
    .setName("raport_korekta")
    .setDescription("Korekta admin")
    .addUserOption(o=>o.setName("gracz").setDescription("Gracz").setRequired(true))
    .addIntegerOption(o=>o.setName("kwota").setDescription("Kwota").setRequired(true))
    .setDefaultMemberPermissions(0),

  new SlashCommandBuilder().setName("raport_summary").setDescription("Podsumowanie").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_export").setDescription("Export").setDefaultMemberPermissions(0),
  new SlashCommandBuilder().setName("raport_reset").setDescription("Reset").setDefaultMemberPermissions(0)

].map(c=>c.toJSON());

// ===== CLIENT =====
const client = new Client({ intents:[GatewayIntentBits.Guilds] });
const rest = new REST({version:"10"}).setToken(process.env.TOKEN);

(async()=>{
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log("✅ Komendy gotowe");
})();

client.on("interactionCreate", async i=>{
  if(!i.isChatInputCommand()) return;

  try{
    if(i.commandName==="rejestracja"){
      const id=i.options.getString("id");
      await dbRun("INSERT OR REPLACE INTO users VALUES(?,?,0)",[i.user.id,id]);
      return i.reply({content:"✅ Zapisano",flags:[MessageFlags.Ephemeral]});
    }

    if(i.commandName==="raport"){
      const u=await dbGet("SELECT * FROM users WHERE discordId=? AND verified=1",[i.user.id]);
      if(!u) return i.reply({content:"❌ Brak weryfikacji",flags:[MessageFlags.Ephemeral]});

      const type=i.options.getString("typ");
      const people=i.options.getInteger("osoby");
      const screen=i.options.getAttachment("screen");
      const cfg=reportTypes[type];

      if(cfg.requiresPeople && !people)
        return i.reply({content:"❌ Podaj osoby",flags:[MessageFlags.Ephemeral]});

      await i.deferReply({flags:[MessageFlags.Ephemeral]});
      const amt=cfg.requiresPeople?Math.floor(cfg.price/people):cfg.price;

      await dbRun("INSERT INTO reports VALUES(NULL,?,?,?,?,datetime('now'))",
        [i.user.id,type,amt,screen.url]);

      return i.editReply("✅ +" + amt + "$");
    }

    if(i.commandName==="raport_stats"){
      const total=await dbGet("SELECT SUM(amount) as total FROM reports WHERE userId=?",[i.user.id]);
      const rows=await dbAll("SELECT type,COUNT(*) as count FROM reports WHERE userId=? GROUP BY type",[i.user.id]);

      let msg="📊 Statystyki\n💰 "+(total?.total||0)+"$\n\n";

      rows.forEach(r=>{
        if(reportTypes[r.type])
          msg+=reportTypes[r.type].label+": "+r.count+"\n";
      });

      return i.reply(msg);
    }

    if(i.commandName==="raport_reset"){
      await dbRun("DELETE FROM reports");
      return i.reply("🧨 Reset");
    }

  }catch(e){
    console.error(e);
    if(!i.replied) i.reply("Blad");
  }
});

client.login(process.env.TOKEN);