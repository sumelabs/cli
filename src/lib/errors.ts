export class CliError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly hint?: string;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      requestId?: string;
      details?: unknown;
      hint?: string;
    } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.code = options.code ?? "cli_error";
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
    this.hint = options.hint;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.status ? { status: this.status } : {}),
        ...(this.requestId ? { request_id: this.requestId } : {}),
        ...(this.details ? { details: this.details } : {}),
        ...(this.hint ? { hint: this.hint } : {}),
      },
    };
  }
}

export function asCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error) {
    return new CliError(error.message, { code: "unexpected_error" });
  }
  return new CliError("Unexpected error.", { code: "unexpected_error" });
}
