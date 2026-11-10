const lobbies = new Map();

function normalizeLobbyPlayers(players = []) {
  const unique = [];
  for (const player of players) {
    if (!player) continue;
    if (!unique.includes(player)) unique.push(player);
  }
  return unique;
}

function randomGameType() {
  const gameTypes = ['wordchain', 'unscramble', 'lastletter'];
  return gameTypes[Math.floor(Math.random() * gameTypes.length)];
}

function createGameLobby({ groupId, gameType, starterId, ttlMs = 60_000, onStart = null, onCountdown = null }) {
  const lobby = {
    groupId,
    gameType: gameType || randomGameType(),
    starterId,
    players: normalizeLobbyPlayers([starterId]),
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    closed: false,
    timer: null,
    countdownTimer: null,
    onStart,
    onCountdown,
  };

  const countdownSteps = [45, 30, 20, 15, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

  if (lobby.timer) clearTimeout(lobby.timer);
  lobby.timer = setTimeout(() => {
    const current = lobbies.get(groupId);
    if (!current || current.closed) return;

    if (current.countdownTimer) {
      clearInterval(current.countdownTimer);
      current.countdownTimer = null;
    }

    const snapshot = closeGameLobby(groupId);
    if (snapshot && typeof current.onStart === 'function') {
      Promise.resolve(current.onStart(snapshot)).catch(() => {});
    }
  }, ttlMs);

  if (lobby.countdownTimer) clearInterval(lobby.countdownTimer);
  lobby.countdownTimer = setInterval(() => {
    const current = lobbies.get(groupId);
    if (!current || current.closed) return;

    const remainingSeconds = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000));
    if (!remainingSeconds || !countdownSteps.includes(remainingSeconds)) return;

    if (typeof current.onCountdown === 'function') {
      Promise.resolve(current.onCountdown({ ...current, remainingSeconds, players: [...current.players] })).catch(() => {});
    }
  }, 1000);

  lobbies.set(groupId, lobby);
  return lobby;
}

function getGameLobby(groupId) {
  const lobby = lobbies.get(groupId);
  if (!lobby) return null;
  if (lobby.closed) {
    lobbies.delete(groupId);
    return null;
  }
  return lobby;
}

function joinGameLobby({ groupId, userId }) {
  const lobby = getGameLobby(groupId);
  if (!lobby) return false;
  if (lobby.players.includes(userId)) return false;

  lobby.players = normalizeLobbyPlayers([...lobby.players, userId]);
  return true;
}

function closeGameLobby(groupId) {
  const lobby = lobbies.get(groupId);
  if (!lobby) return null;

  if (lobby.timer) clearTimeout(lobby.timer);
  if (lobby.countdownTimer) clearInterval(lobby.countdownTimer);
  lobby.closed = true;
  const snapshot = {
    ...lobby,
    players: [...lobby.players],
  };
  lobbies.delete(groupId);
  return snapshot;
}

function maybeHandleLobbyJoin({ groupId, userId }) {
  const lobby = getGameLobby(groupId);
  if (!lobby) return { handled: false };

  if (lobby.players.includes(userId)) {
    return {
      handled: true,
      joined: false,
      reason: `🎮 You already joined the ${lobby.gameType} lobby. ${lobby.players.length} player${lobby.players.length === 1 ? '' : 's'} ready.`,
    };
  }

  const joined = joinGameLobby({ groupId, userId });
  if (!joined) {
    return { handled: true, joined: false, reason: '🎮 That lobby is already closed.' };
  }

  return {
    handled: true,
    joined: true,
    lobby: getGameLobby(groupId),
    reason: `🎉 You joined the ${lobby.gameType} lobby! ${getGameLobby(groupId).players.length} player${getGameLobby(groupId).players.length === 1 ? '' : 's'} so far.`,
  };
}

module.exports = {
  lobbies,
  randomGameType,
  createGameLobby,
  getGameLobby,
  joinGameLobby,
  closeGameLobby,
  maybeHandleLobbyJoin,
};
