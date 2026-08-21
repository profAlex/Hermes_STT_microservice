import { Transform, TransformCallback } from 'stream';

export class AudioFrameSplitter extends Transform {
    private frameSize: number;
    private buffer: Buffer = Buffer.alloc(0);

    constructor(frameSize: number = 960) {
        super({ objectMode: false });
        this.frameSize = frameSize;
    }

    _transform(chunk: Buffer, encoding: string, callback: TransformCallback): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        while (this.buffer.length >= this.frameSize) {
            const frame = this.buffer.subarray(0, this.frameSize);
            this.buffer = this.buffer.subarray(this.frameSize);
            // Проталкиваем ровно 960 байт дальше по конвейеру (pipe)
            this.push(frame);
        }

        callback();
    }

    _flush(callback: TransformCallback): void {
        this.buffer = Buffer.alloc(0);
        callback();
    }
}