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
	exportFruitPresetFile,
	importFruitPresetFile,
	listFruitPresets,
	saveFruitPreset
} from '../stores/fruitPresets';

let presetDialog = $state<HTMLDialogElement | null>(null);
let presetMode = $state<'save' | 'load' | null>(null);
let presetNameDraft = $state('');
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
		await saveFruitPreset({
			name: presetNameDraft,
			names: { ...fruitDisplayNames },
			images: { ...fruitImageOverrides },
			sounds: { ...fruitMergeSounds }
		});
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

async function exportPreset(): Promise<void> {
	presetError = '';
	presetStatus = '';
	presetBusy = true;
	let objectUrl: string | null = null;
	try {
		await waitForPendingFruitMergeSoundSaves();
		const presetName = `${getFruitDisplayName('watermelon')} preset`;
		const file = await exportFruitPresetFile({
			name: presetName,
			names: { ...fruitDisplayNames },
			images: { ...fruitImageOverrides },
			sounds: { ...fruitMergeSounds }
		});
		const safeName = presetName
			.replace(/[<>:"|?*]/g, '-')
			.split('/')
			.join('-')
			.split('\\')
			.join('-')
			.trim();
		const fileName = `${safeName || 'preset'}.html`;
		objectUrl = URL.createObjectURL(file);
		const link = document.createElement('a');
		link.href = objectUrl;
		link.download = fileName;
		document.body.append(link);
		link.click();
		link.remove();
		window.setTimeout(() => {
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		}, 1000);
		presetStatus = `Exported ${fileName}.`;
	} catch (error) {
		if (objectUrl) URL.revokeObjectURL(objectUrl);
		console.error('Failed to export fruit preset:', error);
		presetError = error instanceof Error ? error.message : 'Could not export this preset.';
	} finally {
		presetBusy = false;
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
	<button type="button" aria-label="Export preset" disabled={presetBusy} onclick={() => void exportPreset()}>
		Export
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
		<h3 id="preset-dialog-title">{presetMode === 'save' ? 'Save preset' : 'Load preset'}</h3>
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
	{:else}
		<section class="preset-list" aria-label="Saved presets">
			<label class="add-preset">
				<span>+ Add from file</span>
				<input
					type="file"
					accept=".png,image/png,.pdf,application/pdf,.arjcfruits,application/json"
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
