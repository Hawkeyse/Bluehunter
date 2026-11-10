const { createGameLobby, getGameLobby, joinGameLobby } = require('../../utils/gameLobby');
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
  name: 'gamelobby',
  aliases: ['joingame', 'play-game'],
  category: 'fun',
  description: 'Legacy internal game lobby helper. Mini-game joins are handled by sending plain "join" in chat.',
  groupOnly: true,
  async execute({ client, chat, msg, senderId }) {
    const groupId = chat.id._serialized;
    const existing = getGameLobby(groupId);

    if (!existing) {
      const lobby = createGameLobby({
        groupId,
        gameType: 'wordchain',
        starterId: senderId,
        ttlMs: 60_000,
        onCountdown: async (snapshot) => {
          if (snapshot.remainingSeconds <= 0) return;
          const text = `🎮 ${formatModeLabel(snapshot.gameType)} lobby: ${formatLobbyPlayers(snapshot.players)} joined. Starting in ${snapshot.remainingSeconds}s. Type /join to jump in.`;
          if (lobby.message && lobby.message.key) {
            await client.sendMessage(groupId, { text, edit: lobby.message.key });
            return;
          }
          const sent = await chat.sendMessage(text);
          lobby.message = sent;
        },
        onStart: async (snapshot) => {
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

          if (snapshot.players.length < 2) {
            await chat.sendMessage('🎮 Word Chain needs at least 2 players to start. The lobby closed without starting.');
            return;
          }

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
      return;
    }

    if (existing.players.includes(senderId)) {
      await msg.reply(`🎮 You already joined the ${formatModeLabel(existing.gameType)} lobby. ${formatLobbyPlayers(existing.players)} ready.`);
      return;
    }

    const joined = joinGameLobby({ groupId, userId: senderId });
    const lobby = getGameLobby(groupId);
    if (!joined || !lobby) {
      await msg.reply('🎮 That lobby is already closed. Start a new one with /join.');
      return;
    }

    await msg.reply(
      `🎉 You joined the ${formatModeLabel(lobby.gameType)} lobby! ${formatLobbyPlayers(lobby.players)} so far.`
    );
  },
};
