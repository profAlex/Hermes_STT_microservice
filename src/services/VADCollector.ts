import { Writable } from 'stream';
import { VADService } from './vad.service.js';

export class VADCollector extends Writable {
    private isSpeaking = false;
    private silenceDurationMs = 0;
    private speechDurationMs = 0;
    private audioChunks: Buffer[] = [];

    constructor(
        private vadService: VADService,
        private onSpeechEnd: (segment: Buffer[]) => void
    ) {
        super({ objectMode: false });
    }

    async _write(frame: Buffer, encoding: string, next: (error?: Error | null) => void): Promise<void> {
        try {
            // Исправлено: вызываем гибридный метод (RMS + VAD)
            const isVoice = await this.vadService.isVoiceFrame(frame);
            const FRAME_MS = 30;

            if (isVoice) {
                if (!this.isSpeaking) {
                    this.isSpeaking = true;
                    this.speechDurationMs = 0;
                }
                this.silenceDurationMs = 0;
                this.speechDurationMs += FRAME_MS;
                this.audioChunks.push(frame);
            } else {
                if (this.isSpeaking) {
                    this.audioChunks.push(frame);
                    this.speechDurationMs += FRAME_MS;
                    this.silenceDurationMs += FRAME_MS;

                    if (this.silenceDurationMs >= this.vadService.config.silenceThresholdMs) {
                        if (this.speechDurationMs >= this.vadService.config.speechMinDurationMs) {
                            // Передаем копию массива чанков
                            this.onSpeechEnd([...this.audioChunks]);
                        }
                        this.reset();
                    }
                }
            }

            next();
        } catch (err) {
            next(err as Error);
        }
    }

    private reset(): void {
        this.isSpeaking = false;
        this.silenceDurationMs = 0;
        this.speechDurationMs = 0;
        this.audioChunks = [];
    }
}