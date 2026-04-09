/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,tsx}"],
    theme: {
        extend: {
            fontFamily: {
                sans: ["DM Sans", "system-ui", "sans-serif"],
                mono: ["JetBrains Mono", "ui-monospace", "monospace"],
            },
            colors: {
                claw: {
                    50: "#f0fdf9",
                    100: "#ccfbef",
                    200: "#99f6e0",
                    300: "#5ee9d4",
                    400: "#2dd4bf",
                    500: "#14b8a6",
                    600: "#0d9488",
                    700: "#0f766e",
                    800: "#115e59",
                    900: "#134e4a",
                },
            },
            boxShadow: {
                glow: "0 0 40px -10px rgba(20, 184, 166, 0.35)",
            },
        },
    },
    plugins: [],
};
