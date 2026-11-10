const {
  OPENAI_API_KEY,
  AI_MODEL,
  YARNGPT_API_KEY,
  YARNGPT_TTS_VOICE,
} = require('../config');
const logger = require('./logger');

// Bounds worst-case latency on a stalled/slow connection - every call here
// already fails soft (returns null) on any error, so a timeout just makes
// that fail-soft happen quickly instead of hanging the message handler
// indefinitely. The safety-net check runs on EVERY group message (not just
// opt-in features), so it gets a tighter bound - speed matters more there
// than giving OpenAI extra time to respond.
const SAFETY_CHECK_TIMEOUT_MS = 8_000;
const OPENAI_TIMEOUT_MS = 20_000;
const YARNGPT_TIMEOUT_MS = 45_000;
const YARNGPT_BASE_URL = 'https://api.yarngpt.ai/api/v1';
const VOICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let voiceCache = { expiresAt: 0, voices: [] };

/**
 * Sends a chat completion request to OpenAI. `imageBase64` is optional - if
 * provided, the model receives it as vision input alongside the text.
 * Returns the reply text, or null if the request failed (fails soft, never
 * throws into the message handler - a bad AI reply shouldn't crash the bot).
 */
async function getAiReply(systemPrompt, userText, imageBase64) {
  if (!OPENAI_API_KEY) {
    logger.warn('AI chat is enabled in a group but OPENAI_API_KEY is not set.');
    return null;
  }

  const userContent = imageBase64
    ? [
        { type: 'text', text: userText || 'What is this?' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
      ]
    : userText;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 300,
        temperature: 1,
        presence_penalty: 0.5,
        frequency_penalty: 0.5,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error('OpenAI API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    logger.error('OpenAI request failed:', err.message);
    return null;
  }
}

/**
 * Moderation-specific call: asks for a strict JSON verdict instead of a
 * conversational reply. temperature 0 and a short max_tokens - we want a
 * consistent, terse yes/no + reason, not creativity or padding.
 */
async function getModerationVerdict(systemPrompt, userText, imageBase64, imageMimetype) {
  if (!OPENAI_API_KEY) {
    logger.warn('AI moderation is enabled in a group but OPENAI_API_KEY is not set.');
    return null;
  }

  const userContent = imageBase64
    ? [
        { type: 'text', text: userText || '(no caption/text - judge the image/video frame alone)' },
        { type: 'image_url', image_url: { url: `data:${imageMimetype || 'image/jpeg'};base64,${imageBase64}` } },
      ]
    : userText || '(empty message)';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 200,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error('OpenAI moderation API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;

    // Strip markdown code fences in case the model wraps the JSON anyway,
    // despite being told not to.
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (typeof parsed.violation !== 'boolean') return null;
    return parsed;
  } catch (err) {
    logger.error('AI moderation request failed:', err.message);
    return null; // fails soft - a broken/unparseable verdict should never block a message
  }
}

/**
 * Transcribes a voice note via Whisper so its content can be text-moderated
 * (aiModeration.js), or fed into AI chat (aiChat.js), like any other message.
 * This is a SEPARATE billable API call from the main chat completion above -
 * factor this into cost expectations if voice notes are common in your
 * groups. Requires Node 18+ for global FormData/Blob (already implied by
 * this file's bare `fetch` usage above).
 *
 * Whisper has no dedicated Nigerian Pidgin language code (it's
 * English-derived, not a separate script), so a short or heavily-accented
 * clip can otherwise get misdetected as an unrelated language entirely -
 * hinting `language: 'en'` biases decoding toward English without
 * translating the words, which is what actually improves Pidgin accuracy.
 */
async function transcribeAudio(buffer, mimetype) {
  if (!OPENAI_API_KEY) return null;

  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), 'voice-note.ogg');
    form.append('model', 'whisper-1');
    // Deliberately NOT forcing language: 'en' - Whisper auto-detects when
    // this is omitted, which is what lets it handle Nigerian/Ghanaian
    // Pidgin, standard English, or genuinely any other language correctly.
    // Forcing 'en' told Whisper to assume every voice note was English
    // regardless of what was actually said - fine for AI moderation's
    // narrow use (flagging English-language violations), but wrong for a
    // general-purpose transcription feature meant to handle any language.

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error('OpenAI transcription API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.text?.trim() || null;
  } catch (err) {
    logger.error('Audio transcription failed:', err.message);
    return null; // fails soft - a failed transcription should never block a message
  }
}

/**
 * Mandatory baseline safety check via OpenAI's free moderation endpoint
 * (omni-moderation-latest) - deliberately NOT the paid chat-completions call
 * used above, since this needs to run on every group message unconditionally
 * without adding to API cost. Returns the raw result object (with
 * .category_scores etc.) or null on failure/no API key (fails open).
 */
async function checkSafetyBaseline(text, imageBase64, imageMimetype) {
  if (!OPENAI_API_KEY) return null;

  const input = [];
  if (text) input.push({ type: 'text', text });
  if (imageBase64) input.push({ type: 'image_url', image_url: { url: `data:${imageMimetype || 'image/jpeg'};base64,${imageBase64}` } });
  if (input.length === 0) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: AbortSignal.timeout(SAFETY_CHECK_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error('OpenAI baseline moderation API error:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.results?.[0] || null;
  } catch (err) {
    logger.error('Baseline safety check failed:', err.message);
    return null;
  }
}

function normVoice(v) {
  return String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findVoice(name) {
  const want = normVoice(name);
  if (!want) return null;
  const hit = voiceCache.voices.find((v) => normVoice(v.name) === want || normVoice(v.id) === want);
  return hit?.id || null;
}

async function getYarnGptVoiceId(name) {
  if (Date.now() < voiceCache.expiresAt) return findVoice(name);

  const res = await fetch(`${YARNGPT_BASE_URL}/voices`, {
    headers: { Authorization: `Bearer ${YARNGPT_API_KEY}` },
    signal: AbortSignal.timeout(YARNGPT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text();
    logger.error('YarnGPT voices API error:', res.status, errText);
    return null;
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : data.voices || data.data || data.items;
  if (!Array.isArray(list)) {
    logger.error('YarnGPT voices API returned an unexpected response.');
    return null;
  }
  voiceCache = {
    expiresAt: Date.now() + VOICE_CACHE_TTL_MS,
    voices: list.map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      const id = item.id || item.voice_id || item.voiceId || item.name || item.voice;
      const label = item.name || item.display_name || item.displayName || item.voice_name || item.voice || id;
      return { id, name: label };
    }).filter((item) => typeof item.id === 'string' && typeof item.name === 'string'),
  };
  logger.info?.(`YarnGPT voice catalogue loaded: ${voiceCache.voices.map((v) => v.name).join(', ') || '(empty)'}`);
  return findVoice(name);
}

async function getFirstYarnGptVoiceId() {
  // '' never matches a real name, but calling the resolver loads or refreshes
  // the catalogue cache first.
  await getYarnGptVoiceId('');
  return voiceCache.voices[0]?.id || null;
}

/**
 * Resolves the configured YarnGPT voice name and requests a ready-to-send
 * Opus stream. On failure, AI chat falls back to sending its text reply.
 */
async function getTtsAudio(text, voiceName = YARNGPT_TTS_VOICE) {
  if (!YARNGPT_API_KEY || !text) {
    if (!YARNGPT_API_KEY && text) logger.warn('AI voice replies need YARNGPT_API_KEY; sending a text reply instead.');
    return null;
  }
  if (text.length > 15_000) {
    logger.warn('YarnGPT TTS text exceeds the 15,000-character limit; sending a text reply instead.');
    return null;
  }

  try {
    let voice = await getYarnGptVoiceId(voiceName);
    if (!voice) {
      // Catalogue lookup missed (or the catalogue call failed) - the API
      // accepts voice names, so ask for the configured voice by name rather
      // than silently switching to a different speaker.
      voice = voiceName;
      logger.warn(`YarnGPT voice "${voiceName}" not matched in the catalogue; requesting it by name.`);
    }

    const prepare = (voiceId) => fetch(`${YARNGPT_BASE_URL}/tts/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${YARNGPT_API_KEY}`,
      },
      body: JSON.stringify({ text, voice: voiceId, output_format: 'opus' }),
      signal: AbortSignal.timeout(YARNGPT_TIMEOUT_MS),
    });
    let prepared = await prepare(voice);
    if (!prepared.ok && prepared.status >= 400 && prepared.status < 500 && prepared.status !== 401 && prepared.status !== 402 && prepared.status !== 429) {
      const firstId = await getFirstYarnGptVoiceId();
      if (firstId && firstId !== voice) {
        logger.warn(`YarnGPT rejected voice "${voice}" (${prepared.status}); retrying with "${firstId}".`);
        prepared = await prepare(firstId);
      }
    }
    if (!prepared.ok) {
      const errText = await prepared.text();
      logger.error('YarnGPT TTS prepare API error:', prepared.status, errText);
      return null;
    }

    const { ticket, stream_url: streamUrl } = await prepared.json();
    if (!ticket || !streamUrl) {
      logger.error('YarnGPT TTS prepare response is missing its ticket or stream URL.');
      return null;
    }
    const stream = new URL(streamUrl, `${YARNGPT_BASE_URL}/`);
    if (stream.protocol !== 'https:' || stream.hostname !== 'api.yarngpt.ai') {
      logger.error('YarnGPT returned an invalid audio stream URL.');
      return null;
    }

    const audio = await fetch(stream, { signal: AbortSignal.timeout(YARNGPT_TIMEOUT_MS) });
    if (!audio.ok) {
      const errText = await audio.text();
      logger.error('YarnGPT audio stream error:', audio.status, errText);
      return null;
    }
    const buffer = Buffer.from(await audio.arrayBuffer());
    if (!buffer.length) {
      logger.error('YarnGPT returned an empty audio stream.');
      return null;
    }
    return buffer;
  } catch (err) {
    logger.error('YarnGPT TTS request failed:', err.message);
    return null;
  }
}


/**
 * Turns a short natural-language request into a JSON object using the system
 * prompt's schema (used for "BlueHunter, <do something>" admin requests).
 * Returns the parsed object, or null on any failure (fails soft like the rest
 * of this file - an unparseable answer should never run an action).
 */
async function getCommandIntent(systemPrompt, userText) {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 250,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.error('OpenAI intent API error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    logger.error('AI intent request failed:', err.message);
    return null;
  }
}

module.exports = { getAiReply, getModerationVerdict, getCommandIntent, transcribeAudio, checkSafetyBaseline, getTtsAudio };