<script lang="ts">
import {
	fruitDisplayNames,
	fruitMergeSounds,
	getFruitDisplayName,
	waitForPendingFruitMergeSoundSaves
} from '../stores/fruitCustomizations.svelte';
import { fruitImageOverrides } from '../stores/fruitImageOverrides.svelte';
import {
	applyFruitPreset,
	applyFruitPresetTemporarily,
	exportFruitPresetFile,
	importFruitPresetFile,
	listFruitPresets,
	parseFruitPresetHtmlFile,
	saveFruitPreset
} from '../stores/fruitPresets';

let { onCommunityPresetLoaded }: { onCommunityPresetLoaded?: () => void } = $props();

const FIRST_SHARED_PRESET_KEY = 'subak-fruit-preset-shared-once';
const SHARED_PRESET_NAME = 'Shared preset';

let presetDialog = $state<HTMLDialogElement | null>(null);
let presetMode = $state<'save' | 'load' | 'share' | null>(null);
let presetNameDraft = $state('');
let shareFileNameDraft = $state('');
let shareFileContent = $state<Blob | null>(null);
let presetNames = $state<string[]>([]);
let presetError = $state('');
let presetStatus = $state('');
let presetBusy = $state(false);

function openSavePreset(): void {
	presetMode = 'save';
	presetNameDraft = '';
	presetError = '';
	presetStatus = '';
	presetDialog?.showModal();
}

function openLoadPreset(): void {
	presetMode = 'load';
	presetError = '';
	presetStatus = '';
	try {
		presetNames = listFruitPresets();
		presetDialog?.showModal();
	} catch (error) {
		console.error('Failed to list saved presets:', error);
		presetError = 'Could not load the list of saved presets.';
		presetDialog?.showModal();
	}
}

async function savePreset(): Promise<void> {
	presetError = '';
	presetStatus = '';
	presetBusy = true;
	try {
		await saveFruitPreset(getCurrentFruitPreset(presetNameDraft));
		presetNames = listFruitPresets();
		presetStatus = 'Preset saved.';
		presetMode = 'load';
		presetNameDraft = '';
	} catch (error) {
		console.error('Failed to save fruit preset:', error);
		presetError = error instanceof Error ? error.message : 'Could not save this preset.';
	} finally {
		presetBusy = false;
	}
}

function getCurrentFruitPreset(name: string) {
	return {
		name,
		names: { ...fruitDisplayNames },
		images: { ...fruitImageOverrides },
		sounds: { ...fruitMergeSounds }
	};
}

function getUniqueSharedPresetName(): string {
	const existingNames = new Set(listFruitPresets().map((name) => name.toLocaleLowerCase()));
	if (!existingNames.has(SHARED_PRESET_NAME.toLocaleLowerCase())) return SHARED_PRESET_NAME;

	for (let number = 2; ; number++) {
		const candidate = `${SHARED_PRESET_NAME} (${number})`;
		if (!existingNames.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

async function openSharePreset(): Promise<void> {
	if (presetBusy || presetDialog?.open) return;
	presetError = '';
	presetStatus = '';
	presetMode = 'share';
	shareFileNameDraft = `${getFruitDisplayName('watermelon')} preset.html`;
	shareFileContent = null;
	presetBusy = true;
	presetDialog?.showModal();
	try {
		await waitForPendingFruitMergeSoundSaves();
		let firstShare = false;
		if (!localStorage.getItem(FIRST_SHARED_PRESET_KEY)) {
			await saveFruitPreset(getCurrentFruitPreset(getUniqueSharedPresetName()));
			localStorage.setItem(FIRST_SHARED_PRESET_KEY, 'true');
			firstShare = true;
		}
		shareFileContent = await exportFruitPresetFile(
			getCurrentFruitPreset(`${getFruitDisplayName('watermelon')} preset`)
		);
		presetStatus = firstShare ? 'Saved a local copy. Ready to share.' : 'Ready to share.';
	} catch (error) {
		console.error('Failed to prepare fruit preset for sharing:', error);
		presetError =
			error instanceof Error ? error.message : 'Could not prepare this preset for sharing.';
	} finally {
		presetBusy = false;
	}
}

function getShareFileName(name: string): string {
	const baseName = name
		.trim()
		.replace(/\.html?$/i, '')
		.replace(/[<>:"|?*\p{Cc}]/gu, '-')
		.replace(/[\\/]/g, '-')
		.slice(0, 64)
		.trim();
	return `${baseName || 'preset'}.html`;
}

function downloadShareFile(file: File): void {
	const objectUrl = URL.createObjectURL(file);
	try {
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = file.name;
		document.body.append(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
	} catch (error) {
		URL.revokeObjectURL(objectUrl);
		throw error;
	}
}

function reportShareError(error: unknown): void {
	if (error instanceof Error && error.name === 'AbortError') {
		presetStatus = 'Sharing cancelled.';
		return;
	}
	console.error('Failed to share fruit preset:', error);
	presetError = error instanceof Error ? error.message : 'Could not share this preset.';
}

function sharePresetFile(): void {
	if (!shareFileContent) return;

	presetError = '';
	presetStatus = '';
	let file: File;
	let supportsFileSharing = false;
	try {
		const fileName = getShareFileName(shareFileNameDraft);
		file = new File([shareFileContent], fileName, { type: 'text/html' });
		supportsFileSharing =
			typeof navigator.share === 'function' &&
			(typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] }));
	} catch (error) {
		reportShareError(error);
		return;
	}

	if (!supportsFileSharing) {
		try {
			downloadShareFile(file);
			presetStatus = 'File sharing is not available here; the HTML file was downloaded instead.';
		} catch (error) {
			reportShareError(error);
		}
		return;
	}

	const fileName = file.name;
	presetBusy = true;
	try {
		void navigator
			.share({ files: [file], title: fileName })
			.then(() => {
				presetStatus = `Shared ${fileName}.`;
				presetDialog?.close();
			})
			.catch(reportShareError)
			.finally(() => {
				presetBusy = false;
			});
	} catch (error) {
		presetBusy = false;
		reportShareError(error);
	}
}

async function handlePresetFileChange(event: Event): Promise<void> {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) return;

	presetError = '';
	presetStatus = '';
	presetBusy = true;
	try {
		if (/\.html?$/i.test(file.name)) {
			applyFruitPresetTemporarily(await parseFruitPresetHtmlFile(file));
			onCommunityPresetLoaded?.();
			presetStatus = 'Community preset loaded temporarily. Save it if you want to keep it.';
			presetDialog?.close();
			return;
		}

		const name = await importFruitPresetFile(file);
		presetNames = listFruitPresets();
		await loadPreset(name);
	} catch (error) {
		console.error('Failed to import fruit preset:', error);
		presetError = error instanceof Error ? error.message : 'Could not import this preset.';
	} finally {
		input.value = '';
		presetBusy = false;
	}
}

async function loadPreset(name: string): Promise<void> {
	presetError = '';
	presetStatus = '';
	presetBusy = true;
	try {
		await applyFruitPreset(name);
		presetNames = listFruitPresets();
		presetDialog?.close();
	} catch (error) {
		console.error(`Failed to load fruit preset ${name}:`, error);
		presetError = error instanceof Error ? error.message : 'Could not load this preset.';
	} finally {
		presetBusy = false;
	}
}
</script>

<div class="preset-controls" aria-label="Fruit presets">
	<button type="button" aria-label="Save preset" onclick={openSavePreset}>Save</button>
	<button type="button" aria-label="Load preset" onclick={openLoadPreset}>Load</button>
	<button
		type="button"
		aria-label="Share preset"
		disabled={presetBusy}
		onclick={() => void openSharePreset()}
	>
		Share
	</button>
	{#if presetError}
		<span class="preset-feedback error" role="alert">{presetError}</span>
	{:else if presetStatus}
		<span class="preset-feedback" role="status">{presetStatus}</span>
	{/if}
</div>

<dialog
	bind:this={presetDialog}
	class="preset-dialog"
	aria-labelledby="preset-dialog-title"
	onclick={(event) => {
		if (event.target === presetDialog) presetDialog?.close();
	}}
>
	<header class="preset-header">
		<h3 id="preset-dialog-title">
			{presetMode === 'save' ? 'Save preset' : presetMode === 'share' ? 'Share preset' : 'Load preset'}
		</h3>
		<button type="button" aria-label="Close presets" onclick={() => presetDialog?.close()}>
			&times;
		</button>
	</header>

	{#if presetMode === 'save'}
		<form
			class="preset-list"
			onsubmit={(event) => {
				event.preventDefault();
				void savePreset();
			}}
		>
			<label for="preset-name">Preset name</label>
			<div class="preset-name">
				<input id="preset-name" bind:value={presetNameDraft} maxlength="32" autocomplete="off" />
				<button type="submit" disabled={presetBusy}>Save</button>
			</div>
		</form>
	{:else if presetMode === 'share'}
		<form
			class="preset-list"
			onsubmit={(event) => {
				event.preventDefault();
				sharePresetFile();
			}}
		>
			<p>The first share saves one copy in this browser. You can rename the HTML file here.</p>
			<label for="share-file-name">File name</label>
			<div class="preset-name">
				<input
					id="share-file-name"
					bind:value={shareFileNameDraft}
					maxlength="69"
					autocomplete="off"
					disabled={presetBusy}
				/>
				<button
					type="submit"
					aria-label="Share file"
					disabled={presetBusy || !shareFileContent}
				>
					{presetBusy ? 'Preparing…' : 'Share'}
				</button>
			</div>
		</form>
	{:else}
		<section class="preset-list" aria-label="Saved presets">
			<label class="add-preset">
				<span>+ Add from file</span>
				<input
					type="file"
					accept=".html,.htm,text/html,.png,image/png,.pdf,application/pdf,.arjcfruits,application/json"
					aria-label="Add preset from file"
					disabled={presetBusy}
					onchange={handlePresetFileChange}
				/>
			</label>
			<button type="button" disabled={presetBusy} onclick={() => void loadPreset('Default')}>
				Default
			</button>
			{#each presetNames as presetName (presetName)}
				<button
					type="button"
					disabled={presetBusy}
					onclick={() => void loadPreset(presetName)}
				>
					{presetName}
				</button>
			{/each}
		</section>
	{/if}

	{#if presetError}
		<p class="preset-message error" role="alert">{presetError}</p>
	{:else if presetStatus}
		<p class="preset-message" role="status">{presetStatus}</p>
	{/if}
</dialog>

<style>
	.preset-controls {
		display: flex;
		gap: 0.35em;
	}

	.preset-controls button {
		padding: 0.35em 0.55em;
	}

	.preset-feedback {
		max-width: 14rem;
		align-self: center;
		font-size: 0.7em;
	}

	.preset-feedback.error {
		color: #7d173f;
	}

	.preset-dialog {
		position: fixed;
		width: min(22rem, calc(100vw - 2rem));
		max-height: min(80vh, 36rem);
		margin: auto;
		padding: 1rem;
		overflow: auto;
		border: 1px solid var(--color-border);
		background: var(--color-background-light);
		color: var(--color-text);
		box-shadow: 0 1rem 3rem rgb(0 0 0 / 25%);
	}

	.preset-dialog::backdrop {
		background: rgb(24 15 34 / 45%);
		backdrop-filter: blur(3px);
	}

	.preset-header,
	.preset-name {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.preset-header {
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.preset-header h3 {
		margin: 0;
	}

	.preset-list {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
	}

	.preset-list button {
		text-align: left;
	}

	.add-preset {
		position: relative;
		display: flex;
		min-height: 2rem;
		align-items: center;
		padding: 0.35rem 0.5rem;
		border: 1px dashed var(--color-border);
		cursor: pointer;
	}

	.add-preset input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	.preset-name input {
		min-width: 0;
		flex: 1;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--color-border);
		font: inherit;
	}

	.preset-message {
		margin: 0.75rem 0 0;
		font-size: 0.8em;
	}

	.preset-message.error {
		color: #7d173f;
	}
</style>
