<script lang="ts">
import { getHighScores } from '../stores/db';
import Modal from './Modal.svelte';

const { open, score, onClose } = $props<{
	open: boolean;
	score: number;
	onClose: () => void;
}>();

let bestScore = $state<number | null>(null);

$effect(() => {
	if (!open) return;

	let active = true;
	getHighScores().then((scores) => {
		if (active) bestScore = Math.max(score, scores[0]?.score ?? score);
	});

	return () => {
		active = false;
	};
});
</script>

<Modal {open} {onClose} title="Game Over">
  <div class="content">
    <h2 class="heading">Thanks for playing!</h2>
    <p>Score: <strong>{Intl.NumberFormat().format(score)}</strong></p>
    {#if bestScore !== null}
      <p>Best: <strong>{Intl.NumberFormat().format(bestScore)}</strong></p>
    {/if}
    <button onclick={onClose}>Start New Game</button>
  </div>
</Modal>

<style>
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1em;
  }

  .heading,
  p {
    margin: 0;
  }
</style>
