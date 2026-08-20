declare module 'node-vad' {
    export enum Mode {
        NORMAL = 0,
        LOW_BITRATE = 1,
        AGGRESSIVE = 2,
        VERY_AGGRESSIVE = 3,
    }

    export enum Event {
        ERROR = -1,
        SILENCE = 0,
        VOICE = 1,
        NOISE = 2,
    }

    export interface VADClass {
        new (mode?: Mode): {
            processAudio(chunk: Buffer, sampleRate: number): Promise<Event>;
            // Добавлен синхронный метод, возвращающий Event напрямую (без Promise)
            processAudioSync(chunk: Buffer, sampleRate: number): Event;
        };
        Mode: typeof Mode;
        Event: typeof Event;
    }

    const VAD: VADClass;
    export default VAD;
}