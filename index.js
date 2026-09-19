import makeWASocket, { useMultiFileAuthState, DisconnectReason, jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fs from 'fs';

const app = express();
app.get('/', (_, res) => res.send('CYPX COMMUNITY BOT is running ✅'));
app.listen(process.env.PORT || 3000, () => console.log('Web server online'));

const AUTH_DIR = './auth_info';
const WARNINGS_FILE = './warnings.json';
const warnings = fs.existsSync(WARNINGS_FILE) ? JSON.parse(fs.readFileSync(WARNINGS_FILE)) : {};
const saveWarnings = () => fs.writeFileSync(WARNINGS_FILE, JSON.stringify(warnings, null, 2));

const linkRegex = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|chat\.whatsapp\.com\/|telegram\.me\/|bit\.ly\/|tinyurl\.com\/)[^\s]+/i;
const welcomeText = (jid) => `🎉 *KARIBU CYPX COMMUNITY!* 🇰🇪\n\n👤 Member: @${jid.split('@')[0]}\n\nTunawakaribisha kwenye CYPX COMMUNITY! ❤️\n\n📌 Welcome to our community.\n🤝 Please respect all members.\n🚫 Links are not allowed without permission.\n\nEnjoy your stay! 🎊`;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: state, logger: P({ level: 'silent' }), printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('CYPX BOT connected ✅');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) startBot();
      else console.log('Logged out. Delete auth_info and reconnect.');
    }
  });

  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add') return;
    for (const participant of participants) {
      try {
        await sock.sendMessage(id, { text: welcomeText(participant), mentions: [participant] });
      } catch (e) { console.error('Welcome error:', e.message); }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message || !msg.key.remoteJid?.endsWith('@g.us') || msg.key.fromMe) return;
    const groupJid = msg.key.remoteJid;
    const sender = jidNormalizedUser(msg.key.participant || msg.key.remoteJid);
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (!linkRegex.test(text)) return;

    try {
      const metadata = await sock.groupMetadata(groupJid);
      const senderInfo = metadata.participants.find(p => jidNormalizedUser(p.id) === sender);
      const isAdmin = senderInfo?.admin === 'admin' || senderInfo?.admin === 'superadmin';
      if (isAdmin) return;

      await sock.sendMessage(groupJid, { delete: msg.key });
      warnings[`${groupJid}:${sender}`] = (warnings[`${groupJid}:${sender}`] || 0) + 1;
      const count = warnings[`${groupJid}:${sender}`];
      saveWarnings();

      if (count >= 2) {
        await sock.sendMessage(groupJid, { text: `🚫 @${sender.split('@')[0]} umeondolewa kwa kutuma links mara mbili.\n\nYou have been removed after 2 warnings.`, mentions: [sender] });
        await sock.groupParticipantsUpdate(groupJid, [sender], 'remove');
        delete warnings[`${groupJid}:${sender}`];
        saveWarnings();
      } else {
        await sock.sendMessage(groupJid, { text: `⚠️ *GROUP WARNING 1/2*\n\n@${sender.split('@')[0]}\nLinks are not allowed in this group.\nUsitume links bila ruhusa.\n\nAnother link will result in removal.`, mentions: [sender] });
      }
    } catch (e) { console.error('Moderation error:', e.message); }
  });
}
startBot();
