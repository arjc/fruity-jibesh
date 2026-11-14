import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameHeader from '../GameHeader.svelte';

afterEach(() => {
	cleanup();
});

describe('GameHeader', () => {
	it('toggles sound when mute button is clicked', async () => {
		const toggleMute = vi.fn();
		const onShake = vi.fn();
		const gameState = {
			status: 'playing',
			audioManager: {
				isMuted: false,
				toggleMute
			}
		} as any;

		const { getByRole } = render(GameHeader, {
			props: { gameState, onShake }
		});

		const toggleBtn = getByRole('button', { name: 'Toggle Sound' });
		await fireEvent.click(toggleBtn);

		expect(toggleMute).toHaveBeenCalled();
	});

	it('shakes the container when the shake button is clicked', async () => {
		const onShake = vi.fn();
		const gameState = {
			status: 'playing',
			audioManager: { isMuted: false, toggleMute: vi.fn() }
		} as any;
		const { getByRole } = render(GameHeader, { props: { gameState, onShake } });

		await fireEvent.click(getByRole('button', { name: 'Shake container' }));

		expect(onShake).toHaveBeenCalledOnce();
	});

	it('shows the Fruity Jibesh title without online controls', () => {
		const gameState = {
			status: 'playing',
			audioManager: { isMuted: false, toggleMute: vi.fn() }
		} as any;
		const { getByText, queryByRole } = render(GameHeader, {
			props: { gameState, onShake: vi.fn() }
		});

		expect(getByText(/Fruity Jibesh/)).not.toBeNull();
		expect(queryByRole('button', { name: 'About' })).toBeNull();
	});
});
