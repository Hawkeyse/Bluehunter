const Reminder = require('../../models/Reminder');

module.exports = {
  name: 'cancelreminder',
  category: 'general',
  description: '/cancelreminder <number> - cancel a pending reminder (see /reminders for numbers)',
  async execute({ msg, args, senderId }) {
    const index = parseInt(args[0], 10);
    if (!index || index < 1) return msg.reply('Usage: /cancelreminder <number> (see /reminders for the list)');

    const list = await Reminder.find({ userId: senderId, completed: false }).sort({ remindAt: 1 });
    const target = list[index - 1];
    if (!target) return msg.reply('No reminder with that number.');

    await Reminder.deleteOne({ _id: target._id });
    await msg.reply(`✅ Cancelled: "${target.message}"`);
  },
};