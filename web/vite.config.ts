import { defineConfig } from 'vite'

export default defineConfig({
  // served at koan-shdw.github.io/koan-ansi/ in production (CI is set on Actions)
  base: process.env.CI ? '/koan-ansi/' : '/',
  server: { port: 5373, strictPort: true },
})
