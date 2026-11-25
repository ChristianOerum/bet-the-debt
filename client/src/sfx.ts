// Sound made from scratch in the browser: no audio files to ship.

let ctx: AudioContext | null = null;

/** An empty chamber: a small metallic click. */
export function dryClick() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.03);
    g.gain.setValueAtTime(0.25, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  } catch {
    /* no sound */
  }
}

/** A punch landing: a short, dull smack. `volume` 0..1. */
export function thump(volume = 1) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.09);
    g.gain.setValueAtTime(0.5 * volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    /* no sound */
  }
}

/** A gunshot: a crack of noise over a low thump. `volume` 0..1. */
export function gunshot(volume = 1) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55 * volume;
    out.connect(ctx.destination);

    // the crack
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5200, now);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.4);
    noise.connect(filter).connect(out);
    noise.start(now);

    // the thump
    const osc = ctx.createOscillator();
    const thump = ctx.createGain();
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.22);
    thump.gain.setValueAtTime(1.1, now);
    thump.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(thump).connect(out);
    osc.start(now);
    osc.stop(now + 0.32);
  } catch {
    /* no sound available: the flash and the fall still tell the story */
  }
}

/** A suppressed shot: a short, breathy "pfft" and the click of the slide. olume 0..1. */
export function silencedShot(volume = 1) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.12);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.5 * volume;
    noise.connect(filter).connect(g).connect(ctx.destination);
    noise.start(now);
  } catch {
    /* no sound */
  }
  setTimeout(() => volume > 0.3 && dryClick(), 70);
}