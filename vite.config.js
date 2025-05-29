import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
   base: '/', // Matches your GitHub Pages repository name
   plugins: [react()],
   server: {
     proxy: {
       '/firebase-storage': {
         target: 'https://firebasestorage.googleapis.com',
         changeOrigin: true,
         rewrite: (path) => path.replace(/^\/firebase-storage/, ''),
         configure: (proxy, options) => {
           proxy.on('proxyReq', (proxyReq, req, res) => {
             // Add CORS headers
             proxyReq.setHeader('Access-Control-Allow-Origin', '*');
           });
         }
       }
     }
   }
})
