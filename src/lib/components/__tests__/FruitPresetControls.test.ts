import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { saveFruitPresetImages, saveFruitPresetSounds } from '../../stores/db';
import {
	fruitDisplayNames,
	fruitMergeSounds,
	resetFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound,
	trackPendingFruitMergeSoundSave,
	waitForPendingFruitMergeSoundSaves
} from '../../stores/fruitCustomizations.svelte';
import {
	fruitImageOverrides,
	resetFruitImageOverride,
	setFruitImageOverride
} from '../../stores/fruitImageOverrides.svelte';
import {
	exportFruitPresetFile,
	getFruitPreset,
	importFruitPresetFile
} from '../../stores/fruitPresets';
import FruitPresetControls from '../FruitPresetControls.svelte';

afterEach(async () => {
	cleanup();
	resetFruitDisplayName('apple');
	await resetFruitImageOverride('apple');
	await resetFruitMergeSound('apple');
	localStorage.removeItem('subak-fruit-presets');
	await saveFruitPresetSounds('weekend', {});
	await saveFruitPresetSounds('shared preset', {});
	await saveFruitPresetImages('weekend', {});
	await saveFruitPresetImages('shared preset', {});
	await saveFruitPresetImages('legacy', {});
});

describe('FruitPresetControls', () => {
	it('saves and restores named presets including names, images, and sounds', async () => {
		setFruitDisplayName('apple', 'Ruby');
		await setFruitImageOverride('apple', 'data:image/png;base64,cHJlc2V0');
		await setFruitMergeSound('apple', new Blob(['sound'], { type: 'audio/mpeg' }));
		const { getByRole, getByLabelText } = render(FruitPresetControls);

		await fireEvent.click(getByRole('button', { name: 'Save preset' }));
		await fireEvent.input(getByLabelText('Preset name'), { target: { value: 'Weekend' } });
		await fireEvent.click(getByRole('button', { name: 'Save' }));
		const storedPresets = JSON.parse(localStorage.getItem('subak-fruit-presets') ?? '[]');
		expect(storedPresets).toContainEqual(
			expect.objectContaining({ name: 'Weekend', names: { apple: 'Ruby' } })
		);
		expect(storedPresets[0].images).toBeUndefined();
		expect(localStorage.getItem('subak-fruit-image-overrides')).toBeNull();

		await fireEvent.click(getByRole('button', { name: 'Close presets' }));
		resetFruitDisplayName('apple');
		await resetFruitImageOverride('apple');
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

	it('exports a shareable preset file and imports it as a saved preset', async () => {
		const fileContent = await exportFruitPresetFile({
			name: 'Embedded preset name',
			names: { apple: 'Ruby' },
			images: { apple: 'data:image/png;base64,cHJlc2V0' },
			sounds: {
				apple: new Blob([Uint8Array.from([0xff, 0xfb, 0x90, 0x64])], {
					type: 'audio/mpeg'
				})
			}
		});
		const serialized = JSON.parse(await fileContent.text());
		expect(serialized.name).toBe('Embedded preset name');
		expect(serialized.names.apple).toBe('Ruby');
		expect(serialized.sounds.apple.type).toBe('audio/mpeg');
		expect(serialized.sounds.apple.data).toBeTruthy();
		const file = new File([fileContent], 'weekend.arjcfruits', { type: 'application/json' });

		const importedName = await importFruitPresetFile(file);
		const preset = await getFruitPreset(importedName);

		expect(importedName).toBe('Weekend');
		expect(preset?.names.apple).toBe('Ruby');
		expect(preset?.images.apple).toBe('data:image/png;base64,cHJlc2V0');
		expect(preset?.sounds.apple).toBeInstanceOf(Blob);
	});

	it('waits for an in-progress audio save before exporting', async () => {
		let finishSave: (() => void) | undefined;
		const pendingSave = new Promise<void>((resolve) => {
			finishSave = resolve;
		});
		trackPendingFruitMergeSoundSave(pendingSave);

		let finishedWaiting = false;
		const waiting = waitForPendingFruitMergeSoundSaves().then(() => {
			finishedWaiting = true;
		});
		await Promise.resolve();
		expect(finishedWaiting).toBe(false);

		finishSave?.();
		await waiting;
		expect(finishedWaiting).toBe(true);
	});

	it('loads an imported file from the Load dialog and saves it locally', async () => {
		localStorage.setItem(
			'subak-fruit-presets',
			JSON.stringify([
				{
					name: 'legacy',
					names: {},
					images: { apple: 'data:image/png;base64,cHJlc2V0' }
				}
			])
		);
		const content = await exportFruitPresetFile({
			name: 'Embedded preset name',
			names: { apple: 'Ruby' },
			images: { apple: 'data:image/png;base64,cHJlc2V0' },
			sounds: {}
		});
		const file = new File([content], 'shared.arjcfruits', { type: 'application/json' });
		const { getByRole, getByLabelText } = render(FruitPresetControls);

		await fireEvent.click(getByRole('button', { name: 'Load preset' }));
		await fireEvent.change(getByLabelText('Add preset from file'), {
			target: { files: [file] }
		});

		await waitFor(() => {
			expect(fruitDisplayNames.apple).toBe('Ruby');
			expect(localStorage.getItem('subak-fruit-presets')).toContain('"name":"shared"');
		});
		expect((await getFruitPreset('shared'))?.images.apple).toBe('data:image/png;base64,cHJlc2V0');
		const storedPresets = JSON.parse(localStorage.getItem('subak-fruit-presets') ?? '[]');
		expect(storedPresets.every((preset: { images?: unknown }) => preset.images === undefined)).toBe(
			true
		);
		expect((await getFruitPreset('legacy'))?.images.apple).toBe('data:image/png;base64,cHJlc2V0');
	});
});
