class AudioEngine {
    private ctx: AudioContext | null = null

    private init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        }
    }

    private playTone(freq: number, type: OscillatorType, duration: number, volume: number = 0.2) {
        this.init()
        if (!this.ctx) return

        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()

        osc.type = type
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
        
        gain.gain.setValueAtTime(volume, this.ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration)

        osc.connect(gain)
        gain.connect(this.ctx.destination)

        osc.start()
        osc.stop(this.ctx.currentTime + duration)
    }

    playConnect() {
        this.playTone(440, 'sine', 0.1, 0.15)
        setTimeout(() => this.playTone(880, 'sine', 0.1, 0.15), 50)
    }

    playDisconnect() {
        this.playTone(220, 'sine', 0.1, 0.15)
    }

    playWin() {
        const notes = [523.25, 659.25, 783.99, 1046.50] // C-E-G-C
        notes.forEach((note, i) => {
            setTimeout(() => this.playTone(note, 'square', 0.4, 0.1), i * 150)
        })
    }
}

export const audio = new AudioEngine()
