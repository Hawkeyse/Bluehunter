const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  chatId: { type: String, required: true },
  message: { type: String, required: true },
  remindAt: { type: Date, required: true },
  completed: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
});

module.exports = mongoose.model('Reminder', reminderSchema);