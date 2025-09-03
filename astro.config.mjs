// @ts-check
import { defineConfig } from "astro/config";

import expressiveCode from "astro-expressive-code";

import tailwindcss from "@tailwindcss/vite";

import icon from "astro-icon";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";

// https://astro.build/config
export default defineConfig({
  integrations: [
    icon(),
    expressiveCode({
      useDarkModeMediaQuery: true,
      defaultProps: {
        wrap: true,
        preserveIndent: true,
        hangingIndent: 4,
      },
      plugins: [pluginCollapsibleSections(), pluginLineNumbers()],
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
