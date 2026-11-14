const STORAGE_KEY = 'subak-fruit-image-overrides';

function loadFruitImageOverrides(): Record<string, string> {
	if (typeof localStorage === 'undefined') return {};

	try {
		const storedOverrides: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		if (!storedOverrides || typeof storedOverrides !== 'object' || Array.isArray(storedOverrides)) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(storedOverrides).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch (error) {
		console.error('Failed to load custom fruit images:', error);
		return {};
	}
}

export const fruitImageOverrides = $state<Record<string, string>>(loadFruitImageOverrides());

export function setFruitImageOverride(fruitName: string, imageUrl: string): void {
	const nextOverrides = { ...fruitImageOverrides, [fruitName]: imageUrl };
	localStorage.setItem(STORAGE_KEY, JSON.stringify(nextOverrides));
	fruitImageOverrides[fruitName] = imageUrl;
}

export function resetFruitImageOverride(fruitName: string): void {
	const nextOverrides = { ...fruitImageOverrides };
	delete nextOverrides[fruitName];
	localStorage.setItem(STORAGE_KEY, JSON.stringify(nextOverrides));
	delete fruitImageOverrides[fruitName];
}
