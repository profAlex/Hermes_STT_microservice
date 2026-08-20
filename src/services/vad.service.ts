import VAD from 'node-vad';
import { Readable } from 'stream';

export interface VADConfig {
    sampleRate: number;
    silenceThresholdMs: number;
    speechMinDurationMs: number;
    maxSpeechDurationMs: number;
    minEnergyThreshold: number;
}

export class VADService {
    private vad: InstanceType<typeof VAD>;
    private config: VADConfig;

    constructor(config: Partial<VADConfig> = {}) {
        this.config = {
            sampleRate: config.sampleRate || 16000,
            silenceThresholdMs: config.silenceThresholdMs || 1200,
            speechMinDurationMs: config.speechMinDurationMs || 400,
            maxSpeechDurationMs: config.maxSpeechDurationMs || 15000,
            minEnergyThreshold: config.minEnergyThreshold ?? 900,
        };

        this.vad = new VAD(VAD.Mode.AGGRESSIVE);
    }

    private calculateRMS(frame: Buffer): number {
        let sum = 0;
        const sampleCount = frame.length / 2;

        for (let i = 0; i < frame.length; i += 2) {
            const sample = frame.readInt16LE(i);
            sum += sample * sample;
        }

        return Math.sqrt(sum / sampleCount);
    }

    public captureSpeechSegment(micStream: Readable): Promise<Buffer[]> {
        return new Promise((resolve, reject) => {
            const audioChunks: Buffer[] = [];
            let isSpeaking = false;
            let silenceStartMs: number | null = null;
            let speechStartMs: number | null = null;

            const FRAME_SIZE = 960; // 30ms при 16kHz 16-bit Mono
            let bufferAccumulator = Buffer.alloc(0);

            // Очередь фреймов для строго последовательной обработки
            const frameQueue: Buffer[] = [];
            let isProcessingQueue = false;

            const processQueue = async () => {
                if (isProcessingQueue) return;
                isProcessingQueue = true;

                while (frameQueue.length > 0) {
                    const frame = frameQueue.shift()!;

                    try {
                        const rms = this.calculateRMS(frame);
                        let isVoice = false;

                        if (rms >= this.config.minEnergyThreshold) {
                            // Вызываем оригинальный асинхронный метод
                            const event = await this.vad.processAudio(frame, this.config.sampleRate);
                            isVoice = (event === VAD.Event.VOICE);
                        }

                        const now = Date.now();

                        if (isVoice) {
                            if (!isSpeaking) {
                                console.log(`🎤 [VAD] Речь обнаружена (RMS: ${Math.round(rms)})`);
                                isSpeaking = true;
                                speechStartMs = now;
                            }
                            silenceStartMs = null;
                            audioChunks.push(frame);

                            if (speechStartMs && (now - speechStartMs >= this.config.maxSpeechDurationMs)) {
                                console.log(`⏱️ [VAD] Таймаут фразы (${this.config.maxSpeechDurationMs / 1000}с). Отправка.`);
                                cleanup();
                                resolve(audioChunks);
                                return;
                            }
                        } else {
                            if (isSpeaking) {
                                audioChunks.push(frame);

                                if (speechStartMs && (now - speechStartMs >= this.config.maxSpeechDurationMs)) {
                                    console.log(`⏱️ [VAD] Таймаут фразы (${this.config.maxSpeechDurationMs / 1000}с). Отправка.`);
                                    cleanup();
                                    resolve(audioChunks);
                                    return;
                                }

                                if (!silenceStartMs) {
                                    silenceStartMs = now;
                                } else if (now - silenceStartMs >= this.config.silenceThresholdMs) {
                                    const speechDuration = now - (speechStartMs || now);

                                    if (speechDuration >= this.config.speechMinDurationMs) {
                                        console.log(`⏹️ [VAD] Речь завершена (тишина ${this.config.silenceThresholdMs} мс).`);
                                        cleanup();
                                        resolve(audioChunks);
                                        return;
                                    } else {
                                        console.log('⚠️ [VAD] Короткий всплеск отсеян.');
                                        isSpeaking = false;
                                        audioChunks.length = 0;
                                        silenceStartMs = null;
                                        speechStartMs = null;
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[VAD Error]:', err);
                    }
                }

                isProcessingQueue = false;
            };

            const onData = (chunk: Buffer) => {
                bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);

                while (bufferAccumulator.length >= FRAME_SIZE) {
                    const frame = bufferAccumulator.subarray(0, FRAME_SIZE);
                    bufferAccumulator = bufferAccumulator.subarray(FRAME_SIZE);

                    // Кладем фрейм в очередь и запускаем обработчик
                    frameQueue.push(frame);
                }

                processQueue();
            };

            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                micStream.removeListener('data', onData);
                micStream.removeListener('error', onError);
                frameQueue.length = 0;
            };

            micStream.on('data', onData);
            micStream.on('error', onError);
        });
    }
}