export function isMp3(data: Uint8Array): boolean {
	let offset = 0;
	if (data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
		if (data.length < 10) return false;
		const tagSize =
			((data[6] & 0x7f) << 21) |
			((data[7] & 0x7f) << 14) |
			((data[8] & 0x7f) << 7) |
			(data[9] & 0x7f);
		offset = 10 + tagSize + ((data[5] & 0x10) !== 0 ? 10 : 0);
	}

	if (offset + 3 >= data.length || data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
		return false;
	}

	const version = (data[offset + 1] >> 3) & 0x03;
	const layer = (data[offset + 1] >> 1) & 0x03;
	const bitrateIndex = (data[offset + 2] >> 4) & 0x0f;
	const sampleRateIndex = (data[offset + 2] >> 2) & 0x03;
	if (version === 0x01 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 0x0f) return false;
	if (sampleRateIndex === 0x03) return false;

	return bitrateIndex < 0x0f;
}

export function asMp3Blob(data: Blob): Blob {
	return new Blob([data], { type: 'audio/mpeg' });
}
