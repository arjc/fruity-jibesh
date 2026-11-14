import { getFruitPresetSounds, saveFruitPresetSounds } from './db';

const STORAGE_KEY = 'subak-fruit-presets';

export interface FruitPreset {
	name: string;
	names: Record<string, string>;
	images: Record<string, string>;
	sounds: Record<string, Blob>;
}

interface StoredFruitPreset {
	name: string;
	names: Record<string, string>;
	images: Record<string, string>;
}

function getStoredPresets(): StoredFruitPreset[] {
	const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
	if (!Array.isArray(stored)) {
		throw new Error('Saved presets could not be read.');
	}

	return stored.filter(
		(preset): preset is StoredFruitPreset =>
			!!preset &&
			typeof preset === 'object' &&
			typeof preset.name === 'string' &&
			!!preset.names &&
			typeof preset.names === 'object' &&
			!Array.isArray(preset.names) &&
			!!preset.images &&
			typeof preset.images === 'object' &&
			!Array.isArray(preset.images)
	);
}

function getPresetId(name: string): string {
	return name.trim().toLocaleLowerCase();
}

export function listFruitPresets(): string[] {
	return getStoredPresets()
		.map(({ name }) => name)
		.sort((a, b) => a.localeCompare(b));
}

export async function saveFruitPreset(preset: FruitPreset): Promise<void> {
	const name = preset.name.trim();
	const presetId = getPresetId(name);
	if (!name || presetId === 'default') {
		throw new Error('Choose a name other than “Default”.');
	}

	const previousValue = localStorage.getItem(STORAGE_KEY);
	const presets = getStoredPresets();
	const nextPresets = presets.filter((saved) => getPresetId(saved.name) !== presetId);
	nextPresets.push({ name, names: preset.names, images: preset.images });

	localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPresets));
	try {
		await saveFruitPresetSounds(presetId, preset.sounds);
	} catch (error) {
		if (previousValue === null) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, previousValue);
		throw error;
	}
}

export async function getFruitPreset(name: string): Promise<FruitPreset | undefined> {
	const presetId = getPresetId(name);
	const preset = getStoredPresets().find((saved) => getPresetId(saved.name) === presetId);
	if (!preset) return undefined;

	return {
		...preset,
		sounds: (await getFruitPresetSounds(presetId)) ?? {}
	};
}
