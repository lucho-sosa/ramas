import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El backend real corre en :5173 (default de launch.sh / RAMAS_PORT). En
// desarrollo levantamos Vite en otro puerto y le hacemos proxy a la API.
// En producción, `npm run build` deja el resultado en ../backend/web, que
// es la carpeta que sirve el binario Go por default.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:5173',
      '/health': 'http://localhost:5173',
    },
  },
  build: {
    outDir: '../backend/web',
    emptyOutDir: true,
  },
})
