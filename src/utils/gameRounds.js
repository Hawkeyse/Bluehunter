const fs = require('fs');
const wordListModule = require('word-list');
const { containsBadWords } = require('./badwords');

const activeRounds = new Map();
const roundTimers = new Map();

const WORD_DICTIONARY_PATH = (wordListModule && wordListModule.default) || wordListModule;
const WORD_DICTIONARY = new Set(
  fs.readFileSync(WORD_DICTIONARY_PATH, 'utf8')
    .split(/\r?\n/)
    .map((word) => normalizeWord(word))
    .filter((word) => word && word.length >= 3)
);

const WORD_BANK = {
  wordchain: ['planet', 'tiger', 'rocket', 'teapot', 'sunset', 'trophy', 'yonder', 'raven', 'nectar', 'ranger'],
  unscramble: [
    { answer: 'planet', scramble: 'tlepna' },
    { answer: 'tiger', scramble: 'tregi' },
    { answer: 'rocket', scramble: 'kocrte' },
    { answer: 'sunset', scramble: 'tseuns' },
  ],
  lastletter: ['planet', 'tiger', 'rocket', 'teapot', 'sunset', 'ranger'],
};

const TURN_TIME_MS = 30_000;
const WINNING_SCORE = 5;
const MODE_WINNING_SCORE = {
  wordchain: 5,
  unscramble: 4,
  lastletter: 5,
};

function normalizeWord(value = '') {
  return String(value).toLowerCase().replace(/[^a-z]/g, '');
}

function isValidDictionaryGuess(value = '') {
  const normalized = normalizeWord(value);
  if (!normalized || normalized.length < 3) return false;
  if (containsBadWords(normalized)) return false;
  return WORD_DICTIONARY.has(normalized);
}

function normalizePlayerId(value) {
  return String(value || '').trim();
}

function uniquePlayers(players = []) {
  return [...new Set((players || []).map(normalizePlayerId).filter(Boolean))];
}

function pickWord(gameType) {
  const words = WORD_BANK[gameType] || WORD_BANK.wordchain;
  const picked = Array.isArray(words) ? words[Math.floor(Math.random() * words.length)] : words.answer || words[0];
  if (gameType === 'unscramble') {
    return typeof picked === 'object' ? picked : { answer: String(picked), scramble: String(picked).split('').reverse().join('') };
  }
  return String(picked);
}

function getLastLetter(word) {
  const normalized = normalizeWord(word);
  return normalized.slice(-1) || '';
}

function buildScores(players) {
  return Object.fromEntries(players.map((playerId) => [playerId, 0]));
}

function buildLeaderboard(scores = {}) {
  return Object.entries(scores)
    .map(([playerId, score]) => ({ playerId, score }))
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
}

function formatLeaderboard(scores = {}, limit = 3) {
  const leaderboard = buildLeaderboard(scores).slice(0, limit);
  if (!leaderboard.length) return 'No scores yet.';
  return leaderboard
    .map((entry, index) => `${index + 1}. @${entry.playerId.split('@')[0]} — ${entry.score}`)
    .join('\n');
}

function createMentionList(ids = []) {
  return [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))];
}

function emitRoundEvent(round, event) {
  if (!round || typeof round.onTurnEvent !== 'function') return;
  Promise.resolve(round.onTurnEvent(event)).catch(() => {});
}

function nextPlayerIndex(round) {
  if (!round.players.length) return 0;
  return (round.turnIndex + 1) % round.players.length;
}

function clearTurnTimer(groupId) {
  const timer = roundTimers.get(groupId);
  if (timer) {
    clearTimeout(timer);
    roundTimers.delete(groupId);
  }
}

function scheduleTurnTimer(groupId, roundDurationMs = TURN_TIME_MS) {
  clearTurnTimer(groupId);
  const timer = setTimeout(() => {
    const round = activeRounds.get(groupId);
    if (!round || round.status !== 'playing') return;

    const currentPlayer = round.currentPlayer;
    const nextIndex = nextPlayerIndex(round);
    const previousNoResponseTurns = Number.isFinite(round.noResponseTurns) ? round.noResponseTurns : 0;
    round.noResponseTurns = previousNoResponseTurns + 1;

    if (round.noResponseTurns >= 3) {
      return cancelRound(groupId, `⏹️ Game cancelled: no one answered in time. The round was closed after repeated inactivity.`);
    }

    round.turnIndex = nextIndex;
    round.currentPlayer = round.players[nextIndex];
    round.lastTurnReason = `⏰ ${currentPlayer.split('@')[0]} ran out of time. ${round.currentPlayer.split('@')[0]}, you are up next.`;
    round.roundsPlayed += 1;
    round.turnStartedAt = Date.now();
    round.turnDeadlineAt = Date.now() + (round.roundDurationMs || roundDurationMs);
    emitRoundEvent(round, {
      type: 'timeout',
      previousPlayer: currentPlayer,
      nextPlayer: round.currentPlayer,
      reason: round.lastTurnReason,
      mentions: createMentionList([currentPlayer, round.currentPlayer]),
      round,
    });
  }, roundDurationMs);
  timer.unref?.();
  roundTimers.set(groupId, timer);
}

function finishRound(groupId, reason) {
  const round = activeRounds.get(groupId);
  if (!round) return null;

  round.status = 'finished';
  clearTurnTimer(groupId);

  const winnerId = Object.entries(round.scores).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const result = {
    valid: true,
    finished: true,
    winner: winnerId,
    reason,
    scores: { ...round.scores },
    leaderboard: formatLeaderboard(round.scores),
    currentPlayer: round.currentPlayer,
    endState: { ...round },
    reaction: '✅',
    mentions: createMentionList(winnerId ? [winnerId] : []),
  };
  activeRounds.delete(groupId);
  return result;
}

function cancelRound(groupId, reason = 'No one responded, so the game was cancelled.') {
  const round = activeRounds.get(groupId);
  if (!round) return null;

  round.status = 'cancelled';
  clearTurnTimer(groupId);
  activeRounds.delete(groupId);

  return {
    valid: false,
    cancelled: true,
    reason,
    scores: { ...round.scores },
    currentPlayer: round.currentPlayer,
    mentions: createMentionList(round.players),
  };
}

function createRound({ groupId, gameType, players = [], starterWord, starterId, roundDurationMs = TURN_TIME_MS, onTurnEvent = null }) {
  const type = gameType || 'wordchain';
  const basePlayers = uniquePlayers(players);
  if (!basePlayers.length) {
    return { groupId, gameType: type, players: [], scores: {}, status: 'empty' };
  }
  if (basePlayers.length < 2) {
    return { groupId, gameType: type, players: basePlayers, scores: buildScores(basePlayers), status: 'waiting' };
  }

  let round;
  if (type === 'unscramble') {
    const candidate = pickWord(type);
    round = {
      groupId,
      gameType: type,
      players: basePlayers,
      starterId,
      scores: buildScores(basePlayers),
      targetScore: MODE_WINNING_SCORE[type] || WINNING_SCORE,
      roundDurationMs,
      status: 'playing',
      startedAt: Date.now(),
      turnIndex: 0,
      currentPlayer: basePlayers[0],
      turnStartedAt: Date.now(),
      turnDeadlineAt: Date.now() + roundDurationMs,
      question: `Unscramble this word: ${candidate.scramble}`,
      answer: normalizeWord(candidate.answer),
      currentWord: normalizeWord(candidate.answer),
      lastLetter: getLastLetter(candidate.answer),
      usedWords: [normalizeWord(candidate.answer)],
      roundId: `${groupId}:${Date.now()}`,
      roundsPlayed: 0,
      noResponseTurns: 0,
      onTurnEvent,
    };
  } else {
    const firstWord = normalizeWord(starterWord || pickWord(type));
    round = {
      groupId,
      gameType: type,
      players: basePlayers,
      starterId,
      scores: buildScores(basePlayers),
      targetScore: MODE_WINNING_SCORE[type] || WINNING_SCORE,
      roundDurationMs,
      status: 'playing',
      startedAt: Date.now(),
      turnIndex: 0,
      currentPlayer: basePlayers[0],
      turnStartedAt: Date.now(),
      turnDeadlineAt: Date.now() + roundDurationMs,
      currentWord: firstWord,
      lastLetter: getLastLetter(firstWord),
      usedWords: [firstWord],
      roundId: `${groupId}:${Date.now()}`,
      roundsPlayed: 0,
      noResponseTurns: 0,
      onTurnEvent,
    };
  }

  activeRounds.set(groupId, round);
  scheduleTurnTimer(groupId, round.roundDurationMs);
  return round;
}

function getRoundState(groupId) {
  const round = activeRounds.get(groupId);
  if (!round) return null;
  return {
    ...round,
    players: [...round.players],
    scores: { ...round.scores },
    usedWords: [...round.usedWords],
  };
}

function clearRound(groupId) {
  clearTurnTimer(groupId);
  const round = activeRounds.get(groupId);
  activeRounds.delete(groupId);
  return round || null;
}

function submitGuess({ groupId, userId, guess }) {
  const round = activeRounds.get(groupId);
  if (!round) {
    return { valid: false, reason: 'There is no active game in this group right now.' };
  }

  const normalizedGuess = normalizeWord(guess);
  const normalizedUserId = normalizePlayerId(userId);

  if (!normalizedGuess) {
    return { valid: false, reason: 'Please send a valid word only.' };
  }

  if (!round.players.includes(normalizedUserId)) {
    return {
      valid: false,
      reaction: '❌',
      reason: 'You did not join this lobby, so you cannot answer this round.',
      mentions: createMentionList([normalizedUserId]),
    };
  }

  if (normalizedUserId !== round.currentPlayer) {
    return {
      valid: false,
      reaction: '❌',
      reason: `It is @${round.currentPlayer.split('@')[0]}'s turn. Wait for your chance.`,
      mentions: createMentionList([round.currentPlayer]),
    };
  }

  if (round.usedWords.includes(normalizedGuess)) {
    return {
      valid: false,
      reaction: '❌',
      reason: `That word was already used. Try a new word.`,
      mentions: createMentionList([normalizedUserId]),
    };
  }

  if (!isValidDictionaryGuess(normalizedGuess)) {
    scheduleTurnTimer(groupId, round.roundDurationMs);
    return {
      valid: false,
      reaction: '❌',
      reason: 'Please use a valid English dictionary word. Profanity and slang are not allowed.',
      mentions: createMentionList([normalizedUserId]),
    };
  }

  clearTurnTimer(groupId);
  round.noResponseTurns = 0;

  if (round.gameType === 'unscramble') {
    const valid = normalizedGuess === round.answer;
    if (!valid) {
      scheduleTurnTimer(groupId, round.roundDurationMs);
      return {
        valid: false,
        reaction: '❌',
        reason: 'Not quite — try to unscramble the letters correctly.',
        mentions: createMentionList([normalizedUserId]),
      };
    }

    round.scores[normalizedUserId] = (round.scores[normalizedUserId] || 0) + 1;
    round.roundsPlayed += 1;
    const nextIndex = nextPlayerIndex(round);
    round.turnIndex = nextIndex;
    const candidate = pickWord('unscramble');
    round.currentWord = normalizeWord(candidate.answer);
    round.answer = normalizeWord(candidate.answer);
    round.lastLetter = getLastLetter(candidate.answer);
    round.question = `Unscramble this word: ${candidate.scramble}`;
    round.currentPlayer = round.players[nextIndex];
    round.turnStartedAt = Date.now();
    round.turnDeadlineAt = Date.now() + round.roundDurationMs;
    round.usedWords = [normalizeWord(candidate.answer)];

    if ((round.scores[normalizedUserId] || 0) >= (round.targetScore || MODE_WINNING_SCORE.unscramble || WINNING_SCORE)) {
      return finishRound(groupId, `🏆 @${normalizedUserId.split('@')[0]} wins the round!`);
    }

    emitRoundEvent(round, {
      type: 'answer',
      playerId: normalizedUserId,
      valid: true,
      round,
      reason: `✅ ${normalizedUserId.split('@')[0]} solved it! ${round.currentPlayer.split('@')[0]}, your turn.`,
    });
    scheduleTurnTimer(groupId, round.roundDurationMs);
    return {
      valid: true,
      reaction: '✅',
      winner: normalizedUserId,
      score: round.scores[normalizedUserId],
      currentPlayer: round.currentPlayer,
      nextLetter: round.lastLetter,
      mentions: createMentionList([round.currentPlayer]),
      message: `✅ @${normalizedUserId.split('@')[0]} solved it! @${round.currentPlayer.split('@')[0]}, your turn.`,
    };
  }

  const expectedStart = round.lastLetter;
  const startsCorrectly = normalizedGuess.startsWith(expectedStart);
  if (!startsCorrectly) {
    scheduleTurnTimer(groupId, round.roundDurationMs);
    return {
      valid: false,
      reaction: '❌',
      reason: `Your word must start with "${expectedStart.toUpperCase()}".`,
      mentions: createMentionList([normalizedUserId]),
    };
  }

  round.scores[normalizedUserId] = (round.scores[normalizedUserId] || 0) + 1;
  round.usedWords.push(normalizedGuess);
  round.currentWord = normalizedGuess;
  round.lastLetter = getLastLetter(normalizedGuess);
  round.roundsPlayed += 1;

  const nextIndex = nextPlayerIndex(round);
  round.turnIndex = nextIndex;
  round.currentPlayer = round.players[nextIndex];
  round.turnStartedAt = Date.now();
  round.turnDeadlineAt = Date.now() + round.roundDurationMs;

  if ((round.scores[normalizedUserId] || 0) >= (round.targetScore || MODE_WINNING_SCORE[round.gameType] || WINNING_SCORE)) {
    return finishRound(groupId, `🏆 @${normalizedUserId.split('@')[0]} wins the game!`);
  }

  emitRoundEvent(round, {
    type: 'answer',
    playerId: normalizedUserId,
    valid: true,
    round,
    reason: `✅ "${normalizedGuess}" is valid. ${round.currentPlayer.split('@')[0]}, you’re next.`,
  });
  scheduleTurnTimer(groupId, round.roundDurationMs);
  return {
    valid: true,
    reaction: '✅',
    winner: normalizedUserId,
    nextLetter: round.lastLetter,
    currentWord: normalizedGuess,
    score: round.scores[normalizedUserId],
    currentPlayer: round.currentPlayer,
    mentions: createMentionList([round.currentPlayer]),
    message: `✅ "${normalizedGuess}" is valid. @${round.currentPlayer.split('@')[0]}, your turn.`,
  };
}

// A genuine guess is one plain word (letters/apostrophes only). Sentences,
// questions, emoji, links, etc. are someone talking about something else,
// not attempting an answer.
const GUESS_PATTERN = /^[a-zA-Z']{2,32}$/;

async function maybeHandleGameRound({ chat, msg, senderId }) {
  const groupId = chat.id._serialized;
  const round = getRoundState(groupId);
  if (!round) return false;

  const body = (msg.body || '').trim();
  if (!body || body.startsWith('/')) return false;

  const normalizedUserId = normalizePlayerId(senderId);

  // Only players who actually joined this lobby are part of the round -
  // everyone else in the group is just chatting, not missing their turn.
  // Stay completely silent for them instead of announcing they didn't join.
  if (!round.players.includes(normalizedUserId)) return false;

  // Only the player whose turn it is can be answering right now. A message
  // from any other participant is ordinary chat until their turn comes
  // up - no "wait your turn" reply for every unrelated thing they type.
  if (normalizedUserId !== round.currentPlayer) return false;

  // Give the current player's own chatter the same pass - only something
  // that actually looks like a one-word guess gets scored as right/wrong.
  if (!GUESS_PATTERN.test(body)) return false;

  const result = submitGuess({ groupId, userId: senderId, guess: body });
  if (result.cancelled) {
    await msg.reply(`${result.reason}`, undefined, result.mentions ? { mentions: result.mentions } : {});
    return true;
  }

  if (!result.valid) {
    const prefix = result.reaction || '❌';
    await msg.reply(`${prefix} ${result.reason || 'Not quite. Try again.'}`, undefined, result.mentions ? { mentions: result.mentions } : {});
    return true;
  }

  if (result.finished) {
    const leaderboard = result.leaderboard || formatLeaderboard(result.scores || {});
    await msg.reply(`${result.reason}\n🏆 Final leaderboard:\n${leaderboard}`, undefined, result.mentions ? { mentions: result.mentions } : {});
    return true;
  }

  const prefix = result.reaction || '✅';
  await msg.reply(`${prefix} ${result.message || 'Nice go!'}`, undefined, result.mentions ? { mentions: result.mentions } : {});
  return true;
}

module.exports = {
  activeRounds,
  createRound,
  getRoundState,
  clearRound,
  cancelRound,
  submitGuess,
  maybeHandleGameRound,
  TURN_TIME_MS,
  WINNING_SCORE,
};