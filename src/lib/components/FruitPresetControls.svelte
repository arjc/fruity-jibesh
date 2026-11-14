<script lang="ts">
import { FRUITS } from '../constants';
import {
	fruitDisplayNames,
	fruitMergeSounds,
	resetFruitDisplayName,
	resetFruitMergeSound,
	setFruitDisplayName,
	setFruitMergeSound
} from '../stores/fruitCustomizations.svelte';
import {
	fruitImageOverrides,
	resetFruitImageOverride,
	setFruitImageOverride
} from '../stores/fruitImageOverrides.svelte';
import { getFruitPreset, listFruitPresets, saveFruitPreset } from '../stores/fruitPresets';

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

async function loadPreset(name: string): Promise<void> {
	presetError = '';
	presetStatus = '';
	presetBusy = true;
	try {
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
		}

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

	.preset-dialog {
		position: fixed;
		width: min(22rem, calc(100vw - 2rem));
		max-height: min(80vh, 36rem);
		margin: auto;
		padding: 1rem;
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: 1rem;
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

	.preset-name input {
		min-width: 0;
		flex: 1;
		padding: 0.4rem 0.55rem;
		border: 1px solid var(--color-border);
		border-radius: 0.4rem;
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
