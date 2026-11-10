const { BOT_NAME } = require('../../config');

// Anyone who wants to speak with the owner is sent to Timtech.
const CONTACT = (process.env.OWNER_CONTACT_NUMBER || '233504919423').replace(/[^\d]/g, '');

module.exports = {
  name: 'owner',
  category: 'general',
  description: '/owner - contact the bot owner',
  async execute({ msg }) {
    await msg.reply(`👤 ${BOT_NAME} is owned and maintained by *Timtech*.\nTo speak with the owner, contact Timtech: wa.me/${CONTACT}`);
  },
};
