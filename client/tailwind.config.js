/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        rt: {
          bg: "#0a0a0f",
          card: "#12121a",
          border: "#2a2a3a",
          neon: "#00f5c4",
          neon2: "#7c3aed",
          muted: "#8b8ba3",
        },
      },
      fontFamily: {
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
        display: ["'Outfit'", "system-ui", "sans-serif"],
      },
      boxShadow: {
        neon: "0 0 20px rgba(0, 245, 196, 0.25)",
        neon2: "0 0 24px rgba(124, 58, 237, 0.35)",
      },
    },
  },
  plugins: [],
};
