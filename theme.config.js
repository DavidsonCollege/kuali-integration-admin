// Dashboard theme configuration.
//
// Override any field to rebrand the app. Anything you don't override keeps its
// default. After editing, restart the dev server (Tailwind reads this at build
// time, not runtime).
//
// Tokens are semantic, not Davidson-specific:
//   accent   — brand color: links, primary button, focus rings, hover borders
//   ink      — main text + header background
//   muted    — shaded body text (descriptions, secondary content)
//   subtle   — faint text (labels, captions, hints, header secondary)
//   rule     — borders and dividers
//   surface  — page background
//
// Fonts: pass any CSS font-family string. Set `googleFontsHref` to null and
// keep `fonts.*` set to system stacks (e.g. `'system-ui, sans-serif'`) to
// drop the Google Fonts request entirely. To use a different web font,
// replace `googleFontsHref` with that font's stylesheet URL.

module.exports = {
  colors: {
    accent: '#D42121',
    ink: '#0F1012',
    muted: '#6A6869',
    subtle: '#8D898A',
    rule: '#D4CFCE',
    surface: '#F9F5F2',
  },
  fonts: {
    display: '"Archivo", "Nimbus Sans", sans-serif',
    sans: '"Inter", Helvetica, system-ui, sans-serif',
    serif: '"Libre Caslon Text", Georgia, serif',
  },
  googleFontsHref:
    'https://fonts.googleapis.com/css2?family=Archivo:wght@500;700&family=Inter:wght@400;500;600;700&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap',
};
