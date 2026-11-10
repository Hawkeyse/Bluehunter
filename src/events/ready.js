// NOTE: reconstructed - your original src/events/ready.js wasn't uploaded, so this
// is a minimal version. bot.js already logs "<BOT_NAME> is online as ..." itself
// on the 'open' connection event, so this file is mostly a hook for anything else
// you want to run once the bot comes online (e.g. presence, startup notifications).
const logger = require('../utils/logger');

module.exports = function registerReadyEvent(sock) {
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      logger.info('Ready event fired - all listeners registered.');
    }
  });
};
