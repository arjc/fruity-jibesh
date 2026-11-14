import encodeMp3 from '@audio/encode-mp3';
import { asMp3Blob, isMp3 } from './mp3';

export async function encodePcmAsMp3(
	channelData: Float32Array[],
	sampleRate: number
): Promise<Blob> {
	const channels = Math.min(channelData.length, 2);
	if (channels === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
		throw new Error('The audio recording contains no usable samples.');
	}

	const frameCount = Math.min(...channelData.slice(0, channels).map((channel) => channel.length));
	if (frameCount === 0) {
		throw new Error('The audio recording is empty.');
	}

	const encoder = await encodeMp3({ sampleRate, channels, bitrate: 128 });
	try {
		const encodedChunks: Uint8Array[] = [];
		const chunkSize = 8192;
		for (let offset = 0; offset < frameCount; offset += chunkSize) {
			encodedChunks.push(
				encoder.encode(
					channelData
						.slice(0, channels)
						.map((channel) => channel.subarray(offset, Math.min(offset + chunkSize, frameCount)))
				)
			);
		}
		encodedChunks.push(encoder.flush());

		const totalSize = encodedChunks.reduce((total, chunk) => total + chunk.length, 0);
		const mp3Data = new Uint8Array(totalSize);
		let offset = 0;
		for (const chunk of encodedChunks) {
			mp3Data.set(chunk, offset);
			offset += chunk.length;
		}

		const header = encoder.head?.();
		if (header && header.length > 0) {
			if (header.length > mp3Data.length) {
				throw new Error('The MP3 encoder returned an invalid header.');
			}
			mp3Data.set(header);
		}
		if (!isMp3(mp3Data)) {
			throw new Error('The audio is too short to encode as MP3.');
		}

		return new Blob([mp3Data], { type: 'audio/mpeg' });
	} finally {
		encoder.free();
	}
}

export async function encodeAudioAsMp3(source: Blob): Promise<Blob> {
	const sourceBytes = new Uint8Array(await source.slice(0, 64 * 1024).arrayBuffer());
	if (isMp3(sourceBytes)) {
		return asMp3Blob(source);
	}

	const AudioContextConstructor = window.AudioContext;
	if (!AudioContextConstructor) {
		throw new Error('Audio conversion is not supported by this browser.');
	}

	const audioContext = new AudioContextConstructor();

	try {
		const decodedAudio = await audioContext.decodeAudioData(await source.arrayBuffer());
		const channels = Math.min(decodedAudio.numberOfChannels, 2);
		return await encodePcmAsMp3(
			Array.from({ length: channels }, (_, index) => decodedAudio.getChannelData(index)),
			decodedAudio.sampleRate
		);
	} finally {
		await audioContext.close();
	}
}
