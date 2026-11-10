const Afk = require('../../models/Afk');

module.exports = {
  name: 'afk',
  category: 'general',
  description: '/afk [reason] - mark yourself as away in this chat, auto-clears next time you message here',
  async execute({ msg, chat, args, senderId }) {
    const reason = args.join(' ') || 'no reason given';
    await Afk.findOneAndUpdate(
      { groupId: chat.id._serialized, userId: senderId },
      { reason, since: new Date() },
      { upsert: true }
    );
    await msg.reply(`💤 You're now AFK here: ${reason}`);
  },
};