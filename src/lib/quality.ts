import { CliError } from "./errors.js";

export const AVATAR_VIDEO_QUALITY_VALUES = ["standard", "plus", "max"] as const;
export type AvatarVideoQuality = (typeof AVATAR_VIDEO_QUALITY_VALUES)[number];
export const DEFAULT_AVATAR_VIDEO_QUALITY: AvatarVideoQuality = "standard";

export function readAvatarVideoQuality(
  value: string | undefined,
  name = "quality",
) {
  const quality = (value ?? DEFAULT_AVATAR_VIDEO_QUALITY).trim();
  if (AVATAR_VIDEO_QUALITY_VALUES.includes(quality as AvatarVideoQuality)) {
    return quality as AvatarVideoQuality;
  }
  throw new CliError(`${name} must be standard, plus, or max.`, {
    code: "invalid_argument",
  });
}
