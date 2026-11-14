/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRUITS, GAMEPLAY_TUNING } from '../../constants';
import { Fruit } from '../../game/Fruit';
import { getFruitDisplayName } from '../fruitCustomizations.svelte';
import { GameState } from '../game.svelte.js';

// Stub physics related methods before constructing GameState
const proto: any = GameState.prototype;
// Capture the real update() before it is stubbed, so a focused test can exercise it.
const realUpdate: () => void = proto.update;
vi.spyOn(proto, 'initPhysics').mockImplementation(async function (this: any) {
	this.physicsWorld = {
		integrationParameters: { dt: 1 / 60 },
		removeRigidBody: vi.fn(),
		step: vi.fn()
	};
	this.eventQueue = { drainCollisionEvents: vi.fn() };
});
vi.spyOn(proto, 'update').mockImplementation(function (this: any) {
	if (this.status !== 'playing') {
		if (this.animationFrameId) {
			clearTimeout(this.animationFrameId);
			this.animationFrameId = null;
		}
		return;
	}
	this.stepPhysics();
	this.throttledCheckGameOver?.();
});
vi.spyOn(proto, 'addFruit').mockImplementation(function (
	this: any,
	fruitIndex: number,
	x: number,
	y: number
) {
	const fruit = {
		fruitIndex,
		radius: FRUITS[fruitIndex].radius,
		points: FRUITS[fruitIndex].points,
		body: {
			handle: (this._handle = (this._handle ?? 0) + 1),
			isValid: () => true,
			translation: () => ({ x, y }),
			rotation: () => 0,
			linvel: () => ({ x: 0, y: 0 })
		},
		collider: { handle: this._handle || 0 },
		destroy: vi.fn(),
		isOutOfBounds: vi.fn().mockReturnValue(false),
		physicsWorld: this.physicsWorld
	};
	this.fruits.push(fruit);
	this.colliderMap.set(fruit.body.handle, fruit);
	return fruit;
});

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('GameState Methods', () => {
	it('plays only one fruit-specific pop when several merges happen in one physics step', () => {
		const state = new GameState({});
		const audioManager = { playSound: vi.fn() };
		state.audioManager = audioManager as any;

		const makeFruit = (handle: number, fruitIndex: number) =>
			Object.assign(Object.create(Fruit.prototype), {
				fruitIndex,
				body: {
					handle,
					isValid: () => true,
					linvel: () => ({ x: 0, y: 0 })
				}
			}) as Fruit;

		const fruits = [makeFruit(1, 0), makeFruit(2, 0), makeFruit(3, 1), makeFruit(4, 1)];
		fruits.forEach((fruit) => {
			state.colliderMap.set(fruit.body.handle, fruit);
		});
		state.mergeFruits = vi.fn();
		state.eventQueue = {
			drainCollisionEvents: (callback) => {
				callback(1, 2, true);
				callback(3, 4, true);
			}
		} as any;

		state.checkCollisions();

		expect(audioManager.playSound).toHaveBeenCalledTimes(1);
		expect(audioManager.playSound).toHaveBeenCalledWith('pop', { volume: 1, rate: 1.2599 });
		expect(state.mergeFruits).toHaveBeenCalledTimes(2);
	});

	it('merges two fruits of the same type', () => {
		vi.useFakeTimers();
		const state = new GameState({});
		state.physicsWorld = {} as any; // mock physicsWorld
		// add two fruits of type 0
		const a = state.addFruit(0, 0.2, 0.2);
		const b = state.addFruit(0, 0.25, 0.2);
		const initialCount = state.fruits.length;
		state.mergeFruits(a!, b!);
		expect(state.fruits.length).toBe(initialCount - 1);
		expect(state.fruits[0].fruitIndex).toBe(1);
		expect(state.score).toBe(FRUITS[1].points);
		expect(state.mergeNotices[0].message).toBe(`${getFruitDisplayName(FRUITS[1].name)} found!`);
	});

	it('merges two watermelons (final fruit) and awards the watermelon bonus', () => {
		vi.useFakeTimers();
		const state = new GameState({});
		state.physicsWorld = {} as any;
		const maxIndex = FRUITS.length - 1;
		const a = state.addFruit(maxIndex, 0.2, 0.2);
		const b = state.addFruit(maxIndex, 0.25, 0.2);
		const initialCount = state.fruits.length;
		state.mergeFruits(a!, b!);
		expect(state.fruits.length).toBe(initialCount - 2);
		expect(state.score).toBe(100);
		expect(state.mergeNotices[0].message).toBe(
			`${getFruitDisplayName(FRUITS[maxIndex].name)} found!`
		);
	});

	it('removes merge announcements after three seconds', () => {
		vi.useFakeTimers();
		const state = new GameState({});
		state.physicsWorld = {} as any;
		const a = state.addFruit(0, 0.2, 0.2);
		const b = state.addFruit(0, 0.25, 0.2);

		state.mergeFruits(a!, b!);
		expect(state.mergeNotices).toHaveLength(1);

		vi.advanceTimersByTime(2999);
		expect(state.mergeNotices).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(state.mergeNotices).toHaveLength(0);
	});

	it('drops a fruit correctly', () => {
		const state = new GameState({});
		state.physicsWorld = {} as any;
		state.setStatus('playing');
		state.nextFruitIndex = 2;

		state.dropFruit(1, 100, 100);

		expect(state.fruits.length).toBe(1);
		expect(state.fruits[0].fruitIndex).toBe(1);
		expect(state.dropCount).toBe(1);
		expect(state.currentFruitIndex).toBe(2);
	});

	it('alternates strong impulses and spin across active fruits when shaken', () => {
		vi.useFakeTimers();
		const state = new GameState({});
		state.physicsWorld = {} as any;
		state.status = 'playing';

		const appliedImpulses: { x: number; y: number }[] = [];
		const body = {
			isValid: vi.fn().mockReturnValue(true),
			applyImpulse: vi.fn((impulse: { x: number; y: number }) => appliedImpulses.push(impulse)),
			applyTorqueImpulse: vi.fn()
		};
		state.fruits = [{ body } as any];

		state.shakeContainer();
		vi.advanceTimersByTime(GAMEPLAY_TUNING.shake.pulseIntervalMs - 1);
		expect(body.applyImpulse).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		expect(body.applyImpulse).toHaveBeenCalledTimes(2);
		vi.runAllTimers();

		const expectedImpulses = GAMEPLAY_TUNING.shake.impulses.map((impulse) =>
			Number((impulse + GAMEPLAY_TUNING.shake.horizontalVariation).toFixed(2))
		);
		expect(appliedImpulses.map(({ x }) => Number(x.toFixed(2)))).toEqual(expectedImpulses);
		expect(body.applyTorqueImpulse).toHaveBeenCalledTimes(GAMEPLAY_TUNING.shake.impulses.length);
	});

	it('handles checkGameOver', () => {
		const state = new GameState({});
		state.physicsWorld = {} as any;
		state.setStatus('playing');

		const fruit: any = state.addFruit(0, 0, 0);
		fruit.isOutOfBounds.mockReturnValue(true);

		state.checkGameOver();
		expect(state.status).toBe('gameover');
	});

	it('records the culprit fruit id in gameOverFruitId when game ends', () => {
		const state = new GameState({});
		state.physicsWorld = {} as any;
		state.setStatus('playing');

		const fruit: any = state.addFruit(0, 0, 0);
		fruit.id = 42;
		fruit.isOutOfBounds.mockReturnValue(true);

		state.checkGameOver();
		expect(state.gameOverFruitId).toBe(42);
	});

	it('does not set gameOverFruitId when no fruit is out of bounds', () => {
		const state = new GameState({});
		state.physicsWorld = {} as any;
		state.setStatus('playing');

		state.addFruit(0, 0.1, 0.1);

		state.checkGameOver();
		expect(state.gameOverFruitId).toBeNull();
		expect(state.status).toBe('playing');
	});

	it('resets game state correctly', () => {
		const state = new GameState({});
		state.physicsWorld = {} as any;
		state.fruits = [{ destroy: vi.fn(), collider: { handle: 1 } }] as any;
		state.score = 100;
		state.dropCount = 5;

		state.resetGame();

		expect(state.fruits.length).toBe(0);
		expect(state.score).toBe(0);
		expect(state.dropCount).toBe(0);
		expect(state.status).toBe('uninitialized');
	});

	it('clears gameOverFruitId on resetGame', () => {
		const state = new GameState({});
		state.physicsWorld = {} as any;
		(state as any).gameOverFruitId = 42;
		state.fruits = [{ destroy: vi.fn(), collider: { handle: 1 } }] as any;

		state.resetGame();

		expect(state.gameOverFruitId).toBeNull();
	});

	it('restarts game correctly', () => {
		const state = new GameState({});
		state.resetGame = vi.fn();
		state.setStatus = vi.fn() as any;

		state.restartGame();

		expect(state.resetGame).toHaveBeenCalled();
		expect(state.setStatus).toHaveBeenCalledWith('playing');
	});

	it('setStatus handles animation frame cancellation', () => {
		const state = new GameState({});
		state.animationFrameId = 123 as any;
		state.setStatus('paused');
		expect(state.animationFrameId).toBeNull();
	});

	it('records previous fruit positions before each physics step', () => {
		const state = new GameState({});
		state.physicsWorld = { integrationParameters: { dt: 1 / 60 }, step: vi.fn() } as any;
		state.eventQueue = { drainCollisionEvents: vi.fn() } as any;

		const fruit: any = state.addFruit(0, 0.3, 0.4);

		// Prime the accumulator so exactly one physics step runs.
		state.lastTime = performance.now();
		state.physicsAccumulator = (1 / 60) * 1000;

		state.stepPhysics();

		expect(fruit.prevX).toBe(0.3);
		expect(fruit.prevY).toBe(0.4);
		expect(fruit.prevRotation).toBe(0);
	});

	it('invokes onUpdate once per frame while playing', () => {
		// Stop the frame from rescheduling so the real update() runs a single tick.
		const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(0 as any);
		const state = new GameState({});
		state.physicsWorld = { integrationParameters: { dt: 1 / 60 }, step: vi.fn() } as any;
		state.eventQueue = { drainCollisionEvents: vi.fn() } as any;
		state.status = 'playing';

		const onUpdate = vi.fn();
		state.onUpdate = onUpdate;

		realUpdate.call(state);

		expect(onUpdate).toHaveBeenCalledTimes(1);
		raf.mockRestore();
	});
});
