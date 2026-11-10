const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('../../utils/waCompat'); // was: require('whatsapp-web.js')

const GroupSettings = require('../../models/GroupSettings');
const Warning = require('../../models/Warning');
const Mute = require('../../models/Mute');
const Ban = require('../../models/Ban');
const BotConfig = require('../../models/BotConfig');

const BACKUP_DIR = path.join(__dirname, '..', '..', '..', 'backups');

module.exports = {
  name: 'backup',
  category: 'system',
  description: '/backup - export all bot data (settings, warnings, mutes, bans) as a JSON file',
  ownerOnly: true,
  async execute({ msg }) {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const [groupSettings, warnings, mutes, bans, botConfig] = await Promise.all([
      GroupSettings.find({}).lean(),
      Warning.find({}).lean(),
      Mute.find({}).lean(),
      Ban.find({}).lean(),
      BotConfig.find({}).lean(),
    ]);

    const payload = { generatedAt: new Date().toISOString(), groupSettings, warnings, mutes, bans, botConfig };
    const filename = `bluehunter-backup-${Date.now()}.json`;
    const filePath = path.join(BACKUP_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    const media = MessageMedia.fromFilePath(filePath);
    await msg.reply(media, undefined, { caption: `📦 Backup generated: ${filename}` });
  },
};
