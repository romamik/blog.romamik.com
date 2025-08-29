// @ts-check
import { defineConfig } from "astro/config";

import expressiveCode from "astro-expressive-code";

import tailwindcss from "@tailwindcss/vite";

import icon from "astro-icon";

// https://astro.build/config
export default defineConfig({
  integrations: [
    icon(),
    expressiveCode({
      useDarkModeMediaQuery: true,
      themeCssSelector: (theme, context) => {
        // assume there are two themes and first is dark variant, second is light variant
        // this function generates css selector for each theme
        // css selector is applied by js code in theme.ts
        let index = context.styleVariants.findIndex(
          (variant) => variant.theme === theme
        );
        if (index == 1) {
          return "[data-theme='light']";
        }
        return "[data-theme='dark']";
      },
    }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
