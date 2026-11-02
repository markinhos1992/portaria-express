import { defineConfig } from "vite";

export default defineConfig({
  base: "/portaria-express/",
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ test: /node_modules/, name: "vendor" }],
        },
      },
    },
  },
});
