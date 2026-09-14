import type { Config } from 'tailwindcss';
import preset from '@reef-technologies/ui/tailwind-preset';

export default {
  // Scans the UI package too, so its class names survive purging.
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
  presets: [preset],
} satisfies Config;
