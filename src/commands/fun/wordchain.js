const { createGameLobby, getGameLobby } = require('../../utils/gameLobby');
const { createRound } = require('../../utils/gameRounds');

const GAME_LABELS = {
  wordchain: 'Word Chain',
  unscramble: 'Unscramble',
  lastletter: 'Last Letter',
};

function formatLobbyPlayers(players) {
  if (!players || !players.length) return '0 players';
  return `${players.length} player${players.length === 1 ? '' : 's'}`;
}

function formatModeLabel(mode) {
  return GAME_LABELS[mode] || 'Mini Game';
}

module.exports = {
  name: 'wordchain',
  aliases: ['word-chain'],
  category: 'fun',
  description: '/wordchain start - open a Word Chain lobby for 60 seconds. Anyone can join with /join.',
  groupOnly: true,
  async execute({ client, chat, msg, senderId, args }) {
    const action = (args[0] || '').toLowerCase();
    if (!action) {
      return msg.reply('🎮 To get started, use /wordchain start');
    }
    if (action !== 'start') {
      return msg.reply('Usage: /wordchain start');
    }

    const existing = getGameLobby(chat.id._serialized);
    if (existing) {
      return msg.reply(
        `🎮 A ${formatModeLabel(existing.gameType)} lobby is already open. Join it with /join. ${formatLobbyPlayers(existing.players)} so far.`
      );
    }

    const lobby = createGameLobby({
      groupId: chat.id._serialized,
      gameType: 'wordchain',
      starterId: senderId,
      ttlMs: 60_000,
      onCountdown: async (snapshot) => {
        if (snapshot.remainingSeconds <= 0) return;
        const text = `🎮 ${formatModeLabel(snapshot.gameType)} lobby: ${formatLobbyPlayers(snapshot.players)} joined. Starting in ${snapshot.remainingSeconds}s. Type /join to jump in.`;
        if (lobby.message && lobby.message.key) {
          await client.sendMessage(chat.id._serialized, { text, edit: lobby.message.key });
          return;
        }
        const sent = await chat.sendMessage(text);
        lobby.message = sent;
      },
      onStart: async (snapshot) => {
        if (snapshot.players.length < 2) {
          await chat.sendMessage(`🎮 ${formatModeLabel(snapshot.gameType)} needs at least 2 players to start. The lobby closed without starting.`);
          return;
        }

        const round = createRound({
          groupId: snapshot.groupId,
          gameType: 'wordchain',
          players: snapshot.players,
          starterId: snapshot.starterId,
          starterWord: 'planet',
          onTurnEvent: async ({ type, previousPlayer, nextPlayer, mentions }) => {
            if (type === 'timeout') {
              await chat.sendMessage(`⏰ @${previousPlayer.split('@')[0]} timed out. @${nextPlayer.split('@')[0]}, you’re up next.`, { mentions: mentions || [previousPlayer, nextPlayer] });
            }
          },
        });

        await chat.sendMessage(
          `🎮 Lobby closed! Starting ${formatModeLabel(snapshot.gameType)} with ${formatLobbyPlayers(snapshot.players)}.\n` +
            `First word: "${round.currentWord}". Reply with a word that starts with "${round.lastLetter.toUpperCase()}".`
        );
      },
    });

    const initialMessage = await chat.sendMessage(
      `🎮 ${formatModeLabel(lobby.gameType)} lobby opened! Type /join to join in the next 60 seconds.\n` +
        `Players: ${formatLobbyPlayers(lobby.players)} • 1 starter confirmed`
    );
    lobby.message = initialMessage;
  },
};
