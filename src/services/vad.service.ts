import VAD from 'node-vad';
import { Readable } from 'stream';
import { AudioFrameSplitter } from './audio-frame-splitter.js';

export interface VADConfig {
    sampleRate: number;
    speechMinDurationMs: number;
    minEnergyThreshold: number;
}

export class VADService {
    private vad: InstanceType<typeof VAD>;
    public config: VADConfig;

    constructor(config: Partial<VADConfig> = {}) {
        this.config = {
            sampleRate: config.sampleRate || 16000,
            speechMinDurationMs: config.speechMinDurationMs || 400,
            minEnergyThreshold: config.minEnergyThreshold ?? 2000,
        };

        this.vad = new VAD(VAD.Mode.AGGRESSIVE);
    }

    public calculateRMS(frame: Buffer): number {
        let sum = 0;
        const sampleCount = frame.length / 2;

        for (let i = 0; i < frame.length; i += 2) {
            const sample = frame.readInt16LE(i);
            sum += sample * sample;
        }

        return Math.sqrt(sum / sampleCount);
    }

    /**
     * Комплексная проверка кадра: сначала RMS, затем libwebrtc VAD
     */
    public async isVoiceFrame(frame: Buffer): Promise<boolean> {
        const rms = this.calculateRMS(frame);
        if (rms < this.config.minEnergyThreshold) {
            return false;
        }

        try {
            const res = await this.vad.processAudio(frame, this.config.sampleRate);
            return res === VAD.Event.VOICE;
        } catch {
            return false;
        }
    }

    /**
     * Накапливает ТОЛЬКО голосовые кадры за все время работы micStream (до события 'end')
     */
    public captureSpeechSegment(micStream: Readable): Promise<Buffer[]> {
        return new Promise((resolve, reject) => {
            const FRAME_SIZE = 960; // 30 мс при 16kHz
            const splitter = new AudioFrameSplitter(FRAME_SIZE);

            const speechChunks: Buffer[] = [];
            let currentSpeechSequence: Buffer[] = [];

            const FRAME_DURATION_MS = 30;
            let currentSpeechDurationMs = 0;

            const onFrameData = async (frame: Buffer) => {
                const isVoice = await this.isVoiceFrame(frame);

                if (isVoice) {
                    currentSpeechSequence.push(frame);
                    currentSpeechDurationMs += FRAME_DURATION_MS;
                } else {
                    // Встретили фрейм тишины/шума: подводим итог текущей речевой последовательности
                    if (currentSpeechSequence.length > 0) {
                        // Сохраняем сегмент только если он длиннее порога отсечения шумов (400 мс)
                        if (currentSpeechDurationMs >= this.config.speechMinDurationMs) {
                            speechChunks.push(...currentSpeechSequence);
                        }
                        currentSpeechSequence = [];
                        currentSpeechDurationMs = 0;
                    }
                }
            };

            const onEnd = () => {
                // Забираем остаток речевого сегмента, если он закончился ровно в момент отжатия клавиши
                if (
                    currentSpeechSequence.length > 0 &&
                    currentSpeechDurationMs >= this.config.speechMinDurationMs
                ) {
                    speechChunks.push(...currentSpeechSequence);
                }

                cleanup();
                resolve(speechChunks);
            };

            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };

            const cleanup = () => {
                micStream.removeListener('error', onError);
                splitter.removeListener('data', onFrameData);
                splitter.removeListener('end', onEnd);
                splitter.removeListener('error', onError);

                micStream.unpipe(splitter);
                splitter.destroy();
            };

            micStream.on('error', onError);
            splitter.on('data', onFrameData);
            splitter.on('end', onEnd);
            splitter.on('error', onError);

            micStream.pipe(splitter);
        });
    }
}




// // РЕАЛИЗАЦИЯ ЧЕРЕЗ Writable Transform ПОТОКИ
// import VAD from 'node-vad';
// import { Readable } from 'stream';
// import { AudioFrameSplitter } from './AudioFrameSplitter.js';
// import { VADCollector } from './VADCollector.js';
//
// export interface VADConfig {
//     sampleRate: number;
//     silenceThresholdMs: number;
//     speechMinDurationMs: number;
//     minEnergyThreshold: number;
// }
//
// export class VADService {
//     private vad: InstanceType<typeof VAD>;
//     public config: VADConfig;
//
//     constructor(config: Partial<VADConfig> = {}) {
//         this.config = {
//             sampleRate: config.sampleRate || 16000,
//             silenceThresholdMs: config.silenceThresholdMs || 1200,
//             speechMinDurationMs: config.speechMinDurationMs || 400,
//             minEnergyThreshold: config.minEnergyThreshold ?? 2000,
//         };
//
//         this.vad = new VAD(VAD.Mode.AGGRESSIVE);
//     }
//
//     public calculateRMS(frame: Buffer): number {
//         let sum = 0;
//         const sampleCount = frame.length / 2;
//
//         for (let i = 0; i < frame.length; i += 2) {
//             const sample = frame.readInt16LE(i);
//             sum += sample * sample;
//         }
//
//         return Math.sqrt(sum / sampleCount);
//     }
//
//     /**
//      * Комплексная проверка кадра: сначала RMS, затем libwebrtc VAD
//      */
//     public async isVoiceFrame(frame: Buffer): Promise<boolean> {
//         const rms = this.calculateRMS(frame);
//         if (rms < this.config.minEnergyThreshold) {
//             return false;
//         }
//
//         try {
//             const res = await this.vad.processAudio(frame, this.config.sampleRate);
//             return res === VAD.Event.VOICE;
//         } catch {
//             return false;
//         }
//     }
//
//     public captureSpeechSegment(micStream: Readable): Promise<Buffer[]> {
//         return new Promise((resolve, reject) => {
//             const splitter = new AudioFrameSplitter(960);
//
//             const collector = new VADCollector(this, (speechBuffers) => {
//                 cleanup();
//                 resolve(speechBuffers);
//             });
//
//             const onError = (err: Error) => {
//                 cleanup();
//                 reject(err);
//             };
//
//             const cleanup = () => {
//                 micStream.removeListener('error', onError);
//                 // Отсоединяем пайпы и уничтожаем временные Transform/Writable стримы,
//                 // чтобы не было утечек памяти
//                 micStream.unpipe(splitter);
//                 splitter.unpipe(collector);
//                 splitter.destroy();
//                 collector.destroy();
//             };
//
//             micStream.on('error', onError);
//
//             // ВАЖНО: pipe(collector, { end: false }) гарантирует,
//             // что закрытие collector не закроет сам micStream (PassThrough)!
//             micStream.pipe(splitter).pipe(collector);
//         });
//     }
// }




// // ВЕРСИЯ С КАСТОМНОЙ РЕАЛИЗАЦИЕЙ КОНТРОЛЯ ОЧЕРЕДИ

// import VAD from 'node-vad';
// import { Readable } from 'stream';
//
// export interface VADConfig {
//     sampleRate: number;
//     silenceThresholdMs: number;
//     speechMinDurationMs: number;
//     minEnergyThreshold: number;
// }
//
// export class VADService {
//     private vad: InstanceType<typeof VAD>;
//     private config: VADConfig;
//
//     constructor(config: Partial<VADConfig> = {}) {
//         this.config = {
//             sampleRate: config.sampleRate || 16000,
//             silenceThresholdMs: config.silenceThresholdMs || 1500, // 1.2 сек — идеальный баланс для длинной речи
//             speechMinDurationMs: config.speechMinDurationMs || 500,  // Отсекаем покашливания
//             minEnergyThreshold: config.minEnergyThreshold ?? 2000,
//         };
//
//         this.vad = new VAD(VAD.Mode.AGGRESSIVE);
//     }
//
//     private calculateRMS(frame: Buffer): number {
//         let sum = 0;
//         const sampleCount = frame.length / 2;
//
//         for (let i = 0; i < frame.length; i += 2) {
//             const sample = frame.readInt16LE(i);
//             sum += sample * sample;
//         }
//
//         return Math.sqrt(sum / sampleCount);
//     }
//
//     public captureSpeechSegment(micStream: Readable): Promise<Buffer[]> {
//         return new Promise((resolve, reject) => {
//             const audioChunks: Buffer[] = [];
//             let isSpeaking = false;
//
//             let speechDurationMs = 0;
//             let silenceDurationMs = 0;
//
//             const FRAME_SIZE = 960; // 30 мс при 16kHz 16-bit Mono
//             const FRAME_DURATION_MS = 30;
//
//             let bufferAccumulator = Buffer.alloc(0);
//             const frameQueue: Buffer[] = [];
//             let isProcessingQueue = false;
//
//             const processQueue = async () => {
//                 if (isProcessingQueue) return;
//                 isProcessingQueue = true;
//
//                 while (frameQueue.length > 0) {
//                     const frame = frameQueue.shift()!;
//
//                     try {
//                         const rms = this.calculateRMS(frame);
//                         let isVoice = false;
//
//                         if (rms >= this.config.minEnergyThreshold) {
//                             const event = await this.vad.processAudio(frame, this.config.sampleRate);
//                             isVoice = (event === VAD.Event.VOICE);
//                         }
//
//                         if (isVoice) {
//                             if (!isSpeaking) {
//                                 console.log(`🎤 [VAD] Старт речи (RMS: ${Math.round(rms)})`);
//                                 isSpeaking = true;
//                                 speechDurationMs = 0;
//                             }
//
//                             silenceDurationMs = 0; // Сбрасываем накопленную тишину
//                             speechDurationMs += FRAME_DURATION_MS;
//                             audioChunks.push(frame);
//
//                         } else {
//                             // Фрейм — тишина или фоновый шум
//                             if (isSpeaking) {
//                                 audioChunks.push(frame);
//                                 speechDurationMs += FRAME_DURATION_MS;
//                                 silenceDurationMs += FRAME_DURATION_MS;
//
//                                 // Пауза превысила допустимый лимит
//                                 if (silenceDurationMs >= this.config.silenceThresholdMs) {
//                                     if (speechDurationMs >= this.config.speechMinDurationMs) {
//                                         console.log(`⏹️ [VAD] Речь завершена. Длительность: ${(speechDurationMs / 1000).toFixed(1)}с (пауза: ${silenceDurationMs}мс)`);
//                                         cleanup();
//                                         resolve(audioChunks);
//                                         return;
//                                     } else {
//                                         console.log('⚠️ [VAD] Ложный шум отсеян.');
//                                         isSpeaking = false;
//                                         audioChunks.length = 0;
//                                         silenceDurationMs = 0;
//                                         speechDurationMs = 0;
//                                     }
//                                 }
//                             }
//                         }
//                     } catch (err) {
//                         console.error('[VAD Error]:', err);
//                     }
//                 }
//
//                 isProcessingQueue = false;
//             };
//
//             const onData = (chunk: Buffer) => {
//                 bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
//
//                 while (bufferAccumulator.length >= FRAME_SIZE) {
//                     const frame = bufferAccumulator.subarray(0, FRAME_SIZE);
//                     bufferAccumulator = bufferAccumulator.subarray(FRAME_SIZE);
//                     frameQueue.push(frame);
//                 }
//
//                 processQueue();
//             };
//
//             const onError = (err: Error) => {
//                 cleanup();
//                 reject(err);
//             };
//
//             const cleanup = () => {
//                 micStream.removeListener('data', onData);
//                 micStream.removeListener('error', onError);
//                 frameQueue.length = 0;
//             };
//
//             micStream.on('data', onData);
//             micStream.on('error', onError);
//         });
//     }
// }


