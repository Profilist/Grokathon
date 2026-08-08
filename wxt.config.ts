import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Grok Play Feed Demo",
    version: "0.1.0",
    description: "Injects Grok Play game previews into marked X posts.",
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    host_permissions: ["https://*.supabase.co/*"],
    web_accessible_resources: [
      {
        resources: ["game.html"],
        matches: ["https://x.com/*"],
      },
    ],
  },
});
