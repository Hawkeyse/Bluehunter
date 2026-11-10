const Reminder = require('../../models/Reminder');
const { parseDuration } = require('../../utils/duration');

module.exports = {
  name: 'remind',
  aliases: ['reminder'],
  category: 'general',
  description: '/remind 10m|1h|1d <message> - get pinged after a delay',
  async execute({ msg, chat, args, senderId }) {
    if (args.length < 2) return msg.reply('Usage: /remind 10m take out the trash');

    const durationArg = args[0];
    const { ms, valid } = parseDuration(durationArg);
    if (!valid || !ms) {
      return msg.reply('Invalid duration. Use formats like 10m, 1h, 1d ("perm" doesn\'t make sense for a reminder).');
    }

    const message = args.slice(1).join(' ');
    const remindAt = new Date(Date.now() + ms);

    await Reminder.create({ userId: senderId, chatId: chat.id._serialized, message, remindAt });
    await msg.reply(`⏰ Got it - I'll remind you in ${durationArg}: "${message}"`);
  },
};