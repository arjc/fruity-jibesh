<script lang="ts">
import { GAME_WIDTH, GAME_WIDTH_PX } from '../constants';
import Apple from '../images/fruits/apple.png?url';
import Blueberry from '../images/fruits/blueberry.png?url';
import Dragonfruit from '../images/fruits/dragonfruit.png?url';
import Grape from '../images/fruits/grape.png?url';
import Honeydew from '../images/fruits/honeydew.png?url';
import Lemon from '../images/fruits/lemon.png?url';
import Orange from '../images/fruits/orange.png?url';
import Peach from '../images/fruits/peach.png?url';
import Pear from '../images/fruits/pear.png?url';
import Pineapple from '../images/fruits/pineapple.png?url';
import Watermelon from '../images/fruits/watermelon.png?url';
import { getFruitDisplayName } from '../stores/fruitCustomizations.svelte';
import { fruitImageOverrides } from '../stores/fruitImageOverrides.svelte';

const fruitImages: Record<string, string> = {
	Blueberry,
	Grape,
	Lemon,
	Orange,
	Apple,
	Dragonfruit,
	Pear,
	Peach,
	Pineapple,
	Honeydew,
	Watermelon
};

interface FruitProps {
	radius: number | string;
	name: string;
	display?: 'block' | 'inline';
	scale?: number;
	danger?: boolean;
}

let { radius, name, display = 'block', scale = 1, danger = false }: FruitProps = $props();

const width = $derived.by(() => {
	const scaledGameWidthPx = GAME_WIDTH_PX * scale;

	return Number.isFinite(radius)
		? `${(((radius as number) * 2) / GAME_WIDTH) * scaledGameWidthPx}px`
		: radius;
});
const FruitComponent = $derived.by(() => {
	const fruitKey = `${name.at(0).toUpperCase()}${name.slice(1)}`;
	if (!fruitKey) return '';
	return fruitImageOverrides[name] ?? fruitImages[fruitKey] ?? '';
});
const displayName = $derived(getFruitDisplayName(name));
</script>

<div
  data-name={name}
  class="fruit"
  class:danger
  style:width
  style:display={display === "inline" ? "inline-block" : display}
>
  {#if FruitComponent}
    <img src={FruitComponent} alt={displayName} style="display: block; width: 100%; height: 100%;" />
  {/if}
</div>

<style>
  .fruit {
    aspect-ratio: 1 / 1;
    user-select: none;
    outline: 3px solid transparent;
    outline-offset: 10px;
    transition: outline-color 150ms ease-in;
  }

  .fruit.danger {
    outline: 3px solid hotpink;
  }
</style>