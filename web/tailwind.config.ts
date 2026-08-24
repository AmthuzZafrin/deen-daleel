import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Arabic needs a naskh/mushaf face with proper diacritic positioning;
        // a Latin UI font renders vocalised Qur'anic text badly.
        arabic: ["var(--font-arabic)", "Amiri", "Scheherazade New", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
