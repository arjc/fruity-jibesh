import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRUITS } from '../../constants';
import {
	fruitDisplayNames,
	fruitMergeSounds,
	resetFruitDisplayName,
	resetFruitMergeSound
} from '../../stores/fruitCustomizations.svelte';
import { resetFruitImageOverride } from '../../stores/fruitImageOverrides.svelte';
import CircleOfEvolution from '../CircleOfEvolution.svelte';

vi.mock('../../utils/encodeAudioAsMp3', () => ({
	encodeAudioAsMp3: vi.fn(
		async () => new Blob([Uint8Array.from([0xff, 0xfb, 0x90, 0x64])], { type: 'audio/mpeg' })
	),
	encodePcmAsMp3: vi.fn(
		async () => new Blob([Uint8Array.from([0xff, 0xfb, 0x90, 0x64])], { type: 'audio/mpeg' })
	)
}));

afterEach(async () => {
	cleanup();
	await resetFruitImageOverride('apple');
	resetFruitDisplayName('apple');
	await resetFruitMergeSound('apple');
});

describe('CircleOfEvolution', () => {
	it('renders all fruits defined in constants', () => {
		const { container } = render(CircleOfEvolution);

		const renderedFruits = container.querySelectorAll('.fruit');
		expect(renderedFruits.length).toBe(FRUITS.length);
	});

	it('opens an editor with name, image, and audio controls for each fruit', async () => {
		const { getByRole, getByLabelText, getByText } = render(CircleOfEvolution);

		for (const fruit of FRUITS) {
			const name = `${fruit.name[0].toUpperCase()}${fruit.name.slice(1)}`;
			expect(getByRole('button', { name: `Edit ${name}` })).not.toBeNull();
		}

		await fireEvent.click(getByRole('button', { name: 'Edit Apple' }));
		expect(getByLabelText('Fruit name')).not.toBeNull();
		expect(getByLabelText('Customize apple image').getAttribute('type')).toBe('file');
		expect(getByLabelText('Add audio for apple').getAttribute('type')).toBe('file');
		expect(getByText('Audio')).not.toBeNull();
		expect(getByRole('button', { name: 'Record sound' })).not.toBeNull();
	});

	it('updates and persists a fruit image after selecting a file', async () => {
		const { getByLabelText, getByRole, container } = render(CircleOfEvolution);
		await fireEvent.click(getByRole('button', { name: 'Edit Apple' }));
		const imageFile = new File(['custom fruit'], 'custom.png', { type: 'image/png' });

		await fireEvent.change(getByLabelText('Customize apple image'), {
			target: { files: [imageFile] }
		});

		await waitFor(() => {
			expect(container.querySelector('[data-name="apple"] img')?.getAttribute('src')).toMatch(
				/^data:image\/png;base64,/
			);
		});
		expect(localStorage.getItem('subak-fruit-image-overrides')).toContain(
			'"apple":"data:image/png;base64,'
		);
	});

	it('saves a custom fruit name and audio', async () => {
		const { getByLabelText, getByRole } = render(CircleOfEvolution);
		await fireEvent.click(getByRole('button', { name: 'Edit Apple' }));

		await fireEvent.input(getByLabelText('Fruit name'), { target: { value: 'Ruby' } });
		await fireEvent.click(getByRole('button', { name: 'Save' }));
		expect(fruitDisplayNames.apple).toBe('Ruby');
		expect(localStorage.getItem('subak-fruit-display-names')).toContain('"apple":"Ruby"');

		await fireEvent.click(getByRole('button', { name: 'Edit Ruby' }));
		const soundFile = new File(['custom sound'], 'merge.wav', { type: 'audio/wav' });
		await fireEvent.change(getByLabelText('Add audio for apple'), {
			target: { files: [soundFile] }
		});

		await waitFor(() => {
			expect(fruitMergeSounds.apple).toBeInstanceOf(Blob);
		});
		expect(fruitMergeSounds.apple.type).toBe('audio/mpeg');
	});
});
