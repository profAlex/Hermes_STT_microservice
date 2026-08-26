declare module 'node-record-lpcm16' {
    import { Readable } from 'stream';

    export interface Options {
        sampleRate?: number;
        channels?: number;
        compress?: boolean;
        threshold?: number;
        thresholdStart?: number;
        thresholdEnd?: number;
        silence?: string;
        recorder?: string;
        endOnSilence?: boolean;
        audioType?: string;
        device?: string;
        extraArgs?: string[];
    }

    export interface Recording {
        stream(): Readable;
        stop(): void;
    }

    export function record(options?: Options): Recording;
}