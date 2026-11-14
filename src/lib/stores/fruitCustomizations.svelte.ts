import { encodeAudioAsMp3 } from '../utils/encodeAudioAsMp3';
import { asMp3Blob, isMp3 } from '../utils/mp3';
import { deleteFruitMergeSound, getFruitMergeSounds, saveFruitMergeSound } from './db';

const DISPLAY_NAMES_STORAGE_KEY = 'subak-fruit-display-names';

function loadFruitDisplayNames(): Record<string, string> {
	if (typeof localStorage === 'undefined') return {};

	try {
		const storedNames: unknown = JSON.parse(
			localStorage.getItem(DISPLAY_NAMES_STORAGE_KEY) ?? '{}'
		);
		if (!storedNames || typeof storedNames !== 'object' || Array.isArray(storedNames)) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(storedNames).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch (error) {
		console.error('Failed to load custom fruit names:', error);
		return {};
	}
}

export const fruitDisplayNames = $state<Record<string, string>>(loadFruitDisplayNames());
export const fruitMergeSounds = $state<Record<string, Blob>>({});
const modifiedFruitMergeSounds = new Set<string>();

export function getFruitDisplayName(fruitName: string): string {
	return (
		fruitDisplayNames[fruitName] || `${fruitName[0]?.toUpperCase() ?? ''}${fruitName.slice(1)}`
	);
}

export function setFruitDisplayName(fruitName: string, displayName: string): void {
	const trimmedName = displayName.trim();
	if (!trimmedName) {
		throw new Error('Fruit names cannot be empty.');
	}

	const nextNames = { ...fruitDisplayNames, [fruitName]: trimmedName };
	localStorage.setItem(DISPLAY_NAMES_STORAGE_KEY, JSON.stringify(nextNames));
	fruitDisplayNames[fruitName] = trimmedName;
}

export function resetFruitDisplayName(fruitName: string): void {
	const nextNames = { ...fruitDisplayNames };
	delete nextNames[fruitName];
	localStorage.setItem(DISPLAY_NAMES_STORAGE_KEY, JSON.stringify(nextNames));
	delete fruitDisplayNames[fruitName];
}

export async function loadFruitMergeSounds(): Promise<void> {
	const storedSounds = await getFruitMergeSounds();
	for (const [fruitName, sound] of Object.entries(storedSounds)) {
		if (!modifiedFruitMergeSounds.has(fruitName)) {
			try {
				const bytes = new Uint8Array(await sound.slice(0, 64 * 1024).arrayBuffer());
				const normalizedSound = isMp3(bytes) ? asMp3Blob(sound) : await encodeAudioAsMp3(sound);
				await saveFruitMergeSound(fruitName, normalizedSound);
				fruitMergeSounds[fruitName] = normalizedSound;
			} catch (error) {
				console.error(`Failed to migrate stored merge sound for ${fruitName} to MP3:`, error);
				try {
					await deleteFruitMergeSound(fruitName);
				} catch (deleteError) {
					console.error(
						`Failed to remove invalid stored merge sound for ${fruitName}:`,
						deleteError
					);
				}
			}
		}
	}
}

export async function setFruitMergeSound(fruitName: string, sound: Blob): Promise<void> {
	await saveFruitMergeSound(fruitName, sound);
	modifiedFruitMergeSounds.add(fruitName);
	fruitMergeSounds[fruitName] = sound;
}

export async function resetFruitMergeSound(fruitName: string): Promise<void> {
	await deleteFruitMergeSound(fruitName);
	modifiedFruitMergeSounds.add(fruitName);
	delete fruitMergeSounds[fruitName];
}
