import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vitest/config';

/** Stub for *.svg?component and *.svg?url imports — sveltekit-svg is SvelteKit-only, not available in vitest */
const svgComponentStub: Plugin = {
	name: 'vitest-svg-component-stub',
	resolveId(id) {
		if (id.includes('.svg?url')) {
			return '\0virtual:svg-url-stub';
		}
		if (id.includes('.svg?')) {
			return '\0virtual:svg-stub';
		}
	},
	load(id) {
		if (id === '\0virtual:svg-url-stub') {
			return 'export default "mock-svg-url";';
		}
		if (id === '\0virtual:svg-stub') {
			// Svelte 5 components are functions; return a no-op mount function
			return `const SvgStub = () => {}; SvgStub.__name = 'SvgStub'; export default SvgStub;`;
		}
	}
};

export default defineConfig({
	plugins: [
		svelte({
			preprocess: vitePreprocess({ style: false }),
			configFile: false
		}),
		svgComponentStub
	],
	resolve: {
		mainFields: ['browser', 'module', 'main'],
		conditions: ['browser']
	},
	test: {
		browser: {
			enabled: true,
			provider: 'playwright',
			headless: true,
			instances: [{ browser: 'chromium' }]
		},
		setupFiles: ['./vitest.setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}', 'src/**/*.{test,spec}.svelte.ts']
	}
});
