import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  base: './', 
  build: {
    outDir: 'dist'
  },
  server: {
    watch: {
      ignored: [
        '**/C:/DumpStack.log.tmp',   // bu dosyayı ignore et
        '**/node_modules/**',        // node_modules zaten ignore edilmeli
        '**/dist/**'                 // build çıktısını izleme
      ]
    }
  }
});
