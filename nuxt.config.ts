// https://nuxt.com/docs/api/configuration/nuxt-config
import theme from './theme.config.js';

const fontLinks = theme.googleFontsHref
  ? [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
      { rel: 'stylesheet', href: theme.googleFontsHref }
    ]
  : [];

export default defineNuxtConfig({
  compatibilityDate: '2025-04-01',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', '@nuxt/icon'],
  css: ['~/assets/css/main.css'],
  // Client-side rendering only; pages render in the browser. The Nitro proxy
  // at server/api/graphql.post.js is the lone server-side piece (CORS dodge).
  ssr: false,
  app: {
    head: {
      title: 'Kuali Integration Admin',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ],
      link: fontLinks
    }
  }
});
