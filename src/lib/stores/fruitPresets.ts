import { FRUITS } from '../constants';
import { isMp3 } from '../utils/mp3';
import {
	getFruitPresetImages,
	getFruitPresetSounds,
	saveFruitPresetAssets,
	saveFruitPresetImages
} from './db';
import {
	fruitDisplayNames,
	fruitMergeSounds,
	resetFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound
} from './fruitCustomizations.svelte';
import {
	fruitImageOverrides,
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
const MAX_PRESET_HTML_OVERHEAD_BYTES = 64 * 1024;
const MAX_PRESET_IMAGE_FILE_SIZE_BYTES = MAX_PRESET_FILE_SIZE_BYTES + 1024 * 1024;
const PDF_ATTACHMENT_SUBTYPE = '/Subtype /application#2Fvnd.arjcfruits+json';
const PNG_INSTRUCTION_WIDTH = 1200;
const PNG_INSTRUCTION_HEIGHT = 630;
const PNG_MAX_DIMENSION = 16384;
const PNG_MAX_PIXEL_COUNT = 60_000_000;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PIXEL_PRESET_MAGIC = encodeText('FJPR');
const PIXEL_PRESET_HEADER_SIZE = 12;
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

export type FruitPresetContent = Omit<FruitPreset, 'name'>;

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

function readRgbPixelBytes(pixels: Uint8ClampedArray, offset: number, length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	let targetOffset = 0;
	let pixelOffset = (offset / 3) * 4;
	while (targetOffset + 2 < length) {
		bytes[targetOffset] = pixels[pixelOffset];
		bytes[targetOffset + 1] = pixels[pixelOffset + 1];
		bytes[targetOffset + 2] = pixels[pixelOffset + 2];
		targetOffset += 3;
		pixelOffset += 4;
	}
	for (let channel = 0; targetOffset < length; channel++) {
		bytes[targetOffset++] = pixels[pixelOffset + channel];
	}
	return bytes;
}

async function getPngDimensions(file: File): Promise<{ width: number; height: number }> {
	const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
	const headerView = new DataView(header.buffer);
	const chunkType = new TextDecoder().decode(header.subarray(12, 16));
	if (
		header.length !== 24 ||
		!PNG_SIGNATURE.every((byte, index) => header[index] === byte) ||
		headerView.getUint32(8, false) !== 13 ||
		chunkType !== 'IHDR'
	) {
		throw new Error('This is not a valid PNG image.');
	}

	const width = headerView.getUint32(16, false);
	const height = headerView.getUint32(20, false);
	if (
		width < PNG_INSTRUCTION_WIDTH ||
		width > PNG_MAX_DIMENSION ||
		height <= PNG_INSTRUCTION_HEIGHT ||
		height > PNG_MAX_DIMENSION ||
		width * height > PNG_MAX_PIXEL_COUNT
	) {
		throw new Error('This PNG has invalid preset image dimensions.');
	}
	return { width, height };
}

function createPresetHtml(serializedPreset: string): Blob {
	const safePresetJson = serializedPreset.replace(/</g, '\\u003c');
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Fruity Jibesh preset</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8fafc;color:#172554;font:16px Arial,sans-serif}
main{max-width:38rem;padding:2rem;border:1px solid #cbd5e1;background:white}
h1{margin-top:0}
button{padding:.8rem 1rem;border:0;background:#1d4ed8;color:white;font:inherit;cursor:pointer}
#status{min-height:1.5em}
.notice{margin-top:1.5rem;padding-top:1rem;border-top:1px solid #e2e8f0;color:#475569;font-size:.88rem;line-height:1.5}
.notice h2{margin-bottom:.5rem;color:#172554;font-size:1.1rem}
.notice p{margin:.65rem 0}
.notice a{color:#1d4ed8}
</style>
</head>
<body>
<main>
<h1>Fruity Jibesh preset</h1>
<p>This file contains a preset and its custom images, names, and audio.</p>
<p>Tap below to open Fruity Jibesh and transfer the preset directly in your browser. The preset is not uploaded.</p>
<p>If pop-ups do not work, <a href="https://fruity-jibesh-vv4i.vercel.app/" target="_self">open the project in this tab</a>, then choose Import from file and select this downloaded HTML file.</p>
<button id="open" type="button">Open preset in Fruity Jibesh</button>
<p id="status" role="status">Open this downloaded file in a browser, then tap the button.</p>
<section class="notice" aria-labelledby="about-title">
<h2 id="about-title">ARJC • Arjun M. Liji</h2>
<p>Fruity Jibesh is a community fruit party! Its source is shared under <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC 4.0</a> (non-commercial).</p>
<p>No tracking or background upload is built into this launcher. Your preset moves between browser tabs on your device; opening the game still makes a normal visit to its website.</p>
<p>This is a user-shared preset, not a file reviewed or endorsed by ARJC. The launcher has no remote scripts, but files can be changed after sharing—nobody can promise every copy is virus-free. Only open files from people you trust.</p>
<p><a href="https://arjc.github.io/" target="_blank" rel="noopener noreferrer">Arjun M. Liji (arjc.github.io)</a> is not responsible for community-shared or modified preset contents or resulting damages, to the extent allowed by law. Your legal rights still apply.</p>
</section>
</main>
<script id="preset-data" type="application/json">${safePresetJson}</script>
<script>
(() => {
  const targetOrigin = 'https://fruity-jibesh-vv4i.vercel.app';
  const presetJson = document.getElementById('preset-data').textContent;
  const status = document.getElementById('status');
  const button = document.getElementById('open');
  let targetWindow = null;
  let transferToken = '';
  let timeoutId = 0;

  function getFileName(fallbackName) {
    let fileName = '';
    try {
      fileName = decodeURIComponent(location.pathname.split('/').pop() || '');
    } catch {}
    fileName = fileName.replace(/\\.html?$/i, '').replace(/[<>:"|?*]/g, '-').split('/').join('-').split(String.fromCharCode(92)).join('-').trim();
    return fileName || fallbackName || 'preset';
  }

  function finish() {
    window.clearTimeout(timeoutId);
    window.removeEventListener('message', handleMessage);
    targetWindow = null;
    button.disabled = false;
  }

  function handleMessage(event) {
    if (event.source !== targetWindow || event.origin !== targetOrigin || !event.data || event.data.token !== transferToken) return;
    if (event.data.type === 'fruity-jibesh-preset-ready') {
      try {
        const preset = JSON.parse(presetJson);
        const fileName = getFileName(preset.name);
        const presetBytes = new TextEncoder().encode(presetJson);
        const payload = presetBytes.buffer;
        targetWindow.postMessage({ type: 'fruity-jibesh-preset-data', token: transferToken, fileName, payload }, targetOrigin, [payload]);
        status.textContent = 'Preset sent locally. Waiting for the game to finish importing...';
      } catch {
        status.textContent = 'Could not read the preset data in this file.';
        finish();
      }
    } else if (event.data.type === 'fruity-jibesh-preset-complete') {
      status.textContent = event.data.success
        ? 'Preset loaded! Choose Save in the game if you want to keep it.'
        : (event.data.error || 'The preset could not be imported.');
      finish();
    }
  }

  button.addEventListener('click', () => {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.focus();
      return;
    }
    const tokenBytes = new Uint8Array(16);
    crypto.getRandomValues(tokenBytes);
    transferToken = Array.from(tokenBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    window.addEventListener('message', handleMessage);
    targetWindow = window.open(targetOrigin + '/#fruity-preset=' + transferToken, '_blank');
    if (!targetWindow) {
      finish();
      status.textContent = 'Pop-up blocked. Use the open-in-this-tab link above, then import this file.';
      return;
    }
    button.disabled = true;
    status.textContent = 'Opening Fruity Jibesh and waiting for a secure local connection...';
    timeoutId = window.setTimeout(() => {
      finish();
      status.textContent = 'Could not connect. Use the open-in-this-tab link above, then import this file.';
    }, 60000);
  });
})();
</script>
</body>
</html>`;
	return new Blob([html], { type: 'text/html;charset=utf-8' });
}

async function extractPresetJsonFromPng(file: File): Promise<Uint8Array> {
	const dimensions = await getPngDimensions(file);
	const bitmap = await createImageBitmap(file);
	try {
		const scale = bitmap.width / PNG_INSTRUCTION_WIDTH;
		const instructionHeight = Math.ceil(PNG_INSTRUCTION_HEIGHT * scale);
		if (bitmap.width !== dimensions.width || bitmap.height !== dimensions.height) {
			throw new Error('This PNG does not contain valid preset pixel data.');
		}

		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Could not read the preset image.');
		context.drawImage(bitmap, 0, 0);

		const headerPixels = context.getImageData(0, instructionHeight, bitmap.width, 1).data;
		const header = readRgbPixelBytes(headerPixels, 0, PIXEL_PRESET_HEADER_SIZE);
		if (!PIXEL_PRESET_MAGIC.every((byte, index) => header[index] === byte)) {
			throw new Error('This PNG does not contain a Fruity Jibesh preset.');
		}

		const headerView = new DataView(header.buffer);
		const payloadLength = headerView.getUint32(4, false);
		const expectedChecksum = headerView.getUint32(8, false);
		if (payloadLength <= 0 || payloadLength > MAX_PRESET_FILE_SIZE_BYTES) {
			throw new Error('The preset pixel data in this PNG is invalid.');
		}

		const pixelCount = Math.ceil((PIXEL_PRESET_HEADER_SIZE + payloadLength) / 3);
		const expectedWidth = Math.max(PNG_INSTRUCTION_WIDTH, Math.ceil(Math.sqrt(pixelCount)));
		const expectedInstructionHeight = Math.ceil(
			(PNG_INSTRUCTION_HEIGHT * expectedWidth) / PNG_INSTRUCTION_WIDTH
		);
		const expectedHeight = expectedInstructionHeight + Math.ceil(pixelCount / expectedWidth);
		if (bitmap.width !== expectedWidth || bitmap.height !== expectedHeight) {
			throw new Error('The preset pixel data in this PNG is malformed.');
		}

		const pixelData = context.getImageData(
			0,
			instructionHeight,
			bitmap.width,
			bitmap.height - instructionHeight
		).data;
		const payload = readRgbPixelBytes(pixelData, PIXEL_PRESET_HEADER_SIZE, payloadLength);
		if (calculateCrc32([payload]) !== expectedChecksum) {
			throw new Error('The preset pixel data in this PNG is damaged.');
		}
		return payload;
	} finally {
		bitmap.close();
	}
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

export function applyFruitPresetTemporarily(preset: FruitPresetContent): void {
	for (const fruit of FRUITS) {
		delete fruitDisplayNames[fruit.name];
		delete fruitImageOverrides[fruit.name];
		delete fruitMergeSounds[fruit.name];
	}

	Object.assign(fruitDisplayNames, preset.names);
	Object.assign(fruitImageOverrides, preset.images);
	Object.assign(fruitMergeSounds, preset.sounds);
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
	return createPresetHtml(JSON.stringify(file));
}

export function parseFruitPresetData(payload: ArrayBuffer | Uint8Array): FruitPresetContent {
	const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
	if (bytes.length > MAX_PRESET_FILE_SIZE_BYTES) {
		throw new Error('The preset file is too large to import.');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		throw new Error('This preset data is not valid.');
	}
	if (
		!isRecord(parsed) ||
		parsed.format !== FILE_FORMAT ||
		parsed.version !== FILE_VERSION ||
		typeof parsed.name !== 'string'
	) {
		throw new Error('This is not a supported fruit preset file.');
	}

	return {
		names: validateNames(parsed.names),
		images: validateImages(parsed.images),
		sounds: validateSounds(parsed.sounds)
	};
}

export async function parseFruitPresetHtmlFile(file: File): Promise<FruitPresetContent> {
	if (!/\.html?$/i.test(file.name)) {
		throw new Error('Choose a Fruity Jibesh HTML preset file.');
	}
	if (file.size > MAX_PRESET_FILE_SIZE_BYTES + MAX_PRESET_HTML_OVERHEAD_BYTES) {
		throw new Error('The preset file is too large to import.');
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	let html: string;
	try {
		html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error('This HTML preset file is not valid UTF-8.');
	}

	const dataTag = '<script id="preset-data" type="application/json">';
	const dataStart = html.indexOf(dataTag);
	const jsonStart = dataStart + dataTag.length;
	const jsonEnd = html.indexOf('</script>', jsonStart);
	if (dataStart < 0 || jsonEnd < jsonStart) {
		throw new Error('This HTML file does not contain a Fruity Jibesh preset.');
	}

	return parseFruitPresetData(encodeText(html.slice(jsonStart, jsonEnd)));
}

export async function importFruitPresetData(
	payload: ArrayBuffer | Uint8Array,
	fileName: string
): Promise<string> {
	const preset = parseFruitPresetData(payload);
	const name = uniquePresetName(fileName.trim());
	if (!name) throw new Error('The preset file must have a name.');
	await saveFruitPreset({ name, ...preset });
	return name;
}

export async function importFruitPresetFile(file: File): Promise<string> {
	const lowerFileName = file.name.toLowerCase();
	const isPng = lowerFileName.endsWith('.png');
	const isPdf = lowerFileName.endsWith('.pdf');
	const isLegacyPreset = lowerFileName.endsWith('.arjcfruits');
	if (!isPng && !isPdf && !isLegacyPreset) {
		throw new Error('Choose a Fruity Jibesh PNG preset image.');
	}
	if (file.size > (isPng ? MAX_PRESET_IMAGE_FILE_SIZE_BYTES : MAX_PRESET_FILE_SIZE_BYTES)) {
		throw new Error('The preset file is too large to import.');
	}

	let payload: Uint8Array;
	try {
		payload = isPng
			? await extractPresetJsonFromPng(file)
			: isPdf
				? extractPresetJsonFromPdf(new Uint8Array(await file.arrayBuffer()))
				: new Uint8Array(await file.arrayBuffer());
	} catch {
		throw new Error(
			isPng
				? 'This PNG does not contain valid preset data.'
				: isPdf
					? 'This PDF does not contain valid preset data.'
					: 'This preset file is not valid JSON.'
		);
	}

	const extension = isPng ? '.png' : isPdf ? '.pdf' : '.arjcfruits';
	const fileName = file.name.slice(0, -extension.length).trim();
	return importFruitPresetData(payload, fileName);
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
