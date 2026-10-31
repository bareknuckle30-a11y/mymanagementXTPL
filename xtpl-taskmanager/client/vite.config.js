import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development, forward /api calls to the Express server so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:5050', '/socket.io': { target: 'http://localhost:5050', ws: true } } },
});
