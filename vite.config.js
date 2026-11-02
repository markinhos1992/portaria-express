import { defineConfig } from "vite";

export default defineConfig({
  base: "/portaria-express/",
  build: {
    sourcemap: false,
    rolldownOptions: {
      input: { main: "index.html", recuperar: "recuperar.html" },
      output: {
        codeSplitting: {
          groups: [{ test: /node_modules/, name: "vendor" }],
        },
      },
    },
  },
});
