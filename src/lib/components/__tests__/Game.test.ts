import { cleanup, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveFruitPresetSounds } from '../../stores/db';
import { saveFruitPreset } from '../../stores/fruitPresets';
import { GameState } from '../../stores/game.svelte.js';
import Game from '../Game.svelte';

const proto = GameState.prototype as any;

beforeEach(() => {
	// Prevent real physics/audio init; set status to 'playing' as default
	vi.spyOn(proto, 'init').mockImplementation(async function (this: any) {
		this.audioManager = { isMuted: false, toggleMute: vi.fn() };
		this.status = 'playing';
		this.score = 10;
	});
	vi.spyOn(proto, 'destroy').mockImplementation(() => {});
});

afterEach(async () => {
	vi.restoreAllMocks();
	cleanup();
	localStorage.removeItem('subak-fruit-presets');
	await saveFruitPresetSounds('menu preset', {});
});

function getBeforeUnloadHandler(addSpy: ReturnType<typeof vi.spyOn>) {
	const call = (addSpy.mock.calls as [string, EventListener][]).find(
		([type]) => type === 'beforeunload'
	);
	return call?.[1] as ((event: Partial<BeforeUnloadEvent>) => void) | undefined;
}

function getVisibilityChangeHandler(addSpy: ReturnType<typeof vi.spyOn>) {
	const call = (addSpy.mock.calls as [string, EventListener][]).find(
		([type]) => type === 'visibilitychange'
	);
	return call?.[1] as (() => void) | undefined;
}

function getDeviceMotionHandler(addSpy: ReturnType<typeof vi.spyOn>) {
	const call = (addSpy.mock.calls as [string, EventListener][]).find(
		([type]) => type === 'devicemotion'
	);
	return call?.[1] as ((event: DeviceMotionEvent) => void) | undefined;
}

function setHidden(hidden: boolean) {
	Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

describe('Game device-motion shake', () => {
	it('shakes only on a strong device-motion event and removes its listener on unmount', async () => {
		const shakeSpy = vi.spyOn(proto, 'shakeContainer').mockImplementation(() => {});
		const addSpy = vi.spyOn(window, 'addEventListener');
		const removeSpy = vi.spyOn(window, 'removeEventListener');
		const { unmount } = render(Game);
		await tick();

		const handler = getDeviceMotionHandler(addSpy);
		expect(handler).toBeDefined();

		const weakMotion = new Event('devicemotion') as DeviceMotionEvent;
		Object.defineProperty(weakMotion, 'acceleration', {
			value: { x: 2, y: 0, z: 0 }
		});
		handler?.(weakMotion);
		expect(shakeSpy).not.toHaveBeenCalled();

		const strongMotion = new Event('devicemotion') as DeviceMotionEvent;
		Object.defineProperty(strongMotion, 'acceleration', {
			value: { x: 16, y: 0, z: 0 }
		});
		handler?.(strongMotion);
		expect(shakeSpy).toHaveBeenCalledOnce();

		unmount();
		expect(removeSpy).toHaveBeenCalledWith('devicemotion', handler);
	});
});

describe('Game beforeunload guard', () => {
	it('calls preventDefault when game is in progress', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');
		render(Game);

		const handler = getBeforeUnloadHandler(addSpy);
		const event = { preventDefault: vi.fn() };
		handler?.(event);

		expect(handler).toBeDefined();
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('does not call preventDefault when game is not in progress', () => {
		proto.init.mockImplementationOnce(async function (this: any) {
			this.audioManager = { isMuted: false, toggleMute: vi.fn() };
			// status intentionally left as 'uninitialized'
		});

		const addSpy = vi.spyOn(window, 'addEventListener');
		render(Game);

		const handler = getBeforeUnloadHandler(addSpy);
		const event = { preventDefault: vi.fn() };
		handler?.(event);

		expect(handler).toBeDefined();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('does not call preventDefault when game is in progress but score is 0', () => {
		proto.init.mockImplementationOnce(async function (this: any) {
			this.audioManager = { isMuted: false, toggleMute: vi.fn() };
			this.status = 'playing';
			this.score = 0;
		});

		const addSpy = vi.spyOn(window, 'addEventListener');
		render(Game);

		const handler = getBeforeUnloadHandler(addSpy);
		const event = { preventDefault: vi.fn() };
		handler?.(event);

		expect(handler).toBeDefined();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('removes the listener when the component unmounts', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');
		const removeSpy = vi.spyOn(window, 'removeEventListener');

		const { unmount } = render(Game);

		const registeredHandler = getBeforeUnloadHandler(addSpy);
		unmount();

		const removeCall = (removeSpy.mock.calls as [string, EventListener][]).find(
			([type]) => type === 'beforeunload'
		);
		expect(removeCall?.[1]).toBe(registeredHandler);
	});
});

describe('Game tab-visibility pause/resume', () => {
	afterEach(() => {
		setHidden(false);
	});

	it('resumes play after the tab is hidden and shown again', () => {
		// Track status transitions without running the real physics loop.
		const setStatus = vi.spyOn(proto, 'setStatus').mockImplementation(function (
			this: any,
			status: string
		) {
			this.status = status;
		});
		const addSpy = vi.spyOn(document, 'addEventListener');
		render(Game);

		const handler = getVisibilityChangeHandler(addSpy);
		expect(handler).toBeDefined();

		// Tab hidden while playing → paused
		setHidden(true);
		handler?.();
		expect(setStatus).toHaveBeenLastCalledWith('paused');

		// Tab visible again → resumed to playing (not stuck in paused)
		setHidden(false);
		handler?.();
		expect(setStatus).toHaveBeenLastCalledWith('playing');
	});

	it('does not resume a game that was already paused before hiding', () => {
		// Game paused deliberately (e.g. About modal open) before switching tabs.
		proto.init.mockImplementationOnce(async function (this: any) {
			this.audioManager = { isMuted: false, toggleMute: vi.fn() };
			this.status = 'paused';
		});

		const setStatus = vi.spyOn(proto, 'setStatus');
		const addSpy = vi.spyOn(document, 'addEventListener');
		render(Game);

		const handler = getVisibilityChangeHandler(addSpy);

		// Hidden: nothing to do, we didn't pause it
		setHidden(true);
		handler?.();
		// Visible again: must NOT force it back to playing
		setHidden(false);
		handler?.();

		expect(setStatus).not.toHaveBeenCalledWith('playing');
	});
});

describe('Game main menu', () => {
	it('shows preset choices, import, instructions, and a tip', async () => {
		localStorage.removeItem('subak-fruit-presets');
		await saveFruitPreset({
			name: 'Menu preset',
			names: {},
			images: {},
			sounds: {}
		});
		proto.init.mockImplementationOnce(async function (this: any) {
			this.audioManager = { isMuted: false, toggleMute: vi.fn() };
		});

		const { getByRole, getByLabelText, getByText } = render(Game);
		await waitFor(() => {
			expect((getByRole('button', { name: 'Start Game' }) as HTMLButtonElement).disabled).toBe(
				false
			);
		});

		expect(getByRole('button', { name: 'Default' })).not.toBeNull();
		expect(getByRole('button', { name: 'Menu preset' })).not.toBeNull();
		expect(getByLabelText('Import preset from file')).not.toBeNull();
		expect(getByRole('heading', { name: 'How to play' })).not.toBeNull();
		expect(getByText(/^Tip:/)).not.toBeNull();
	});
});
