import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.ET_API ?? 'http://localhost:11211',
        changeOrigin: true,
      },
    },
  },
})
