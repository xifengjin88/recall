import type { Config } from "@react-router/dev/config";

export default {
  // Progress lives in localStorage, so there's nothing to render on a server.
  // SPA mode pre-renders the root shell into build/client/index.html.
  ssr: false,
} satisfies Config;
