import { FRUITS } from '../constants';
import { isMp3 } from '../utils/mp3';
import { getFruitPresetSounds, saveFruitPresetSounds } from './db';
import {
	resetFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound
} from './fruitCustomizations.svelte';
import { resetFruitImageOverride, setFruitImageOverride } from './fruitImageOverrides.svelte';

const STORAGE_KEY = 'subak-fruit-presets';
const FILE_FORMAT = 'arjcfruits';
const FILE_VERSION = 1;
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_SOUND_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PRESET_FILE_SIZE_BYTES = 110 * 1024 * 1024;
const FRUIT_NAMES = new Set(FRUITS.map(({ name }) => name));

export interface FruitPreset {
	name: string;
	names: Record<string, string>;
	images: Record<string, string>;
	sounds: Record<string, Blob>;
}

export interface FruitPresetPreview {
	name: string;
	images: Record<string, string>;
}

interface StoredFruitPreset {
	name: string;
	names: Record<string, string>;
	images: Record<string, string>;
	lastUsedAt?: number;
}

interface SerializedFruitPreset {
	format: typeof FILE_FORMAT;
	version: typeof FILE_VERSION;
	name: string;
	names: Record<string, string>;
	images: Record<string, string>;
	sounds: Record<string, { type: 'audio/mpeg'; data: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
	}
	return btoa(binary);
}

function decodeBase64(value: string, maximumBytes: number): Uint8Array {
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		throw new Error('The preset file contains invalid encoded data.');
	}

	if (value.length > Math.ceil(maximumBytes / 3) * 4) {
		throw new Error('A file in this preset exceeds the allowed size.');
	}

	let binary: string;
	try {
		binary = atob(value);
	} catch {
		throw new Error('The preset file contains invalid encoded data.');
	}
	if (binary.length > maximumBytes) {
		throw new Error('A file in this preset exceeds the allowed size.');
	}

	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validateNames(value: unknown): Record<string, string> {
	if (!isRecord(value)) throw new Error('The preset contains invalid fruit names.');

	const names: Record<string, string> = {};
	for (const [fruitName, displayName] of Object.entries(value)) {
		if (
			!FRUIT_NAMES.has(fruitName) ||
			typeof displayName !== 'string' ||
			!displayName.trim() ||
			displayName.trim().length > 32
		) {
			throw new Error('The preset contains an invalid fruit name.');
		}
		names[fruitName] = displayName.trim();
	}
	return names;
}

function validateImages(value: unknown): Record<string, string> {
	if (!isRecord(value)) throw new Error('The preset contains invalid fruit images.');

	const images: Record<string, string> = {};
	for (const [fruitName, imageUrl] of Object.entries(value)) {
		if (!FRUIT_NAMES.has(fruitName) || typeof imageUrl !== 'string') {
			throw new Error('The preset contains an unsupported fruit image.');
		}

		const imageData = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.*)$/.exec(imageUrl);
		if (!imageData) throw new Error('The preset contains an unsupported fruit image.');
		decodeBase64(imageData[1], MAX_IMAGE_SIZE_BYTES);
		images[fruitName] = imageUrl;
	}
	return images;
}

function validateSounds(value: unknown): Record<string, Blob> {
	if (!isRecord(value)) throw new Error('The preset contains invalid merge sounds.');

	const sounds: Record<string, Blob> = {};
	for (const [fruitName, serializedSound] of Object.entries(value)) {
		if (
			!FRUIT_NAMES.has(fruitName) ||
			!isRecord(serializedSound) ||
			serializedSound.type !== 'audio/mpeg' ||
			typeof serializedSound.data !== 'string'
		) {
			throw new Error('The preset contains an unsupported merge sound.');
		}

		const bytes = decodeBase64(serializedSound.data, MAX_SOUND_SIZE_BYTES);
		if (!isMp3(bytes)) throw new Error(`The merge sound for ${fruitName} is not a valid MP3.`);
		sounds[fruitName] = new Blob([bytes], { type: 'audio/mpeg' });
	}
	return sounds;
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

export function listRecentFruitPresets(limit: number): FruitPresetPreview[] {
	return getStoredPresets()
		.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
		.slice(0, limit)
		.map(({ name, images }) => ({ name, images }));
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
	nextPresets.push({ name, names: preset.names, images: preset.images, lastUsedAt: Date.now() });

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

export async function applyFruitPreset(name: string): Promise<void> {
	const preset = name === 'Default' ? undefined : await getFruitPreset(name);
	if (name !== 'Default' && !preset) {
		throw new Error('This preset could not be found.');
	}

	for (const fruit of FRUITS) {
		resetFruitDisplayName(fruit.name);
		resetFruitImageOverride(fruit.name);
		await resetFruitMergeSound(fruit.name);
	}

	if (preset) {
		for (const [fruitName, displayName] of Object.entries(preset.names)) {
			setFruitDisplayName(fruitName, displayName);
		}
		for (const [fruitName, imageUrl] of Object.entries(preset.images)) {
			setFruitImageOverride(fruitName, imageUrl);
		}
		for (const [fruitName, sound] of Object.entries(preset.sounds)) {
			await setFruitMergeSound(fruitName, sound);
		}
		markFruitPresetUsed(name);
	}
}

function markFruitPresetUsed(name: string): void {
	const presets = getStoredPresets().map((preset) =>
		getPresetId(preset.name) === getPresetId(name) ? { ...preset, lastUsedAt: Date.now() } : preset
	);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export async function exportFruitPresetFile(preset: FruitPreset): Promise<Blob> {
	const sounds = Object.fromEntries(
		await Promise.all(
			Object.entries(preset.sounds).map(async ([fruitName, sound]) => [
				fruitName,
				{
					type: 'audio/mpeg',
					data: encodeBase64(new Uint8Array(await sound.arrayBuffer()))
				}
			])
		)
	);
	const file: SerializedFruitPreset = {
		format: FILE_FORMAT,
		version: FILE_VERSION,
		name: preset.name,
		names: preset.names,
		images: preset.images,
		sounds
	};
	return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function importFruitPresetFile(file: File): Promise<string> {
	if (!file.name.toLowerCase().endsWith('.arjcfruits')) {
		throw new Error('Choose an .arjcfruits preset file.');
	}
	if (file.size > MAX_PRESET_FILE_SIZE_BYTES) {
		throw new Error('The preset file is too large to import.');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(await file.text());
	} catch {
		throw new Error('This preset file is not valid JSON.');
	}
	if (
		!isRecord(parsed) ||
		parsed.format !== FILE_FORMAT ||
		parsed.version !== FILE_VERSION ||
		typeof parsed.name !== 'string'
	) {
		throw new Error('This is not a supported fruit preset file.');
	}

	const fileName = file.name.slice(0, -'.arjcfruits'.length).trim();
	if (!fileName) throw new Error('The preset file must have a name.');
	const name = uniquePresetName(fileName);
	await saveFruitPreset({
		name,
		names: validateNames(parsed.names),
		images: validateImages(parsed.images),
		sounds: validateSounds(parsed.sounds)
	});
	return name;
}

function uniquePresetName(originalName: string): string {
	const existingNames = new Set(listFruitPresets().map(getPresetId));
	const baseName = getPresetId(originalName) === 'default' ? 'Default (Imported)' : originalName;
	if (!existingNames.has(getPresetId(baseName))) return baseName;

	for (let number = 2; ; number++) {
		const suffix = ` (${number})`;
		const candidate = `${baseName}${suffix}`;
		if (!existingNames.has(getPresetId(candidate))) return candidate;
	}
}
