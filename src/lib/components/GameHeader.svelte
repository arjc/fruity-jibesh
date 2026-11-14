<!-- App.svelte -->
<script lang="ts">
import type { GameState } from '$lib/stores/game.svelte';
import SoundOff from '../icons/sound-off.svelte';
import SoundOn from '../icons/sound-on.svelte';
import Fruit from './Fruit.svelte';
import FruitPresetControls from './FruitPresetControls.svelte';

interface GameHeaderProps {
	gameState: GameState;
	onShake: () => void;
	onCommunityPresetLoaded?: () => void;
}

const { gameState, onShake, onCommunityPresetLoaded }: GameHeaderProps = $props();

function handleMuteClick() {
	gameState?.audioManager?.toggleMute();
}
</script>

<header class="header">
  <div class="leading">
    <div class="app-title">
      Fruity Jibesh <Fruit name="watermelon" radius="1em" />
    </div>
  </div>
  <div class="trailing">
    <button
      class="shake-button"
      onclick={onShake}
      aria-label="Shake container"
      title="Shake container (tap to enable device shake)"
      disabled={gameState.status !== 'playing'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3v18M16 3v18M4 7 2 9l2 2M4 13l-2 2 2 2M20 7l2 2-2 2M20 13l2 2-2 2" />
      </svg>
    </button>
    <FruitPresetControls {onCommunityPresetLoaded} />
    <button onclick={handleMuteClick} aria-label="Toggle Sound">
      {#if gameState?.audioManager?.isMuted}
        <SoundOff />
      {:else}
        <SoundOn />
      {/if}
    </button>
  </div>
</header>

<style>
  .app-title {
    display: flex;
    align-items: center;
    gap: 0.5em;
    font-weight: 550;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1em;
    padding: 0.5em 1em;
  }

  .leading,
  .trailing {
    display: flex;
    align-items: center;
    gap: 0.5em;
  }

  .shake-button svg {
    width: 1.1em;
    height: 1.1em;
    fill: currentColor;
  }

  .shake-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
