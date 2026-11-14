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

function concatenateBytes(chunks: Uint8Array[]): Uint8Array {
	const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
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

function createPresetPdf(payload: Uint8Array): Blob {
	const header = encodeText('%PDF-1.7\n');
	const pageContent = encodeText(
		'BT\n' +
			'/F1 20 Tf\n' +
			'72 720 Td\n' +
			'(Fruity Jibesh preset) Tj\n' +
			'/F1 12 Tf\n' +
			'0 -40 Td\n' +
			'(Save this file and goto) Tj\n' +
			'0 -22 Td\n' +
			'(https://fruity-jibesh-vv4i.vercel.app/.) Tj\n' +
			'0 -22 Td\n' +
			'(Choose "+ import from file" and import this pdf file there...) Tj\n' +
			'ET\n'
	);
	const embeddedFileHeader = encodeText(
		`7 0 obj\n<< /Type /EmbeddedFile ${PDF_ATTACHMENT_SUBTYPE} /Length ${payload.length} >>\nstream\n`
	);
	const objects = [
		encodeText(
			'1 0 obj\n<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(preset.arjcfruits) 6 0 R] >> >> >>\nendobj\n'
		),
		encodeText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'),
		encodeText(
			'3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n'
		),
		encodeText('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'),
		concatenateBytes([
			encodeText(`5 0 obj\n<< /Length ${pageContent.length} >>\nstream\n`),
			pageContent,
			encodeText('endstream\nendobj\n')
		]),
		encodeText(
			'6 0 obj\n<< /Type /Filespec /F (preset.arjcfruits) /UF (preset.arjcfruits) /Desc (Fruity Jibesh preset data) /EF << /F 7 0 R >> >>\nendobj\n'
		),
		concatenateBytes([embeddedFileHeader, payload, encodeText('\nendstream\nendobj\n')])
	];

	const chunks = [header];
	const offsets = [0];
	let fileLength = header.length;
	for (const object of objects) {
		offsets.push(fileLength);
		chunks.push(object);
		fileLength += object.length;
	}

	const crossReferenceOffset = fileLength;
	const crossReference = [
		`xref\n0 ${objects.length + 1}\n`,
		'0000000000 65535 f \n',
		...offsets.slice(1).map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`),
		`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`
	].join('');
	chunks.push(encodeText(crossReference));
	return new Blob(chunks, { type: 'application/pdf' });
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
	return createPresetPdf(encodeText(JSON.stringify(file)));
}

export async function importFruitPresetFile(file: File): Promise<string> {
	const lowerFileName = file.name.toLowerCase();
	const isPdf = lowerFileName.endsWith('.pdf');
	const isLegacyPreset = lowerFileName.endsWith('.arjcfruits');
	if (!isPdf && !isLegacyPreset) {
		throw new Error('Choose a Fruity Jibesh PDF preset file.');
	}
	if (file.size > MAX_PRESET_FILE_SIZE_BYTES) {
		throw new Error('The preset file is too large to import.');
	}

	let parsed: unknown;
	try {
		const json = isPdf
			? new TextDecoder('utf-8', { fatal: true }).decode(
					extractPresetJsonFromPdf(new Uint8Array(await file.arrayBuffer()))
				)
			: await file.text();
		parsed = JSON.parse(json);
	} catch {
		throw new Error(
			isPdf ? 'This PDF does not contain valid preset data.' : 'This preset file is not valid JSON.'
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

	const extension = isPdf ? '.pdf' : '.arjcfruits';
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
