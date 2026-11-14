import Dexie, { type Table } from 'dexie';
import { asMp3Blob, isMp3 } from '../utils/mp3';

interface ScoreRecord {
	id?: number;
	score: number;
	date: Date;
}

interface FruitMergeSoundRecord {
	fruitName: string;
	sound: Blob;
}

interface FruitPresetSoundRecord {
	presetId: string;
	sounds: Record<string, Blob>;
}

interface FruitImageOverrideRecord {
	fruitName: string;
	imageUrl: string;
}

interface FruitPresetImageRecord {
	presetId: string;
	images: Record<string, string>;
}

const db = new Dexie('FruitMergerDB') as Dexie & {
	scores: Table<ScoreRecord, number>;
	fruitMergeSounds: Table<FruitMergeSoundRecord, string>;
	fruitPresetSounds: Table<FruitPresetSoundRecord, string>;
	fruitImageOverrides: Table<FruitImageOverrideRecord, string>;
	fruitPresetImages: Table<FruitPresetImageRecord, string>;
};

db.version(1).stores({
	scores: '++id, score, date'
});

db.version(2).stores({
	pendingSubmissions: '++id, createdAt'
});

db.version(3).stores({
	scores: '++id, score, date',
	pendingSubmissions: null
});

db.version(4).stores({
	scores: '++id, score, date',
	fruitMergeSounds: 'fruitName'
});

db.version(5).stores({
	scores: '++id, score, date',
	fruitMergeSounds: 'fruitName',
	fruitPresetSounds: 'presetId'
});

db.version(6).stores({
	scores: '++id, score, date',
	fruitMergeSounds: 'fruitName',
	fruitPresetSounds: 'presetId',
	fruitImageOverrides: 'fruitName',
	fruitPresetImages: 'presetId'
});

export const getFruitMergeSounds = async (): Promise<Record<string, Blob>> => {
	const records = await db.fruitMergeSounds.toArray();
	return Object.fromEntries(records.map(({ fruitName, sound }) => [fruitName, sound]));
};

export const getFruitPresetSounds = async (
	presetId: string
): Promise<Record<string, Blob> | undefined> => {
	const record = await db.fruitPresetSounds.get(presetId);
	return record?.sounds;
};

export const getFruitPresetImages = async (
	presetId: string
): Promise<Record<string, string> | undefined> => {
	const record = await db.fruitPresetImages.get(presetId);
	return record?.images;
};

export const saveFruitPresetImages = async (
	presetId: string,
	images: Record<string, string>
): Promise<void> => {
	await db.fruitPresetImages.put({ presetId, images });
};

export const saveFruitPresetAssets = async (
	presetId: string,
	images: Record<string, string>,
	sounds: Record<string, Blob>
): Promise<void> => {
	await db.transaction('rw', db.fruitPresetImages, db.fruitPresetSounds, async () => {
		await db.fruitPresetImages.put({ presetId, images });
		await db.fruitPresetSounds.put({ presetId, sounds });
	});
};

export const saveFruitPresetSounds = async (
	presetId: string,
	sounds: Record<string, Blob>
): Promise<void> => {
	await db.fruitPresetSounds.put({ presetId, sounds });
};

export const getFruitImageOverrides = async (): Promise<Record<string, string>> => {
	const records = await db.fruitImageOverrides.toArray();
	return Object.fromEntries(records.map(({ fruitName, imageUrl }) => [fruitName, imageUrl]));
};

export const saveFruitImageOverride = async (
	fruitName: string,
	imageUrl: string
): Promise<void> => {
	await db.fruitImageOverrides.put({ fruitName, imageUrl });
};

export const deleteFruitImageOverride = async (fruitName: string): Promise<void> => {
	await db.fruitImageOverrides.delete(fruitName);
};

export const saveFruitMergeSound = async (fruitName: string, sound: Blob): Promise<void> => {
	const bytes = new Uint8Array(await sound.slice(0, 64 * 1024).arrayBuffer());
	if (!isMp3(bytes)) {
		throw new Error(`Custom merge sound for ${fruitName} is not valid MP3 audio.`);
	}
	await db.fruitMergeSounds.put({ fruitName, sound: asMp3Blob(sound) });
};

export const deleteFruitMergeSound = async (fruitName: string): Promise<void> => {
	await db.fruitMergeSounds.delete(fruitName);
};

export const saveScore = async (score: number): Promise<void> => {
	try {
		await db.scores.add({
			score,
			date: new Date()
		});
	} catch (error) {
		console.error('Failed to save score:', error);
	}
};

export const getHighScores = async (): Promise<ScoreRecord[]> => {
	try {
		return await db.scores.orderBy('score').reverse().limit(10).toArray();
	} catch (error) {
		console.error('Failed to get high scores:', error);
		return [];
	}
};
