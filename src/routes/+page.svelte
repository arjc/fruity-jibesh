<script lang="ts">
import { browser } from '$app/environment';
import Game from '../lib/components/Game.svelte';

if (browser) {
	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
	}
}
</script>

<main>
  <Game />
</main>

<style>
  :global(html) {
    font-family: Inter, system-ui, sans-serif;
    font-optical-sizing: auto;
    font-style: normal;
    font-weight: 400;
  }

  :global(body, html) {
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: linear-gradient(180deg, rgba(59, 28, 110, 1) 0%, rgba(252, 148, 175, 1) 55%, rgba(237, 221, 83, 1) 100%);
  }

  main {
    min-height: 100svh;
    min-width: 100svw;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
