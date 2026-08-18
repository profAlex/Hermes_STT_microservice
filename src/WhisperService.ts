import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { cpus } from 'node:os';

const execFileAsync = promisify(execFile);

export interface WhisperConfig {
    whisperCliPath: string; // Путь к бинарнику whisper-cli
    modelPath: string;      // Путь к .bin модели (small / medium)
    language?: string;       // Язык (по умолчанию 'ru')
    threads?: number; // Опциональное переопределение
}

export class WhisperService {
    private config: WhisperConfig;

    constructor(config: WhisperConfig) {
        this.config = {
            language: 'ru',
            ...config,
        };
    }

    /**
     * Превращает массив PCM-буферов (16kHz, 16-bit Mono) в текстовую строку
     */
    public async transcribe(pcmChunks: Buffer[]): Promise<string> {
        if (!pcmChunks || pcmChunks.length === 0) {
            return '';
        }

        const pcmData = Buffer.concat(pcmChunks);
        const tempWavPath = join('/tmp', `vad_speech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
        const threadsCount = this.config.threads || cpus().length || 4;

        console.log('THREADS USED:', threadsCount);

        try {
            // 1. Формируем честный WAV-файл с RIFF заголовком
            const wavHeader = this.createWavHeader(pcmData.length, 16000, 1, 16);
            const wavBuffer = Buffer.concat([wavHeader, pcmData]);

            // 2. Записываем во временную директорию /tmp
            await fs.writeFile(tempWavPath, wavBuffer);

            // 3. Вызываем whisper-cli
            const { stdout } = await execFileAsync(
                this.config.whisperCliPath,
                [
                    '-m', this.config.modelPath,
                    '-f', tempWavPath,
                    '-l', this.config.language || 'ru',
                    '-nt', // Без временных меток
                    '-t', String(threadsCount), // количество потоков
                ],
                { timeout: 15000 }
            );

            // 4. Очищаем от лишних переносов и пробелов
            const recognizedText = stdout.trim();
            return recognizedText;

        } catch (error) {
            console.error('❌ [WhisperService Error]:', error);
            throw error;
        } finally {
            // 5. Безусловное удаление временного файла
            await fs.unlink(tempWavPath).catch(() => {});
        }
    }

    /**
     * Генерация 44-байтового RIFF/WAV заголовка для PCM-данных
     */
    private createWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
        const header = Buffer.alloc(44);

        // RIFF chunk descriptor
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + dataLength, 4);
        header.write('WAVE', 8);

        // fmt sub-chunk
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
        header.writeUInt16LE(channels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28); // ByteRate
        header.writeUInt16LE(channels * (bitsPerSample / 8), 32);             // BlockAlign
        header.writeUInt16LE(bitsPerSample, 34);

        // data sub-chunk
        header.write('data', 36);
        header.writeUInt32LE(dataLength, 40);

        return header;
    }
}