import VAD from 'node-vad';
import { Readable } from 'stream';

export interface VADConfig {
    sampleRate: number;
    silenceThresholdMs: number;
    speechMinDurationMs: number;
    /** Порог громкости (RMS) от 0 до 32767. Всё, что ниже — считаем абсолютной тишиной. */
    minEnergyThreshold: number;
}

export class VADService {
    private vad: InstanceType<typeof VAD>;
    private config: VADConfig;

    constructor(config: Partial<VADConfig> = {}) {
        this.config = {
            sampleRate: config.sampleRate || 16000,
            silenceThresholdMs: config.silenceThresholdMs || 1500, // Ждать 1.5 секунды тишины перед тем, как отрезать фразу, для долгих пауз между словами - увеличить (стандарт 1200–2000 мс)
            speechMinDurationMs: config.speechMinDurationMs || 400, // Игнорировать любые шумы короче 0.4 сек
            // Порог среднеквадратичной амплитуды (RMS) для 16-bit PCM.
            // 300-500 — отличное значение для отсечения шума кулеров и комнаты.
            minEnergyThreshold: config.minEnergyThreshold ?? 400,
        };

        this.vad = new VAD(VAD.Mode.VERY_AGGRESSIVE);
    }

    /**
     * Вычисляет среднеквадратичную громкость (RMS) 16-bit PCM фрейма.
     */
    private calculateRMS(frame: Buffer): number {
        let sum = 0;
        const sampleCount = frame.length / 2;

        for (let i = 0; i < frame.length; i += 2) {
            // Считываем 16-битный знаковый integer (от -32768 до 32767)
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

            const onData = async (chunk: Buffer) => {
                bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);

                while (bufferAccumulator.length >= FRAME_SIZE) {
                    const frame = bufferAccumulator.subarray(0, FRAME_SIZE);
                    bufferAccumulator = bufferAccumulator.subarray(FRAME_SIZE);

                    try {
                        const rms = this.calculateRMS(frame);
                        let isVoice = false;

                        // Если громкость выше порога шума — проверяем через нейро/WebRTC VAD
                        if (rms >= this.config.minEnergyThreshold) {
                            const event = await this.vad.processAudio(frame, this.config.sampleRate);
                            isVoice = (event === VAD.Event.VOICE);
                        }

                        const now = Date.now();

                        if (isVoice) {
                            if (!isSpeaking) {
                                console.log(`🎤 [VAD] Обнаружена речь! (RMS: ${Math.round(rms)})`);
                                isSpeaking = true;
                                speechStartMs = now;
                            }
                            silenceStartMs = null;
                            audioChunks.push(frame);
                        } else {
                            // SILENCE или шум ниже порога RMS
                            if (isSpeaking) {
                                audioChunks.push(frame);

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
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error('[VAD Error]:', err);
                    }
                }
            };

            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                micStream.removeListener('data', onData);
                micStream.removeListener('error', onError);
            };

            micStream.on('data', onData);
            micStream.on('error', onError);
        });
    }
}