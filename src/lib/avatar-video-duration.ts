export const AVATAR_VIDEO_MIN_CLIP_SECONDS = 4;
export const AVATAR_VIDEO_MAX_CLIP_SECONDS = 12;
export const AVATAR_VIDEO_WORDS_PER_SECOND = 2.8;
export const AVATAR_VIDEO_MIN_CHUNK_WORDS = 7;
export const AVATAR_VIDEO_MIN_TOTAL_DURATION_SECONDS =
  AVATAR_VIDEO_MIN_CLIP_SECONDS;
export const AVATAR_VIDEO_MAX_TOTAL_DURATION_SECONDS = 60;

export type AvatarVideoScriptChunk = {
  duration_seconds: number;
  index: number;
  text: string;
  word_count: number;
};

export type AvatarVideoScriptAnalysis = {
  chunks: AvatarVideoScriptChunk[];
  max_duration_seconds: number;
  min_duration_seconds: number;
  total_duration_seconds: number;
  word_count: number;
};

export type AvatarVideoScriptDurationValidation =
  | (AvatarVideoScriptAnalysis & { ok: true })
  | (AvatarVideoScriptAnalysis & { message: string; ok: false });

export function analyzeAvatarVideoScript(
  script: string,
): AvatarVideoScriptAnalysis {
  const chunks = chunkAvatarVideoScript(script);
  return {
    chunks,
    max_duration_seconds: AVATAR_VIDEO_MAX_TOTAL_DURATION_SECONDS,
    min_duration_seconds: AVATAR_VIDEO_MIN_TOTAL_DURATION_SECONDS,
    total_duration_seconds: chunks.reduce(
      (total, chunk) => total + chunk.duration_seconds,
      0,
    ),
    word_count: chunks.reduce((total, chunk) => total + chunk.word_count, 0),
  };
}

export function validateAvatarVideoScriptDuration(
  script: string,
): AvatarVideoScriptDurationValidation {
  const analysis = analyzeAvatarVideoScript(script);
  if (analysis.chunks.length === 0 || analysis.word_count === 0) {
    return {
      ...analysis,
      message: "Avatar video script must include at least one word.",
      ok: false,
    };
  }
  if (
    analysis.total_duration_seconds <
    AVATAR_VIDEO_MIN_TOTAL_DURATION_SECONDS
  ) {
    return {
      ...analysis,
      message: `Avatar video script is estimated at ${analysis.total_duration_seconds} seconds; minimum is ${AVATAR_VIDEO_MIN_TOTAL_DURATION_SECONDS} seconds.`,
      ok: false,
    };
  }
  if (
    analysis.total_duration_seconds >
    AVATAR_VIDEO_MAX_TOTAL_DURATION_SECONDS
  ) {
    return {
      ...analysis,
      message: `Avatar video script is estimated at ${analysis.total_duration_seconds} seconds; maximum is ${AVATAR_VIDEO_MAX_TOTAL_DURATION_SECONDS} seconds. Shorten the script or split it into multiple videos.`,
      ok: false,
    };
  }
  return { ...analysis, ok: true };
}

function chunkAvatarVideoScript(script: string) {
  const sentences = splitSentences(script);
  const maxWords = Math.floor(
    AVATAR_VIDEO_MAX_CLIP_SECONDS * AVATAR_VIDEO_WORDS_PER_SECOND,
  );
  const chunks: AvatarVideoScriptChunk[] = [];
  let current: string[] = [];

  for (const sentence of sentences) {
    const sentenceWords = wordsOf(sentence);

    if (sentenceWords.length > maxWords) {
      if (current.length) {
        chunks.push(buildChunk(chunks.length, current));
        current = [];
      }

      for (const part of splitWordsIntoBalancedParts(sentenceWords, maxWords)) {
        chunks.push(buildChunk(chunks.length, part));
      }
      continue;
    }

    const candidate = [...current, ...sentenceWords];
    if (
      current.length &&
      candidate.length > maxWords &&
      current.length >= AVATAR_VIDEO_MIN_CHUNK_WORDS
    ) {
      chunks.push(buildChunk(chunks.length, current));
      current = sentenceWords;
    } else {
      current = candidate;
    }
  }

  if (current.length) {
    chunks.push(buildChunk(chunks.length, current));
  }

  const tail = chunks[chunks.length - 1];
  const previous = chunks[chunks.length - 2];
  if (
    chunks.length > 1 &&
    tail &&
    previous &&
    tail.word_count < AVATAR_VIDEO_MIN_CHUNK_WORDS &&
    previous.word_count + tail.word_count <= maxWords
  ) {
    const mergedWords = [...wordsOf(previous.text), ...wordsOf(tail.text)];
    chunks.splice(
      chunks.length - 2,
      2,
      buildChunk(chunks.length - 2, mergedWords),
    );
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

function splitSentences(script: string) {
  const matches = script.match(/[^.!?。！？]+[.!?。！？]?/gu) ?? [script];
  return matches.map((match) => match.trim()).filter(Boolean);
}

function wordsOf(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function splitWordsIntoBalancedParts(words: string[], maxWords: number) {
  const partCount = Math.max(1, Math.ceil(words.length / maxWords));
  const targetSize = Math.ceil(words.length / partCount);
  const parts: string[][] = [];

  for (let index = 0; index < words.length; index += targetSize) {
    parts.push(words.slice(index, index + targetSize));
  }

  return parts;
}

function buildChunk(index: number, words: string[]) {
  const durationSeconds = Math.min(
    AVATAR_VIDEO_MAX_CLIP_SECONDS,
    Math.max(
      AVATAR_VIDEO_MIN_CLIP_SECONDS,
      Math.ceil(words.length / AVATAR_VIDEO_WORDS_PER_SECOND),
    ),
  );
  return {
    duration_seconds: durationSeconds,
    index,
    text: words.join(" "),
    word_count: words.length,
  };
}
