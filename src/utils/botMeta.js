// Tracks when this process started, used as a proxy for "last updated" in /help.
// (It's not literally "last git commit time" - it's "since the bot last restarted",
// which in practice means "since you last deployed/updated it" for most setups.)
const BOT_START_TIME = new Date();

function getRelativeTime(date) {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);

  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

module.exports = { BOT_START_TIME, getRelativeTime };
