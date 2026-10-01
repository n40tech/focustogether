export type NoiseColour = 'white' | 'pink' | 'brown';

/** A generator of successive noise samples, roughly in [-1, 1]. */
function generator(colour: NoiseColour): () => number {
  if (colour === 'white') return () => Math.random() * 2 - 1;

  if (colour === 'brown') {
    let last = 0;
    return () => {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      return last * 3.5;
    };
  }

  // Paul Kellet's pink noise filter.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return () => {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
    return pink;
  };
}

/**
 * `length` samples of noise that loop without a click: the tail is crossfaded
 * into the samples that came just before the head.
 */
export function loopingNoise(
  colour: NoiseColour,
  length: number,
  fade = 2048
): Float32Array<ArrayBuffer> {
  const next = generator(colour);
  const raw = new Float32Array(length + fade);
  for (let i = 0; i < raw.length; i++) raw[i] = next();

  const out = raw.slice(fade);
  for (let j = 0; j < fade; j++) {
    const t = j / fade;
    out[length - fade + j] = raw[length + j] * (1 - t) + raw[j] * t;
  }
  return out;
}
