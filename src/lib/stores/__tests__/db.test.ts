import Dexie from 'dexie';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Unmock the global mock from setupFiles so we can test the real db
vi.unmock('./src/lib/stores/db');

describe('db.ts', () => {
	let saveScore: any;
	let getHighScores: any;
	let saveFruitMergeSound: any;
	let getFruitMergeSounds: any;
	let deleteFruitMergeSound: any;

	beforeEach(async () => {
		vi.resetModules();

		// Dexie works natively in browser mode!
		const module = await import('../db');
		saveScore = module.saveScore;
		getHighScores = module.getHighScores;
		saveFruitMergeSound = module.saveFruitMergeSound;
		getFruitMergeSounds = module.getFruitMergeSounds;
		deleteFruitMergeSound = module.deleteFruitMergeSound;

		// Clear Dexie db to ensure clean tests
		// Wait, we need to access the db instance. It's not exported.
		// However, we can delete the database globally:
		await Dexie.delete('FruitMergerDB');
	});

	test('saving and retrieving scores works natively', async () => {
		await saveScore(100);
		await saveScore(500);
		await saveScore(300);

		const results = await getHighScores();

		expect(results.length).toBe(3);
		expect(results[0].score).toBe(500); // reverse sorted
		expect(results[1].score).toBe(300);
		expect(results[2].score).toBe(100);
	});

	test('getHighScores bounds at 10', async () => {
		for (let i = 0; i < 15; i++) {
			await saveScore(1000 + i * 10); // 1000, 1010, ... 1140
		}

		const results = await getHighScores();
		expect(results.length).toBe(10);
		expect(results[0].score).toBe(1140);
	});

	test('saves, retrieves, and removes custom merge sounds', async () => {
		const sound = new Blob([Uint8Array.from([0xff, 0xfb, 0x90, 0x64])], { type: 'audio/wav' });
		await saveFruitMergeSound('apple', sound);

		expect((await getFruitMergeSounds()).apple.type).toBe('audio/mpeg');

		await deleteFruitMergeSound('apple');
		expect((await getFruitMergeSounds()).apple).toBeUndefined();
	});

	test('rejects non-MP3 data', async () => {
		await expect(
			saveFruitMergeSound('apple', new Blob(['not an audio file'], { type: 'audio/mpeg' }))
		).rejects.toThrow('is not valid MP3 audio');
	});
});
