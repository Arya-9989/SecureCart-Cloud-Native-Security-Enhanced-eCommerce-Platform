/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Year of the build (vite.config.ts), so prerendered HTML and the hydrating app agree. */
declare const __BUILD_YEAR__: number;
