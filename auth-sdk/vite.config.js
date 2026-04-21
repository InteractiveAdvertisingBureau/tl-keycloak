import { defineConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist",
    emptyDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.js"),
      // Must differ from window.AuthSDK: Vite assigns `var <name> = exports` and overwrites `window.AuthSDK`.
      name: "TLAuthSDKBundle",
      formats: ["iife"],
      fileName: () => "auth-sdk.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: "auth-sdk[extname]",
      },
    },
  },
});
