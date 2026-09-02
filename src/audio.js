const SOUND_KEY = "nurseSim.sound.v1";

export class GameAudio {
  constructor() {
    this.context = null;
    this.enabled = globalThis.localStorage?.getItem(SOUND_KEY) !== "off";
  }

  isEnabled() {
    return this.enabled;
  }

  toggle() {
    this.enabled = !this.enabled;
    globalThis.localStorage?.setItem(SOUND_KEY, this.enabled ? "on" : "off");
    if (this.enabled) this.play("on");
    return this.enabled;
  }

  ensureContext() {
    if (!this.enabled || typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!this.context) this.context = new AudioContextClass();
    if (this.context.state === "suspended") this.context.resume();
    return this.context;
  }

  tone(frequency, start, duration, volume = 0.055, type = "sine") {
    const context = this.ensureContext();
    if (!context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
    gain.gain.setValueAtTime(0.0001, context.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + start);
    oscillator.stop(context.currentTime + start + duration + 0.02);
  }

  noise(duration = 0.16, volume = 0.035, frequency = 1100) {
    const context = this.ensureContext();
    if (!context) return;
    const length = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) channel[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }

  play(name = "click") {
    if (!this.enabled) return;
    if (name === "paper") {
      this.noise(0.2, 0.04, 1250);
      this.tone(180, 0, 0.08, 0.018, "triangle");
    } else if (name === "phone") {
      this.tone(740, 0, 0.14, 0.05, "sine");
      this.tone(590, 0.17, 0.14, 0.045, "sine");
      this.tone(740, 0.34, 0.14, 0.05, "sine");
    } else if (name === "alert") {
      this.tone(190, 0, 0.14, 0.06, "sawtooth");
      this.tone(160, 0.17, 0.18, 0.055, "sawtooth");
    } else if (name === "result") {
      this.tone(420, 0, 0.1, 0.04, "sine");
      this.tone(560, 0.1, 0.14, 0.035, "sine");
    } else if (name === "dawn") {
      this.tone(330, 0, 0.16, 0.035, "sine");
      this.tone(440, 0.12, 0.18, 0.03, "sine");
    } else if (name === "keyboard") {
      this.noise(0.07, 0.022, 2200);
      this.tone(680, 0.03, 0.045, 0.018, "square");
    } else if (name === "drawer") {
      this.noise(0.12, 0.035, 500);
      this.tone(120, 0.09, 0.12, 0.03, "triangle");
    } else if (name === "drink") {
      this.tone(520, 0, 0.08, 0.025, "sine");
      this.tone(780, 0.08, 0.13, 0.03, "sine");
    } else if (name === "on") {
      this.tone(440, 0, 0.08, 0.035, "sine");
      this.tone(660, 0.08, 0.12, 0.03, "sine");
    } else {
      this.tone(360, 0, 0.055, 0.025, "sine");
    }
  }

  playEvent(event) {
    if (!event) return;
    const cue = event.sound || (event.type === "crisis" ? "alert" : "paper");
    this.play(cue);
  }
}
