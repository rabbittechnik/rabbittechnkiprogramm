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
        cyber: ["'Orbitron'", "system-ui", "sans-serif"],
        hud: ["'Rajdhani'", "system-ui", "sans-serif"],
      },
      boxShadow: {
        neon: "0 0 20px rgba(0, 245, 196, 0.25)",
        neon2: "0 0 24px rgba(124, 58, 237, 0.35)",
      },
      keyframes: {
        "neon-breathe": {
          "0%, 100%": {
            boxShadow:
              "0 0 18px rgba(var(--tile-glow-rgb), 0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
            filter: "brightness(1)",
          },
          "50%": {
            boxShadow:
              "0 0 36px rgba(var(--tile-glow-rgb), 0.75), 0 0 56px rgba(var(--tile-glow-rgb), 0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
            filter: "brightness(1.08)",
          },
        },
        "scanline-drift": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "line-glow": {
          "0%, 100%": { opacity: "0.65", filter: "brightness(1)" },
          "50%": { opacity: "1", filter: "brightness(1.35)" },
        },
        "cta-pulse": {
          "0%, 100%": {
            boxShadow: "0 0 20px rgba(57, 255, 20, 0.35), inset 0 0 20px rgba(57, 255, 20, 0.08)",
          },
          "50%": {
            boxShadow: "0 0 32px rgba(57, 255, 20, 0.55), inset 0 0 28px rgba(57, 255, 20, 0.12)",
          },
        },
      },
      animation: {
        "neon-breathe": "neon-breathe 3.2s ease-in-out infinite",
        "scanline-drift": "scanline-drift 10s linear infinite",
        "line-glow": "line-glow 4s ease-in-out infinite",
        "cta-pulse": "cta-pulse 2.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
