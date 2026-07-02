import { SumeClient } from "./api-client.js";

export type CliLoginStartResponse = {
  object: "cli_login_request";
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  scopes: string[];
};

export type CliLoginPollResponse =
  | {
      object: "cli_login_exchange";
      status: "approved";
      api_key: {
        id: string;
        key: string;
        key_prefix: string;
        scopes: string[];
      };
    }
  | {
      object: "cli_login_exchange";
      status: "pending" | "denied" | "expired" | "consumed";
      interval?: number;
      expires_at?: string | null;
    };

export function startCliLogin({
  appBaseUrl,
  deviceLabel,
  fetchImpl,
}: {
  appBaseUrl: string;
  deviceLabel?: string;
  fetchImpl?: typeof fetch;
}) {
  return new SumeClient({ baseUrl: appBaseUrl, fetchImpl }).post(
    "/api/cli/auth/device/start",
    {
      ...(deviceLabel ? { device_label: deviceLabel } : {}),
    },
  ) as Promise<CliLoginStartResponse>;
}

export function pollCliLogin({
  appBaseUrl,
  deviceCode,
  fetchImpl,
}: {
  appBaseUrl: string;
  deviceCode: string;
  fetchImpl?: typeof fetch;
}) {
  return new SumeClient({ baseUrl: appBaseUrl, fetchImpl }).post(
    "/api/cli/auth/device/poll",
    { device_code: deviceCode },
  ) as Promise<CliLoginPollResponse>;
}
