const mongoose = require('mongoose');
const dns = require('node:dns/promises');
const { MONGODB_URI } = require('../config');

// Some hosts/networks (containers, certain ISPs/VPS providers) can't resolve
// the mongodb+srv:// DNS TXT/SRV records against the default resolver.
// Forcing Cloudflare/Google DNS fixes the ECONNREFUSED _mongodb._tcp... error.
dns.setServers(['1.1.1.1', '8.8.8.8']);

async function connectDB() {
  if (!MONGODB_URI) {
    console.error('[DB] MONGODB_URI is missing in your .env file. Bot will keep running but nothing will persist.');
    return;
  }

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[DB] Connected to MongoDB');

    // Backfill groups that existed before the `introduced` field was added,
    // so the join-intro logic in events/group_participants.js doesn't treat
    // them as brand new and re-send the intro on the next member add.
    const GroupSettings = require('../models/GroupSettings');
    await GroupSettings.updateMany({ introduced: { $exists: false } }, { $set: { introduced: true } });
  } catch (err) {
    console.error('[DB] Failed to connect to MongoDB:', err.message);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] MongoDB disconnected, mongoose will retry automatically');
  });
}

module.exports = connectDB;
