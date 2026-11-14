import { vi } from 'vitest';

vi.mock('howler', () => ({
	Howl: vi.fn(() => ({ play: vi.fn(), stop: vi.fn() })),
	Howler: { ctx: { state: 'running' }, _muted: false }
}));

vi.mock('svelte/motion', () => ({
	Tween: {
		of: (getter: () => number) => ({ current: getter() })
	}
}));

// --- Mock database access ---------------------------------------------------
const mockScores: { id: number; score: number; date: Date }[] = [];
const mockFruitMergeSounds = new Map<string, Blob>();
const mockFruitPresetSounds = new Map<string, Record<string, Blob>>();
const mockFruitImageOverrides = new Map<string, string>();
const mockFruitPresetImages = new Map<string, Record<string, string>>();

vi.mock('./src/lib/stores/db', () => ({
	saveScore: vi.fn(async (score: number): Promise<void> => {
		mockScores.push({ id: mockScores.length + 1, score, date: new Date() });
	}),
	getHighScores: vi.fn(async (): Promise<{ id: number; score: number; date: Date }[]> => {
		return [...mockScores].sort((a, b) => b.score - a.score).slice(0, 10);
	}),
	getFruitMergeSounds: vi.fn(
		async (): Promise<Record<string, Blob>> => Object.fromEntries(mockFruitMergeSounds)
	),
	saveFruitMergeSound: vi.fn(async (fruitName: string, sound: Blob): Promise<void> => {
		mockFruitMergeSounds.set(fruitName, sound);
	}),
	deleteFruitMergeSound: vi.fn(async (fruitName: string): Promise<void> => {
		mockFruitMergeSounds.delete(fruitName);
	}),
	getFruitPresetSounds: vi.fn(
		async (presetId: string): Promise<Record<string, Blob> | undefined> => {
			return mockFruitPresetSounds.get(presetId);
		}
	),
	saveFruitPresetSounds: vi.fn(
		async (presetId: string, sounds: Record<string, Blob>): Promise<void> => {
			mockFruitPresetSounds.set(presetId, sounds);
		}
	),
	getFruitImageOverrides: vi.fn(
		async (): Promise<Record<string, string>> => Object.fromEntries(mockFruitImageOverrides)
	),
	saveFruitImageOverride: vi.fn(async (fruitName: string, imageUrl: string): Promise<void> => {
		mockFruitImageOverrides.set(fruitName, imageUrl);
	}),
	deleteFruitImageOverride: vi.fn(async (fruitName: string): Promise<void> => {
		mockFruitImageOverrides.delete(fruitName);
	}),
	getFruitPresetImages: vi.fn(
		async (presetId: string): Promise<Record<string, string> | undefined> =>
			mockFruitPresetImages.get(presetId)
	),
	saveFruitPresetImages: vi.fn(
		async (presetId: string, images: Record<string, string>): Promise<void> => {
			mockFruitPresetImages.set(presetId, images);
		}
	),
	saveFruitPresetAssets: vi.fn(
		async (
			presetId: string,
			images: Record<string, string>,
			sounds: Record<string, Blob>
		): Promise<void> => {
			mockFruitPresetImages.set(presetId, images);
			mockFruitPresetSounds.set(presetId, sounds);
		}
	),
	__mockScores: mockScores
}));
