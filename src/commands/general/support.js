const { SUPPORT_GROUP_LINK, BOT_NAME } = require('../../config');

module.exports = {
  name: 'support',
  category: 'general',
  description: '/support - get help or report an issue with the bot',
  async execute({ msg }) {
    await msg.reply(
      `🆘 Need help with ${BOT_NAME}?\nJoin the support group:\n${SUPPORT_GROUP_LINK}`
    );
  },
};
