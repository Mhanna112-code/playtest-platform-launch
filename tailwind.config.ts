import type { Config } from "tailwindcss";

// The full Playtest Platform's palette (NEWEST+7): slate / indigo / fuchsia are remapped, so the classes used across
// the app pick up the brand. ink = blue-black neutrals, volt = the signature lime, punch = a hot coral.
const ink = {
  50: "#f4f6fb", 100: "#e8ecf5", 200: "#cdd5e5", 300: "#a8b3cc", 400: "#8792ad", 500: "#646f8c",
  600: "#47506b", 700: "#323a54", 800: "#20263b", 900: "#141829", 950: "#0a0d18",
};
const volt = {
  50: "#f9ffe0", 100: "#f1ffb8", 200: "#e8ff8a", 300: "#d8fc52", 400: "#c6f02c", 500: "#a8d90f",
  600: "#83ad07", 700: "#62820b", 800: "#4e6610", 900: "#425612", 950: "#223003",
};
const punch = {
  50: "#fff1f4", 100: "#ffe1e8", 200: "#ffc7d4", 300: "#ff9db6", 400: "#ff6c93", 500: "#ff3f72",
  600: "#ed1f5c", 700: "#c8124c", 800: "#a71345", 900: "#8e1440", 950: "#50051e",
};

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { background: "var(--background)", foreground: "var(--foreground)", slate: ink, ink, indigo: volt, volt, fuchsia: punch, punch },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
