/** @type {import('tailwindcss').Config} */
// Theme tokens (colors + fonts) live in `theme.config.js` at the project root.
// See that file (or the README) to rebrand.
const theme = require('./theme.config.js');

module.exports = {
  content: [
    './components/**/*.{vue,js,ts}',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './composables/**/*.{js,ts}',
    './app.vue'
  ],
  theme: {
    extend: {
      colors: theme.colors,
      fontFamily: {
        display: theme.fonts.display,
        sans: theme.fonts.sans,
        serif: theme.fonts.serif,
      }
    }
  },
  plugins: []
};
