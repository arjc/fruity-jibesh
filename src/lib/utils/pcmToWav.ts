export function pcmToWav(chunks: Float32Array[], sampleRate: number): Blob {
	const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
	const buffer = new ArrayBuffer(44 + sampleCount * 2);
	const view = new DataView(buffer);

	function writeString(offset: number, value: string): void {
		for (let index = 0; index < value.length; index++) {
			view.setUint8(offset + index, value.charCodeAt(index));
		}
	}

	writeString(0, 'RIFF');
	view.setUint32(4, 36 + sampleCount * 2, true);
	writeString(8, 'WAVE');
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	writeString(36, 'data');
	view.setUint32(40, sampleCount * 2, true);

	let offset = 44;
	for (const chunk of chunks) {
		for (const sample of chunk) {
			const clampedSample = Math.max(-1, Math.min(1, sample));
			view.setInt16(
				offset,
				clampedSample < 0 ? clampedSample * 0x8000 : clampedSample * 0x7fff,
				true
			);
			offset += 2;
		}
	}

	return new Blob([buffer], { type: 'audio/wav' });
}
