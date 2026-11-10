const Reminder = require('../../models/Reminder');

module.exports = {
  name: 'reminders',
  category: 'general',
  description: '/reminders - list your pending reminders',
  async execute({ msg, senderId }) {
    const list = await Reminder.find({ userId: senderId, completed: false }).sort({ remindAt: 1 });
    if (list.length === 0) return msg.reply('You have no pending reminders.');

    const text = list.map((r, i) => `${i + 1}. ${r.message} - ${r.remindAt.toLocaleString()}`).join('\n');
    await msg.reply(`⏰ Your pending reminders:\n${text}\n\nUse /cancelreminder <number> to cancel one.`);
  },
};