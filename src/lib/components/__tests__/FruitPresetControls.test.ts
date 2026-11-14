import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { saveFruitPresetSounds } from '../../stores/db';
import {
	fruitDisplayNames,
	fruitMergeSounds,
	resetFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound
} from '../../stores/fruitCustomizations.svelte';
import {
	fruitImageOverrides,
	resetFruitImageOverride,
	setFruitImageOverride
} from '../../stores/fruitImageOverrides.svelte';
import FruitPresetControls from '../FruitPresetControls.svelte';

afterEach(async () => {
	cleanup();
	resetFruitDisplayName('apple');
	resetFruitImageOverride('apple');
	await resetFruitMergeSound('apple');
	localStorage.removeItem('subak-fruit-presets');
	await saveFruitPresetSounds('weekend', {});
});

describe('FruitPresetControls', () => {
	it('saves and restores named presets including names, images, and sounds', async () => {
		setFruitDisplayName('apple', 'Ruby');
		setFruitImageOverride('apple', 'data:image/png;base64,cHJlc2V0');
		await setFruitMergeSound('apple', new Blob(['sound'], { type: 'audio/mpeg' }));
		const { getByRole, getByLabelText } = render(FruitPresetControls);

		await fireEvent.click(getByRole('button', { name: 'Save preset' }));
		await fireEvent.input(getByLabelText('Preset name'), { target: { value: 'Weekend' } });
		await fireEvent.click(getByRole('button', { name: 'Save' }));
		expect(localStorage.getItem('subak-fruit-presets')).toContain('"name":"Weekend"');

		await fireEvent.click(getByRole('button', { name: 'Close presets' }));
		resetFruitDisplayName('apple');
		resetFruitImageOverride('apple');
		await resetFruitMergeSound('apple');

		await fireEvent.click(getByRole('button', { name: 'Load preset' }));
		await fireEvent.click(getByRole('button', { name: 'Weekend' }));

		await waitFor(() => {
			expect(fruitDisplayNames.apple).toBe('Ruby');
			expect(fruitMergeSounds.apple).toBeInstanceOf(Blob);
		});
		expect(fruitImageOverrides.apple).toBe('data:image/png;base64,cHJlc2V0');
	});

	it('restores the built-in default preset', async () => {
		setFruitDisplayName('apple', 'Ruby');
		const { getByRole } = render(FruitPresetControls);

		await fireEvent.click(getByRole('button', { name: 'Load preset' }));
		await fireEvent.click(getByRole('button', { name: 'Default' }));

		await waitFor(() => {
			expect(fruitDisplayNames.apple).toBeUndefined();
			expect(fruitImageOverrides.apple).toBeUndefined();
			expect(fruitMergeSounds.apple).toBeUndefined();
		});
	});
});
