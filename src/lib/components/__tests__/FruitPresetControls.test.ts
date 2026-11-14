import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getFruitImageOverrides as getStoredFruitImageOverrides,
	getFruitMergeSounds as getStoredFruitMergeSounds,
	saveFruitPresetImages,
	saveFruitPresetSounds
} from '../../stores/db';
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
	applyFruitPresetTemporarily,
	exportFruitPresetFile,
	getFruitPreset,
	importFruitPresetData,
	importFruitPresetFile,
	parseFruitPresetData
} from '../../stores/fruitPresets';
import FruitPresetControls from '../FruitPresetControls.svelte';

afterEach(async () => {
	cleanup();
	resetFruitDisplayName('apple');
	await resetFruitImageOverride('apple');
	await resetFruitMergeSound('apple');
	localStorage.removeItem('subak-fruit-presets');
	localStorage.removeItem('subak-fruit-preset-shared-once');
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

	it('exports a self-contained HTML launcher and imports its data locally', async () => {
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
		expect(fileContent.type).toBe('text/html;charset=utf-8');
		const html = await fileContent.text();
		expect(html).toContain('Open preset in Fruity Jibesh');
		expect(html).toContain('window.open(targetOrigin');
		expect(html).toContain('fruity-jibesh-preset-data');
		expect(html).toContain("connect-src 'none'");
		expect(html).toContain('ARJC • Arjun M. Liji');
		expect(html).toContain('CC BY-NC 4.0');
		expect(html).toContain('nobody can promise every copy is virus-free');
		expect(html).toContain('not responsible for community-shared or modified preset contents');
		const presetJson =
			/<script id="preset-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
		expect(presetJson).toBeTruthy();
		if (!presetJson) throw new Error('HTML launcher did not include preset data.');
		const serialized = JSON.parse(presetJson);
		expect(serialized.names.apple).toBe('Ruby');
		const payload = new TextEncoder().encode(presetJson);
		const importedName = await importFruitPresetData(payload, 'Weekend');
		const preset = await getFruitPreset(importedName);

		expect(importedName).toBe('Weekend');
		expect(preset?.names.apple).toBe('Ruby');
		expect(preset?.images.apple).toBe('data:image/png;base64,cHJlc2V0');
		const importedSound = preset?.sounds.apple;
		expect(importedSound).toBeInstanceOf(Blob);
		if (!(importedSound instanceof Blob)) throw new Error('Preset audio did not import.');
		expect(Array.from(new Uint8Array(await importedSound.arrayBuffer()))).toEqual([
			0xff, 0xfb, 0x90, 0x64
		]);
	});

	it('applies a community preset in memory without persisting its settings', async () => {
		const serialized = {
			format: 'arjcfruits',
			version: 1,
			name: 'Community preset',
			names: { apple: 'Ruby' },
			images: { apple: 'data:image/png;base64,cHJlc2V0' },
			sounds: { apple: { type: 'audio/mpeg', data: '//uQZA==' } }
		};
		const previousNames = { ...fruitDisplayNames };
		const previousImages = { ...fruitImageOverrides };
		const previousSounds = { ...fruitMergeSounds };
		const displayNamesBefore = localStorage.getItem('subak-fruit-display-names');
		const legacyImagesBefore = localStorage.getItem('subak-fruit-image-overrides');
		const presetsBefore = localStorage.getItem('subak-fruit-presets');
		const storedImagesBefore = await getStoredFruitImageOverrides();
		const storedSoundsBefore = await getStoredFruitMergeSounds();

		try {
			const preset = parseFruitPresetData(new TextEncoder().encode(JSON.stringify(serialized)));
			applyFruitPresetTemporarily(preset);

			expect(fruitDisplayNames.apple).toBe('Ruby');
			expect(fruitImageOverrides.apple).toBe('data:image/png;base64,cHJlc2V0');
			expect(fruitMergeSounds.apple).toBeInstanceOf(Blob);
			expect(localStorage.getItem('subak-fruit-display-names')).toBe(displayNamesBefore);
			expect(localStorage.getItem('subak-fruit-image-overrides')).toBe(legacyImagesBefore);
			expect(localStorage.getItem('subak-fruit-presets')).toBe(presetsBefore);
			expect(await getStoredFruitImageOverrides()).toEqual(storedImagesBefore);
			expect(await getStoredFruitMergeSounds()).toEqual(storedSoundsBefore);
		} finally {
			for (const fruitName of Object.keys(fruitDisplayNames)) delete fruitDisplayNames[fruitName];
			for (const fruitName of Object.keys(fruitImageOverrides))
				delete fruitImageOverrides[fruitName];
			for (const fruitName of Object.keys(fruitMergeSounds)) delete fruitMergeSounds[fruitName];
			Object.assign(fruitDisplayNames, previousNames);
			Object.assign(fruitImageOverrides, previousImages);
			Object.assign(fruitMergeSounds, previousSounds);
		}
	});

	it('shares an editable HTML file and saves a local copy only on its first share', async () => {
		const originalShare = Object.getOwnPropertyDescriptor(navigator, 'share');
		const originalCanShare = Object.getOwnPropertyDescriptor(navigator, 'canShare');
		const share = vi.fn(async (_data: ShareData) => {});
		const canShare = vi.fn(() => true);
		Object.defineProperty(navigator, 'share', { configurable: true, value: share });
		Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare });

		try {
			const { container, getByRole, getByLabelText } = render(FruitPresetControls);
			const dialog = container.querySelector('dialog');
			if (!(dialog instanceof HTMLDialogElement)) throw new Error('Preset dialog did not render.');

			await fireEvent.click(getByRole('button', { name: 'Share preset' }));
			await waitFor(() => {
				expect((getByRole('button', { name: 'Share file' }) as HTMLButtonElement).disabled).toBe(
					false
				);
			});
			await fireEvent.input(getByLabelText('File name'), {
				target: { value: 'friend bundle' }
			});
			await fireEvent.click(getByRole('button', { name: 'Share file' }));
			await waitFor(() => expect(share).toHaveBeenCalledTimes(1));

			const firstShareData = share.mock.calls[0][0];
			expect(firstShareData.files?.[0].name).toBe('friend bundle.html');
			expect(firstShareData.files?.[0].type).toBe('text/html');
			expect(localStorage.getItem('subak-fruit-preset-shared-once')).toBe('true');
			expect(JSON.parse(localStorage.getItem('subak-fruit-presets') ?? '[]')).toContainEqual(
				expect.objectContaining({ name: 'Shared preset' })
			);

			await waitFor(() => {
				expect(dialog.open).toBe(false);
				expect((getByRole('button', { name: 'Share preset' }) as HTMLButtonElement).disabled).toBe(
					false
				);
			});
			setFruitDisplayName('apple', 'Ruby');
			await fireEvent.click(getByRole('button', { name: 'Share preset' }));
			await waitFor(() => {
				expect((getByRole('button', { name: 'Share file' }) as HTMLButtonElement).disabled).toBe(
					false
				);
			});
			await fireEvent.click(getByRole('button', { name: 'Share file' }));
			await waitFor(() => expect(share).toHaveBeenCalledTimes(2));

			expect((await getFruitPreset('Shared preset'))?.names.apple).toBeUndefined();
			expect(JSON.parse(localStorage.getItem('subak-fruit-presets') ?? '[]')).toHaveLength(1);
		} finally {
			if (originalShare) Object.defineProperty(navigator, 'share', originalShare);
			else Reflect.deleteProperty(navigator, 'share');
			if (originalCanShare) Object.defineProperty(navigator, 'canShare', originalCanShare);
			else Reflect.deleteProperty(navigator, 'canShare');
		}
	});

	it('continues to import legacy .arjcfruits files', async () => {
		const serialized = {
			format: 'arjcfruits',
			version: 1,
			name: 'Legacy preset',
			names: { apple: 'Ruby' },
			images: {},
			sounds: {}
		};
		const file = new File([JSON.stringify(serialized)], 'legacy.arjcfruits', {
			type: 'application/json'
		});

		const importedName = await importFruitPresetFile(file);
		expect(importedName).toBe('Legacy');
		expect((await getFruitPreset(importedName))?.names.apple).toBe('Ruby');
	});

	it('imports a legacy preset from the Load dialog and saves it locally', async () => {
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
		const content = JSON.stringify({
			format: 'arjcfruits',
			version: 1,
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
});
