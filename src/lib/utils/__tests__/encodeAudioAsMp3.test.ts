import { describe, expect, it } from 'vitest';
import { encodeAudioAsMp3, encodePcmAsMp3 } from '../encodeAudioAsMp3';
import { isMp3 } from '../mp3';
import { pcmToWav } from '../pcmToWav';

describe('encodeAudioAsMp3', () => {
	it('encodes decoded audio into MP3 frames', async () => {
		const sampleRate = 44_100;
		const samples = new Float32Array(sampleRate);
		for (let index = 0; index < samples.length; index++) {
			samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.25;
		}

		const mp3 = await encodeAudioAsMp3(pcmToWav([samples], sampleRate));
		const bytes = new Uint8Array(await mp3.arrayBuffer());

		expect(mp3.type).toBe('audio/mpeg');
		expect(bytes.length).toBeGreaterThan(0);
		expect(bytes[0]).toBe(0xff);
		expect(bytes[1] & 0xe0).toBe(0xe0);

		const audioContext = new AudioContext();
		try {
			const decodedMp3 = await audioContext.decodeAudioData(await mp3.arrayBuffer());
			expect(decodedMp3.duration).toBeCloseTo(1, 1);
		} finally {
			await audioContext.close();
		}
	});

	it('does not treat arbitrary audio data as MP3 based on an internal byte sequence', () => {
		expect(isMp3(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0xff, 0xfb, 0x90, 0x64]))).toBe(false);
	});

	it('accepts valid high-bitrate MP3 frames', () => {
		expect(isMp3(Uint8Array.from([0xff, 0xfb, 0xe0, 0x00]))).toBe(true);
	});

	it('encodes captured PCM directly to MP3', async () => {
		const sampleRate = 48_000;
		const samples = new Float32Array(sampleRate / 4);
		for (let index = 0; index < samples.length; index++) {
			samples[index] = Math.sin((2 * Math.PI * 330 * index) / sampleRate) * 0.2;
		}

		const mp3 = await encodePcmAsMp3([samples], sampleRate);
		expect(mp3.type).toBe('audio/mpeg');
		expect(isMp3(new Uint8Array(await mp3.arrayBuffer()))).toBe(true);
	});
});
