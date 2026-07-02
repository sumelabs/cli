import { CliError } from "./errors.js";

export const AVATAR_MODEL_IDS = {
  base: "sume/avatar/v1.0",
} as const;

export type AvatarModelId =
  (typeof AVATAR_MODEL_IDS)[keyof typeof AVATAR_MODEL_IDS];

export const AVATAR_MODEL_ID_VALUES = Object.values(
  AVATAR_MODEL_IDS,
) as AvatarModelId[];

const AVATAR_MODEL_ALIASES = {
  "sume/avatar-1.0": AVATAR_MODEL_IDS.base,
  "sume/avatar/v1": AVATAR_MODEL_IDS.base,
} as const satisfies Record<string, AvatarModelId>;

export function avatarModelRunEndpoint(modelId: AvatarModelId) {
  return `/models/${modelId}/runs`;
}

export function normalizeAvatarModelId(
  value: unknown,
  optionName = "model",
): AvatarModelId {
  if (value === undefined || value === null || value === "") {
    return AVATAR_MODEL_IDS.base;
  }

  const candidate = String(value).trim();
  const canonical =
    AVATAR_MODEL_ID_VALUES.find((modelId) => modelId === candidate) ??
    AVATAR_MODEL_ALIASES[candidate as keyof typeof AVATAR_MODEL_ALIASES];

  if (canonical) return canonical;

  throw new CliError(
    `${optionName} must be ${AVATAR_MODEL_IDS.base}.`,
    { code: "invalid_argument" },
  );
}
