<script lang="ts">
import { onDestroy } from 'svelte';
import { FRUITS } from '../constants';
import {
	fruitDisplayNames,
	fruitMergeSounds,
	getFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound
} from '../stores/fruitCustomizations.svelte';
import { fruitImageOverrides, setFruitImageOverride } from '../stores/fruitImageOverrides.svelte';
import { encodeAudioAsMp3, encodePcmAsMp3 } from '../utils/encodeAudioAsMp3';

import Fruit from './Fruit.svelte';

const fruitsMidpoint = Math.ceil(FRUITS.length / 2);
const fruitGroups = [FRUITS.slice(0, fruitsMidpoint), FRUITS.slice(fruitsMidpoint, FRUITS.length)];
const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_SOUND_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_RECORDING_MS = 10_000;

let editDialog = $state<HTMLDialogElement | null>(null);
let editingFruit: (typeof FRUITS)[number] | null = $state(null);
let nameDraft = $state('');
let editorError = $state('');
let editorStatus = $state('');
let recordingFruitName = $state<string | null>(null);
let recordingAudioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let recordingSource: MediaStreamAudioSourceNode | null = null;
let recordingProcessor: ScriptProcessorNode | null = null;
let recordingSilence: GainNode | null = null;
let recordingTimeout: ReturnType<typeof setTimeout> | null = null;
let recordedPcmChunks: Float32Array[] = [];
let recordedSampleCount = 0;

function openEditor(fruit: (typeof FRUITS)[number]): void {
	editingFruit = fruit;
	nameDraft = getFruitDisplayName(fruit.name);
	editorError = '';
	editorStatus = '';
	editDialog?.showModal();
}

function closeEditor(): void {
	if (recordingFruitName) stopRecording();
	editDialog?.close();
}

function handleDialogClose(): void {
	if (recordingFruitName) stopRecording();
	editingFruit = null;
}

function handleImageChange(event: Event): void {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file || !editingFruit) return;

	editorError = '';
	editorStatus = '';
	if (!file.type.startsWith('image/')) {
		editorError = 'Choose an image file.';
		input.value = '';
		return;
	}

	if (file.size > MAX_IMAGE_SIZE_BYTES) {
		editorError = 'Images must be 2 MB or smaller.';
		input.value = '';
		return;
	}

	const fruitName = editingFruit.name;
	const reader = new FileReader();
	reader.onload = () => {
		if (typeof reader.result !== 'string') {
			editorError = 'Could not read this image. Please try another file.';
			return;
		}

		try {
			setFruitImageOverride(fruitName, reader.result);
			editorStatus = 'Image updated.';
		} catch (error) {
			console.error(`Failed to save custom image for ${fruitName}:`, error);
			editorError = 'Could not save this image. Try a smaller file or another browser.';
		}
	};
	reader.onerror = () => {
		console.error(`Failed to read custom image for ${fruitName}:`, reader.error);
		editorError = 'Could not read this image. Please try another file.';
	};
	reader.readAsDataURL(file);
	input.value = '';
}

function saveName(): boolean {
	if (!editingFruit) return false;

	editorError = '';
	try {
		setFruitDisplayName(editingFruit.name, nameDraft);
		nameDraft = fruitDisplayNames[editingFruit.name];
		editorStatus = 'Name saved.';
		return true;
	} catch (error) {
		console.error(`Failed to save custom name for ${editingFruit.name}:`, error);
		editorError = error instanceof Error ? error.message : 'Could not save this name.';
		return false;
	}
}

function saveEditor(): void {
	if (saveName()) editDialog?.close();
}

async function persistMergeSound(fruitName: string, source: Blob): Promise<void> {
	try {
		editorStatus = 'Converting audio to MP3…';
		const sound = await encodeAudioAsMp3(source);
		await saveMp3MergeSound(fruitName, sound);
	} catch (error) {
		showAudioSaveError(fruitName, error);
	}
}

async function saveMp3MergeSound(fruitName: string, sound: Blob): Promise<void> {
	if (sound.size > MAX_SOUND_SIZE_BYTES) {
		throw new Error('The MP3 file is larger than 5 MB.');
	}
	await setFruitMergeSound(fruitName, sound);
	editorError = '';
	editorStatus = 'MP3 merge sound saved.';
}

function showAudioSaveError(fruitName: string, error: unknown): void {
	console.error(`Failed to encode or save custom merge sound for ${fruitName}:`, error);
	const reason = error instanceof Error ? ` ${error.message}` : '';
	editorError = `Could not convert this audio to MP3.${reason} Try an MP3, WAV, or audio file supported by this browser.`;
	editorStatus = '';
}

async function persistRecordedMergeSound(
	fruitName: string,
	chunks: Float32Array[],
	sampleCount: number,
	sampleRate: number
): Promise<void> {
	try {
		const samples = new Float32Array(sampleCount);
		let offset = 0;
		for (const chunk of chunks) {
			samples.set(chunk, offset);
			offset += chunk.length;
		}
		editorStatus = 'Encoding recording as MP3…';
		const sound = await encodePcmAsMp3([samples], sampleRate);
		await saveMp3MergeSound(fruitName, sound);
	} catch (error) {
		showAudioSaveError(fruitName, error);
	}
}

async function handleAudioChange(event: Event): Promise<void> {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file || !editingFruit) return;

	editorError = '';
	editorStatus = '';
	if (!file.type.startsWith('audio/')) {
		editorError = 'Choose an audio file.';
		input.value = '';
		return;
	}

	if (file.size > MAX_SOUND_SIZE_BYTES) {
		editorError = 'Audio files must be 5 MB or smaller.';
		input.value = '';
		return;
	}

	await persistMergeSound(editingFruit.name, file);
	input.value = '';
}

async function startRecording(): Promise<void> {
	const fruitName = editingFruit?.name;
	if (!fruitName) return;
	if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
		editorError = 'Audio recording is not supported in this browser.';
		return;
	}

	editorError = '';
	editorStatus = '';
	try {
		const context = new AudioContext();
		recordingAudioContext = context;
		await context.resume();
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		if (!editDialog?.open) {
			for (const track of stream.getTracks()) track.stop();
			await context.close();
			recordingAudioContext = null;
			return;
		}

		mediaStream = stream;
		recordingSource = context.createMediaStreamSource(stream);
		recordingProcessor = context.createScriptProcessor(4096, 1, 1);
		recordingSilence = context.createGain();
		recordingSilence.gain.value = 0;
		recordedPcmChunks = [];
		recordedSampleCount = 0;
		recordingFruitName = fruitName;
		recordingProcessor.onaudioprocess = (event) => {
			if (recordingFruitName !== fruitName) return;
			const availableSamples = Math.min(
				event.inputBuffer.length,
				Math.max(0, Math.ceil((context.sampleRate * MAX_RECORDING_MS) / 1000) - recordedSampleCount)
			);
			if (availableSamples > 0) {
				recordedPcmChunks.push(event.inputBuffer.getChannelData(0).slice(0, availableSamples));
				recordedSampleCount += availableSamples;
			}
			if (availableSamples < event.inputBuffer.length) stopRecording();
		};
		recordingSource.connect(recordingProcessor);
		recordingProcessor.connect(recordingSilence);
		recordingSilence.connect(context.destination);
		editorStatus = 'Recording… stop when you are done.';
		recordingTimeout = setTimeout(stopRecording, MAX_RECORDING_MS);
	} catch (error) {
		console.error('Failed to start audio recording:', error);
		editorError = 'Microphone access was not allowed or could not be started.';
		cleanupRecording();
	}
}

function cleanupRecording(): void {
	if (recordingTimeout) {
		clearTimeout(recordingTimeout);
		recordingTimeout = null;
	}
	if (recordingProcessor) recordingProcessor.onaudioprocess = null;
	recordingSource?.disconnect();
	recordingProcessor?.disconnect();
	recordingSilence?.disconnect();
	if (mediaStream) {
		for (const track of mediaStream.getTracks()) track.stop();
	}
	if (recordingAudioContext && recordingAudioContext.state !== 'closed') {
		void recordingAudioContext.close().catch((error: unknown) => {
			console.error('Failed to close the recording audio context:', error);
		});
	}
	recordingAudioContext = null;
	mediaStream = null;
	recordingSource = null;
	recordingProcessor = null;
	recordingSilence = null;
	recordingFruitName = null;
}

function stopRecording(): void {
	const fruitName = recordingFruitName;
	const chunks = recordedPcmChunks;
	const sampleCount = recordedSampleCount;
	const sampleRate = recordingAudioContext?.sampleRate ?? 0;
	cleanupRecording();
	recordedPcmChunks = [];
	recordedSampleCount = 0;
	if (!fruitName || sampleCount === 0 || sampleRate === 0) {
		editorStatus = 'No audio was recorded.';
		return;
	}
	void persistRecordedMergeSound(fruitName, chunks, sampleCount, sampleRate);
}

async function removeMergeSound(): Promise<void> {
	if (!editingFruit) return;

	editorError = '';
	try {
		await resetFruitMergeSound(editingFruit.name);
		editorStatus = 'Custom merge sound removed.';
	} catch (error) {
		console.error(`Failed to remove custom merge sound for ${editingFruit.name}:`, error);
		editorError = 'Could not remove this sound.';
	}
}

onDestroy(() => {
	cleanupRecording();
});
</script>

<div class="fruits">
	<!-- svelte-ignore element_invalid_self_closing_tag -->
	<div class="fruitLoop" />
	<div class="fruitGroups">
		{#each fruitGroups as fruitGroup, i (i)}
			<div class="fruitGroup">
				{#each fruitGroup as fruit (fruit.name)}
					<div class="fruit-option">
						<Fruit {...fruit} radius="1.5em" />
						<button
							type="button"
							class="fruit-edit"
							aria-label={`Edit ${getFruitDisplayName(fruit.name)}`}
							title={`Edit ${getFruitDisplayName(fruit.name)}`}
							onclick={() => openEditor(fruit)}
						>
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M4 16.5V20h3.5L18.8 8.7l-3.5-3.5L4 16.5Zm17.7-10.2a.9.9 0 0 0 0-1.3l-2.7-2.7a.9.9 0 0 0-1.3 0L16 4l3.5 3.5 2.2-1.2Z" />
							</svg>
						</button>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<dialog
	bind:this={editDialog}
	class="fruit-editor"
	aria-labelledby="fruit-editor-title"
	onclose={handleDialogClose}
	onclick={(event) => {
		if (event.target === editDialog) closeEditor();
	}}
>
	{#if editingFruit}
		<form
			class="fruit-editor-form"
			onsubmit={(event) => {
				event.preventDefault();
				saveEditor();
			}}
		>
			<header class="editor-header">
				<h3 id="fruit-editor-title">Edit {getFruitDisplayName(editingFruit.name)}</h3>
				<button type="button" class="close-editor" aria-label="Close editor" onclick={closeEditor}>
					&times;
				</button>
			</header>

			<label class="image-picker">
				<span class="image-preview">
					{#if fruitImageOverrides[editingFruit.name]}
						<img src={fruitImageOverrides[editingFruit.name]} alt="" />
					{:else}
						img
					{/if}
				</span>
				<span class="image-help">Up to 2 MB<br />Choose image</span>
				<input
					type="file"
					accept="image/*"
					aria-label={`Customize ${editingFruit.name} image`}
					onchange={handleImageChange}
				/>
			</label>

			<label class="visually-hidden" for="fruit-display-name">Fruit name</label>
			<input
				class="fruit-name-input"
				id="fruit-display-name"
				bind:value={nameDraft}
				maxlength="32"
				autocomplete="off"
				placeholder="Fruit name"
			/>

			<div class="sound-row">
				<span class="sound-label">Merge sound:</span>
				<label class="icon-button" title="Add sound file">
					<span aria-hidden="true">+</span>
					<input
						type="file"
						accept="audio/*"
						aria-label={`Add merge sound for ${editingFruit.name}`}
						onchange={handleAudioChange}
					/>
				</label>
				<button
					type="button"
					class="icon-button"
					aria-label={recordingFruitName === editingFruit.name ? 'Stop recording' : 'Record sound'}
					title={recordingFruitName === editingFruit.name ? 'Stop recording' : 'Record sound'}
					disabled={recordingFruitName !== null && recordingFruitName !== editingFruit.name}
					onclick={() => {
						if (recordingFruitName === editingFruit.name) stopRecording();
						else void startRecording();
					}}
				>
					{#if recordingFruitName === editingFruit.name}
						<span aria-hidden="true">■</span>
					{:else}
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V21h2v-3.07A7 7 0 0 0 19 11h-2Z" />
						</svg>
					{/if}
				</button>
				{#if fruitMergeSounds[editingFruit.name]}
					<button
						type="button"
						class="remove-sound icon-button"
						aria-label="Remove custom merge sound"
						title="Remove custom merge sound"
						onclick={removeMergeSound}
					>
						&times;
					</button>
				{/if}
			</div>

			{#if editorError}
				<p class="editor-message error" role="alert">{editorError}</p>
			{:else if editorStatus}
				<p class="editor-message" role="status">{editorStatus}</p>
			{/if}

			<footer class="editor-footer">
				<button type="submit">Save</button>
				<button type="button" onclick={closeEditor}>Cancel</button>
			</footer>
		</form>
	{/if}
</dialog>

<style>
	.fruits {
		position: relative;
		padding: 10px 0;
	}

	.fruitLoop {
		position: absolute;
		border: var(--color-border) 1px solid;
		top: 0;
		right: 10px;
		bottom: 0;
		left: 10px;
		border-radius: 25px;
	}

	.fruitGroups {
		position: relative;
		display: flex;
		gap: 0.75em;
	}

	.fruitGroup {
		display: flex;
		flex-direction: column;
		gap: 0.75em;
		justify-content: center;

		&:nth-child(even) {
			flex-direction: column-reverse;
		}
	}

	.fruit-option {
		position: relative;
	}

	.fruit-edit {
		position: absolute;
		top: -0.3em;
		right: -0.3em;
		display: grid;
		width: 1.15em;
		opacity: 0;
		height: 1.15em;
		place-items: center;
		border: 1px solid var(--color-background-light);
		border-radius: 50%;
		background: var(--color-text);
		color: var(--color-background-light);
		cursor: pointer;
		z-index: 1;
		padding: 0;
	}

	.fruit-edit svg {
		width: 0.7em;
		height: 0.7em;
		fill: currentColor;
		pointer-events: none;
	}

	.fruit-editor {
		position: fixed;
		width: min(20rem, calc(100vw - 2rem));
		max-height: min(80vh, 28rem);
		margin: auto;
		padding: 0.9rem;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: 1rem;
		background: var(--color-background-light);
		color: var(--color-text);
		box-shadow: 0 1rem 3rem rgb(0 0 0 / 25%);
	}

	.fruit-editor::backdrop {
		background: rgb(24 15 34 / 45%);
		backdrop-filter: blur(3px);
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--color-border);
	}

	.editor-header h3 {
		margin: 0;
		font-size: 1em;
	}

	.close-editor {
		min-width: 1.8rem;
		padding: 0;
		font-size: 1.5em;
	}

	.fruit-editor-form {
		display: grid;
		gap: 0.65rem;
	}

	.image-picker {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.65rem;
		cursor: pointer;
	}

	.image-preview {
		display: grid;
		width: 3.25rem;
		height: 3rem;
		flex: none;
		place-items: center;
		overflow: hidden;
		border: 2px solid var(--color-text);
		font-size: 0.85em;
	}

	.image-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.image-help {
		font-size: 0.85em;
		line-height: 1.3;
	}

	.image-picker input,
	.icon-button input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.image-picker:focus-within,
	.icon-button:focus-within {
		outline: 2px solid var(--color-focus-outline);
		outline-offset: 2px;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.fruit-name-input {
		width: 100%;
		min-width: 0;
		padding: 0.4rem 0.55rem;
		border: 2px solid var(--color-border);
		border-radius: 0.2rem;
		background: white;
		color: var(--color-text);
		font: inherit;
		font-size: 1.15em;
		user-select: text;
	}

	.sound-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.sound-label {
		margin-right: auto;
		font-size: 1.1em;
	}

	.icon-button {
		position: relative;
		display: grid;
		width: 2.4rem;
		height: 2.4rem;
		flex: none;
		place-items: center;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: 1.4em;
		cursor: pointer;
	}

	.icon-button svg {
		width: 1.15rem;
		height: 1.15rem;
		fill: currentColor;
	}

	.editor-footer {
		display: flex;
		gap: 0.6rem;
	}

	.editor-footer button {
		flex: 1;
	}

	.remove-sound {
		color: #7d173f;
	}

	.editor-message {
		margin: 0;
		font-size: 0.8em;
	}

	.editor-message.error {
		color: #7d173f;
	}

	@media (aspect-ratio < 0.65) {
		.fruits {
			padding: 0 10px;
		}

		.fruitLoop {
			top: 0.75em;
			right: 0;
			bottom: 0.75em;
			left: 0;
		}

		.fruitGroups {
			flex-direction: column;
		}

		.fruitGroup {
			flex-direction: row;

			&:nth-child(even) {
				flex-direction: row-reverse;
			}
		}
	}
</style>
