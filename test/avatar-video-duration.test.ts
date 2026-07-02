import { describe, expect, it } from "vitest";
import { validateAvatarVideoScriptDuration } from "../src/lib/avatar-video-duration.js";

describe("avatar video duration validation", () => {
  it("matches the public script target-duration limits", () => {
    expect(validateAvatarVideoScriptDuration("hello")).toMatchObject({
      ok: true,
      total_duration_seconds: 4,
      word_count: 1,
    });

    expect(validateAvatarVideoScriptDuration(words(165))).toMatchObject({
      ok: true,
      total_duration_seconds: 60,
      word_count: 165,
    });

    expect(validateAvatarVideoScriptDuration(words(169))).toMatchObject({
      ok: false,
      total_duration_seconds: 64,
      word_count: 169,
      message: expect.stringContaining("maximum is 60 seconds"),
    });
  });

  it("keeps multiline, punctuation, and mixed-language behavior deterministic", () => {
    expect(
      validateAvatarVideoScriptDuration("one two\nthree four"),
    ).toMatchObject({
      ok: true,
      total_duration_seconds: 4,
      word_count: 4,
    });

    const punctuationBoundaryScript = [
      `${words(27, "a")}.`,
      `${words(7, "b")}.`,
      `${words(27, "c")}.`,
      `${words(7, "d")}.`,
      `${words(27, "e")}.`,
      `${words(7, "f")}.`,
      `${words(27, "g")}.`,
      `${words(7, "h")}.`,
      `${words(27, "i")}.`,
      `${words(7, "j")}.`,
    ].join(" ");
    expect(
      validateAvatarVideoScriptDuration(punctuationBoundaryScript),
    ).toMatchObject({
      ok: false,
      total_duration_seconds: 70,
      word_count: 170,
    });

    expect(
      validateAvatarVideoScriptDuration("안녕하세요 반갑습니다 Sume 입니다"),
    ).toMatchObject({
      ok: true,
      total_duration_seconds: 4,
      word_count: 4,
    });
    expect(validateAvatarVideoScriptDuration("안녕하세요반갑습니다")).toMatchObject(
      {
        ok: true,
        total_duration_seconds: 4,
        word_count: 1,
      },
    );
  });
});

function words(count: number, prefix = "word") {
  return Array.from(
    { length: count },
    (_value, index) => `${prefix}${index}`,
  ).join(" ");
}
