import { FRUITS } from '../constants';
import { isMp3 } from '../utils/mp3';
import {
	getFruitPresetImages,
	getFruitPresetSounds,
	saveFruitPresetAssets,
	saveFruitPresetImages
} from './db';
import {
	resetFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound
} from './fruitCustomizations.svelte';
import {
	initializeFruitImageOverrides,
	resetFruitImageOverride,
	setFruitImageOverride
} from './fruitImageOverrides.svelte';

const STORAGE_KEY = 'subak-fruit-presets';
const FILE_FORMAT = 'arjcfruits';
const FILE_VERSION = 1;
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_SOUND_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PRESET_FILE_SIZE_BYTES = 110 * 1024 * 1024;
const PDF_ATTACHMENT_SUBTYPE = '/Subtype /application#2Fvnd.arjcfruits+json';
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_PRESET_CHUNK_TYPE = encodeText('frPs');
const FRUIT_NAMES = new Set(FRUITS.map(({ name }) => name));
const CRC32_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index++) {
		let value = index;
		for (let bit = 0; bit < 8; bit++) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
		}
		table[index] = value >>> 0;
	}
	return table;
})();

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
	images?: Record<string, string>;
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

function encodeText(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function calculateCrc32(chunks: Uint8Array[]): number {
	let crc = 0xffffffff;
	for (const chunk of chunks) {
		for (const byte of chunk) {
			crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function findBytes(data: Uint8Array, pattern: Uint8Array, start = 0): number {
	const prefix = new Uint32Array(pattern.length);
	for (let index = 1, matched = 0; index < pattern.length; index++) {
		while (matched > 0 && pattern[index] !== pattern[matched]) {
			matched = prefix[matched - 1];
		}
		if (pattern[index] === pattern[matched]) matched++;
		prefix[index] = matched;
	}

	for (let index = start, matched = 0; index < data.length; index++) {
		while (matched > 0 && data[index] !== pattern[matched]) {
			matched = prefix[matched - 1];
		}
		if (data[index] === pattern[matched]) matched++;
		if (matched === pattern.length) return index - pattern.length + 1;
	}
	return -1;
}

function findPngChunk(
	bytes: Uint8Array,
	chunkType: string
): { offset: number; length: number } | undefined {
	if (
		bytes.length < PNG_SIGNATURE.length ||
		!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
	) {
		throw new Error('This is not a valid PNG image.');
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = PNG_SIGNATURE.length;
	while (offset + 12 <= bytes.length) {
		const length = view.getUint32(offset, false);
		const end = offset + length + 12;
		if (end > bytes.length) throw new Error('The PNG image contains a malformed chunk.');

		const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
		if (type === chunkType) return { offset, length };
		if (type === 'IEND') return undefined;
		offset = end;
	}
	throw new Error('The PNG image is incomplete.');
}

async function createPresetPng(payload: Uint8Array): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = 1200;
	canvas.height = 630;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not create the preset image.');

	context.fillStyle = '#f8fafc';
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = '#dbeafe';
	context.fillRect(0, 0, canvas.width, 16);
	context.fillStyle = '#172554';
	context.font = 'bold 52px Arial, sans-serif';
	context.fillText('Fruity Jibesh preset', 72, 132);
	context.fillStyle = '#334155';
	context.font = '30px Arial, sans-serif';
	context.fillText('Save this file and goto', 72, 236);
	context.fillStyle = '#1d4ed8';
	context.fillText('https://fruity-jibesh-vv4i.vercel.app/', 72, 292);
	context.fillStyle = '#334155';
	context.fillText('Choose "+ import from file" and import this PNG image there...', 72, 394);

	const image = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('Could not render the preset image.'));
		}, 'image/png');
	});

	const pngBytes = new Uint8Array(await image.arrayBuffer());
	const iend = findPngChunk(pngBytes, 'IEND');
	if (!iend || iend.length !== 0) throw new Error('The preset image could not be completed.');

	const lengthBytes = new Uint8Array(4);
	new DataView(lengthBytes.buffer).setUint32(0, payload.length, false);
	const checksumBytes = new Uint8Array(4);
	new DataView(checksumBytes.buffer).setUint32(
		0,
		calculateCrc32([PNG_PRESET_CHUNK_TYPE, payload]),
		false
	);

	return new Blob(
		[
			pngBytes.subarray(0, iend.offset),
			lengthBytes,
			PNG_PRESET_CHUNK_TYPE,
			payload,
			checksumBytes,
			pngBytes.subarray(iend.offset)
		],
		{ type: 'image/png' }
	);
}

function extractPresetJsonFromPng(bytes: Uint8Array): Uint8Array {
	const chunk = findPngChunk(bytes, 'frPs');
	if (!chunk) throw new Error('This PNG does not contain a Fruity Jibesh preset.');
	if (chunk.length <= 0 || chunk.length > MAX_PRESET_FILE_SIZE_BYTES) {
		throw new Error('The preset attachment in this PNG is invalid.');
	}

	const type = bytes.subarray(chunk.offset + 4, chunk.offset + 8);
	const payloadStart = chunk.offset + 8;
	const payloadEnd = payloadStart + chunk.length;
	const expectedChecksum = new DataView(bytes.buffer, bytes.byteOffset + payloadEnd, 4).getUint32(
		0,
		false
	);
	if (calculateCrc32([type, bytes.subarray(payloadStart, payloadEnd)]) !== expectedChecksum) {
		throw new Error('The preset attachment in this PNG is damaged.');
	}
	return bytes.slice(payloadStart, payloadEnd);
}

function extractPresetJsonFromPdf(bytes: Uint8Array): Uint8Array {
	const subtypeIndex = findBytes(bytes, encodeText(PDF_ATTACHMENT_SUBTYPE));
	if (subtypeIndex < 0) {
		throw new Error('This PDF does not contain a Fruity Jibesh preset.');
	}

	const lengthMarker = encodeText('/Length ');
	const lengthIndex = findBytes(bytes, lengthMarker, subtypeIndex);
	const streamIndex = findBytes(bytes, encodeText('stream\n'), subtypeIndex);
	if (lengthIndex < 0 || streamIndex < 0 || lengthIndex > streamIndex) {
		throw new Error('The preset attachment in this PDF is malformed.');
	}

	const lengthStart = lengthIndex + lengthMarker.length;
	let lengthEnd = lengthStart;
	while (lengthEnd < streamIndex && bytes[lengthEnd] >= 48 && bytes[lengthEnd] <= 57) {
		lengthEnd++;
	}
	const payloadLength = Number(new TextDecoder().decode(bytes.subarray(lengthStart, lengthEnd)));
	const payloadStart = streamIndex + encodeText('stream\n').length;
	if (
		lengthEnd === lengthStart ||
		!Number.isSafeInteger(payloadLength) ||
		payloadLength <= 0 ||
		payloadLength > MAX_PRESET_FILE_SIZE_BYTES ||
		payloadStart + payloadLength > bytes.length
	) {
		throw new Error('The preset attachment in this PDF is invalid.');
	}

	return bytes.slice(payloadStart, payloadStart + payloadLength);
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
			(!('images' in preset) ||
				(!!preset.images && typeof preset.images === 'object' && !Array.isArray(preset.images)))
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

export async function listRecentFruitPresets(limit: number): Promise<FruitPresetPreview[]> {
	const recentPresets = getStoredPresets()
		.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
		.slice(0, limit);

	return Promise.all(
		recentPresets.map(async ({ name, images }) => ({
			name,
			images: (await getFruitPresetImages(getPresetId(name))) ?? images ?? {}
		}))
	);
}

async function migrateLegacyPresetImages(
	presets: StoredFruitPreset[]
): Promise<StoredFruitPreset[]> {
	const legacyPresets = presets.filter((preset) => preset.images !== undefined);
	if (legacyPresets.length === 0) return presets;

	for (const preset of legacyPresets) {
		await saveFruitPresetImages(getPresetId(preset.name), validateImages(preset.images));
	}

	const migratedPresets = presets.map(({ images: _images, ...preset }) => preset);
	localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedPresets));
	return migratedPresets;
}

export async function saveFruitPreset(preset: FruitPreset): Promise<void> {
	const name = preset.name.trim();
	const presetId = getPresetId(name);
	if (!name || presetId === 'default') {
		throw new Error('Choose a name other than “Default”.');
	}

	await initializeFruitImageOverrides();
	const presets = await migrateLegacyPresetImages(getStoredPresets());
	const previousValue = localStorage.getItem(STORAGE_KEY);
	const nextPresets = presets.filter((saved) => getPresetId(saved.name) !== presetId);
	nextPresets.push({ name, names: preset.names, lastUsedAt: Date.now() });

	localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPresets));
	try {
		await saveFruitPresetAssets(presetId, preset.images, preset.sounds);
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
		images: (await getFruitPresetImages(presetId)) ?? preset.images ?? {},
		sounds: (await getFruitPresetSounds(presetId)) ?? {}
	};
}

export async function applyFruitPreset(name: string): Promise<void> {
	await initializeFruitImageOverrides();
	const preset = name === 'Default' ? undefined : await getFruitPreset(name);
	if (name !== 'Default' && !preset) {
		throw new Error('This preset could not be found.');
	}

	for (const fruit of FRUITS) {
		resetFruitDisplayName(fruit.name);
		await resetFruitImageOverride(fruit.name);
		await resetFruitMergeSound(fruit.name);
	}

	if (preset) {
		for (const [fruitName, displayName] of Object.entries(preset.names)) {
			setFruitDisplayName(fruitName, displayName);
		}
		for (const [fruitName, imageUrl] of Object.entries(preset.images)) {
			await setFruitImageOverride(fruitName, imageUrl);
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
	return createPresetPng(encodeText(JSON.stringify(file)));
}

export async function importFruitPresetFile(file: File): Promise<string> {
	const lowerFileName = file.name.toLowerCase();
	const isPng = lowerFileName.endsWith('.png');
	const isPdf = lowerFileName.endsWith('.pdf');
	const isLegacyPreset = lowerFileName.endsWith('.arjcfruits');
	if (!isPng && !isPdf && !isLegacyPreset) {
		throw new Error('Choose a Fruity Jibesh PNG preset image.');
	}
	if (file.size > MAX_PRESET_FILE_SIZE_BYTES) {
		throw new Error('The preset file is too large to import.');
	}

	let parsed: unknown;
	try {
		const json = isPng
			? new TextDecoder('utf-8', { fatal: true }).decode(
					extractPresetJsonFromPng(new Uint8Array(await file.arrayBuffer()))
				)
			: isPdf
				? new TextDecoder('utf-8', { fatal: true }).decode(
						extractPresetJsonFromPdf(new Uint8Array(await file.arrayBuffer()))
					)
				: await file.text();
		parsed = JSON.parse(json);
	} catch {
		throw new Error(
			isPng
				? 'This PNG does not contain valid preset data.'
				: isPdf
					? 'This PDF does not contain valid preset data.'
					: 'This preset file is not valid JSON.'
		);
	}
	if (
		!isRecord(parsed) ||
		parsed.format !== FILE_FORMAT ||
		parsed.version !== FILE_VERSION ||
		typeof parsed.name !== 'string'
	) {
		throw new Error('This is not a supported fruit preset file.');
	}

	const extension = isPng ? '.png' : isPdf ? '.pdf' : '.arjcfruits';
	const fileName = file.name.slice(0, -extension.length).trim();
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
