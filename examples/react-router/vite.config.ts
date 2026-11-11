import { reactRouter } from '@react-router/dev/vite';
import { everylocale } from '@everylocale/react-router/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [reactRouter(), everylocale()] });
