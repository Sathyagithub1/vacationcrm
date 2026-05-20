import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#FFF3E0",
          100: "#FFE0B2",
          200: "#FFCC80",
          300: "#FFB74D",
          400: "#FF9F1C",
          500: "#FF6B35",
          600: "#E55A2B",
          700: "#CC4A22",
          800: "#B23A18",
          900: "#8B2500",
        },
        surface: "#F8F9FA",
        card: "#FFFFFF",
      },
    },
  },
  plugins: [],
};
export default config;
