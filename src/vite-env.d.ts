/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional: where the learning record is sent (see telemetry.ts). Unset = device only. */
  readonly VITE_TELEMETRY_URL?: string;
}
