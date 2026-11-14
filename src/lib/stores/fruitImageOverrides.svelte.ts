import {
	deleteFruitImageOverride as deleteStoredFruitImageOverride,
	getFruitImageOverrides,
	saveFruitImageOverride as saveStoredFruitImageOverride
} from './db';

const LEGACY_STORAGE_KEY = 'subak-fruit-image-overrides';

function loadLegacyFruitImageOverrides(): Record<string, string> {
	if (typeof localStorage === 'undefined') return {};

	try {
		const storedOverrides: unknown = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '{}');
		if (!storedOverrides || typeof storedOverrides !== 'object' || Array.isArray(storedOverrides)) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(storedOverrides).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch (error) {
		console.error('Failed to load legacy custom fruit images:', error);
		return {};
	}
}

export const fruitImageOverrides = $state<Record<string, string>>(loadLegacyFruitImageOverrides());
let initializePromise: Promise<void> | null = null;

export function initializeFruitImageOverrides(): Promise<void> {
	if (!initializePromise) {
		initializePromise = (async () => {
			const storedOverrides = await getFruitImageOverrides();
			const legacyOverrides = { ...fruitImageOverrides };

			for (const [fruitName, imageUrl] of Object.entries(legacyOverrides)) {
				if (storedOverrides[fruitName] === undefined) {
					await saveStoredFruitImageOverride(fruitName, imageUrl);
				}
			}

			for (const fruitName of Object.keys(fruitImageOverrides)) {
				delete fruitImageOverrides[fruitName];
			}
			Object.assign(fruitImageOverrides, legacyOverrides, storedOverrides);

			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem(LEGACY_STORAGE_KEY);
			}
		})().catch((error: unknown) => {
			initializePromise = null;
			throw error;
		});
	}

	return initializePromise;
}

export async function setFruitImageOverride(fruitName: string, imageUrl: string): Promise<void> {
	await initializeFruitImageOverrides();
	await saveStoredFruitImageOverride(fruitName, imageUrl);
	fruitImageOverrides[fruitName] = imageUrl;
}

export async function resetFruitImageOverride(fruitName: string): Promise<void> {
	await initializeFruitImageOverrides();
	await deleteStoredFruitImageOverride(fruitName);
	delete fruitImageOverrides[fruitName];
}
