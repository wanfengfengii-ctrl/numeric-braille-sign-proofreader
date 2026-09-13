import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // Docker 验收环境中 verify 服务经 compose 网络以 http://web:3000 访问本服务；
    // vite ≥5.4.12 默认只放行 localhost/IP 形式的 Host，需显式放行 compose 服务名，
    // 否则页面 403、校样台整体打不开
    allowedHosts: ['web'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
