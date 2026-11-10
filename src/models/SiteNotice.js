const mongoose = require('mongoose');

// Small key/value notices shown on the website. Right now: the owner's
// maintenance message (key = 'maintenance'), kept in the database so it
// survives a restart.
const siteNoticeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    message: { type: String, default: '' },
    active: { type: Boolean, default: false },
    updatedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SiteNotice', siteNoticeSchema);
