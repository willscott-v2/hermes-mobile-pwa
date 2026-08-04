import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const previewAllowedHosts = (process.env.VITE_PREVIEW_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
  },
  preview: {
    port: 4178,
    strictPort: true,
    allowedHosts: previewAllowedHosts,
  },
});
