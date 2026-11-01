export class SynthAudio {
  private context: AudioContext | null = null;
  private muted = true;
  private volume = 0.25;

  setMuted(value: boolean): void {
    this.muted = value;
    if (this.muted) void this.context?.suspend();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
  }

  unlock(): void {
    if (this.muted) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  tone(frequency: number, durationMs = 90, type: OscillatorType = "triangle"): void {
    if (this.muted || !this.context) return;
    const context = this.context;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(Math.max(0.0001, this.volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + durationMs / 1000);
  }

  success(): void {
    this.tone(440, 100, "sine");
    window.setTimeout(() => this.tone(660, 160, "sine"), 70);
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    if (context) void context.close();
  }
}
