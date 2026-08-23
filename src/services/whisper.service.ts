import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WhisperConfig {
    whisperCpuCliPath: string;   // Путь к CPU бинарнику
    whisperCudaCliPath?: string; // Путь к CUDA бинарнику
    modelPath: string;           // Путь к .bin модели
    language?: string;           // Язык ('ru')
    cpuThreads?: number;         // Кол-во потоков для CPU
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
     * Превращает единый отфильтрованный массив PCM-буферов (16kHz, 16-bit Mono) в текст
     */
    public async transcribe(pcmChunks: Buffer[]): Promise<string> {
        // Защита: если за время зажатия Ctrl+B не было произнесено ни одного валидного слова
        if (!pcmChunks || pcmChunks.length === 0) {
            return '';
        }

        const pcmData = Buffer.concat(pcmChunks);

        // Минимальная проверка длительности (меньше ~0.1 сек PCM данных смысла транскрибировать нет)
        if (pcmData.length < 3200) {
            return '';
        }

        const tempWavPath = join('/tmp', `vad_speech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);

        try {
            // 1. Формируем единый WAV-файл из всех склеенных VAD-ом фрагментов
            const wavHeader = this.createWavHeader(pcmData.length, 16000, 1, 16);
            await fs.writeFile(tempWavPath, Buffer.concat([wavHeader, pcmData]));

            // 2. Попытка №1: CUDA (если путь указан в .env)
            if (this.config.whisperCudaCliPath) {
                try {

                    return await this.runWhisperCli(this.config.whisperCudaCliPath, tempWavPath);
                } catch (cudaError) {
                    console.warn('⚠️ [WhisperService] Ошибка CUDA/GPU (возможно, OOM). Переход на CPU...');
                }
            }

            // 3. Попытка №2: CPU (резервный вариант)
            const threads = this.config.cpuThreads || cpus().length || 4;
            return await this.runWhisperCli(this.config.whisperCpuCliPath, tempWavPath, ['-t', String(threads)]);

        } catch (error) {
            console.error('❌ [WhisperService Error]:', error);
            throw error;
        } finally {
            // 4. Безусловное удаление временного файла из /tmp
            await fs.unlink(tempWavPath).catch(() => {});
        }
    }

    /**
     * Запуск процесса whisper-cli
     */
    private async runWhisperCli(cliPath: string, wavPath: string, extraArgs: string[] = []): Promise<string> {
        const args = [
            '-m', this.config.modelPath,
            '-f', wavPath,
            '-l', this.config.language || 'ru',
            '-nt',
            '-bs', '1',              // Beam search size = 1
            '--no-fallback',         // Отключаем повторные проходы при неуверенности
            ...extraArgs,
        ];

        const { stdout } = await execFileAsync(cliPath, args, {
            timeout: 120000,
            maxBuffer: 10 * 1024 * 1024
        });

        return stdout.trim();
    }

    /**
     * Генерация 44-байтового RIFF/WAV заголовка
     */
    private createWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
        const header = Buffer.alloc(44);

        header.write('RIFF', 0);
        header.writeUInt32LE(36 + dataLength, 4);
        header.write('WAVE', 8);

        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(channels, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
        header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
        header.writeUInt16LE(bitsPerSample, 34);

        header.write('data', 36);
        header.writeUInt32LE(dataLength, 40);

        return header;
    }
}


// import { execFile } from 'node:child_process';
// import { promises as fs } from 'node:fs';
// import { cpus } from 'node:os';
// import { join } from 'node:path';
// import { promisify } from 'node:util';
//
// const execFileAsync = promisify(execFile);
//
// export interface WhisperConfig {
//     whisperCpuCliPath: string;   // Обязательный путь к CPU бинарнику
//     whisperCudaCliPath?: string; // Опциональный путь к CUDA бинарнику
//     modelPath: string;           // Путь к .bin модели
//     language?: string;           // Язык ('ru')
//     cpuThreads?: number;         // Кол-во потоков для CPU
// }
//
// export class WhisperService {
//     private config: WhisperConfig;
//
//     constructor(config: WhisperConfig) {
//         this.config = {
//             language: 'ru',
//             ...config,
//         };
//     }
//
//     /**
//      * Превращает массив PCM-буферов (16kHz, 16-bit Mono) в текст
//      */
//     public async transcribe(pcmChunks: Buffer[]): Promise<string> {
//         if (!pcmChunks || pcmChunks.length === 0) {
//             return '';
//         }
//
//         const pcmData = Buffer.concat(pcmChunks);
//         const tempWavPath = join('/tmp', `vad_speech_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
//
//         try {
//             // 1. Формируем WAV-файл с RIFF заголовком в /tmp
//             const wavHeader = this.createWavHeader(pcmData.length, 16000, 1, 16);
//             await fs.writeFile(tempWavPath, Buffer.concat([wavHeader, pcmData]));
//
//             // 2. Попытка №1: CUDA (если путь указан в .env)
//             if (this.config.whisperCudaCliPath) {
//                 try {
//                     return await this.runWhisperCli(this.config.whisperCudaCliPath, tempWavPath);
//                 } catch (cudaError) {
//                     console.warn('⚠️ [WhisperService] Ошибка CUDA/GPU (возможно, OOM). Переход на CPU...');
//                 }
//             }
//
//             // 3. Попытка №2: CPU (резервный основной вариант)
//             // Использование явного значения из .env или fallback на все доступные ядра
//             const threads = this.config.cpuThreads || cpus().length || 4;
//
//             return await this.runWhisperCli(this.config.whisperCpuCliPath, tempWavPath, ['-t', String(threads)]);
//
//         } catch (error) {
//             console.error('❌ [WhisperService Error]:', error);
//             throw error;
//         } finally {
//             // 4. Безусловное удаление временного файла из /tmp
//             await fs.unlink(tempWavPath).catch(() => {});
//         }
//     }
//
//     /**
//      * Запуск процесса whisper-cli
//      */
//     private async runWhisperCli(cliPath: string, wavPath: string, extraArgs: string[] = []): Promise<string> {
//         const args = [
//             '-m', this.config.modelPath,
//             '-f', wavPath,
//             '-l', this.config.language || 'ru',
//             '-nt',
//             '-bs', '1',              // Beam search size = 1 (ускоряет обработку)
//             '--no-fallback',         // Отключаем повторные проходы при неуверенности
//             ...extraArgs,
//         ];
//
//         // Увеличен timeout и maxBuffer для предотвращения падающих SIGTERM по длине фразы
//         const { stdout } = await execFileAsync(cliPath, args, {
//             timeout: 120000,
//             maxBuffer: 10 * 1024 * 1024
//         });
//
//         return stdout.trim();
//     }
//
//     /**
//      * Генерация 44-байтового RIFF/WAV заголовка
//      */
//     private createWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
//         const header = Buffer.alloc(44);
//
//         header.write('RIFF', 0);
//         header.writeUInt32LE(36 + dataLength, 4);
//         header.write('WAVE', 8);
//
//         header.write('fmt ', 12);
//         header.writeUInt32LE(16, 16);
//         header.writeUInt16LE(1, 20);
//         header.writeUInt16LE(channels, 22);
//         header.writeUInt32LE(sampleRate, 24);
//         header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
//         header.writeUInt16LE(channels * (bitsPerSample / 8), 32);
//         header.writeUInt16LE(bitsPerSample, 34);
//
//         header.write('data', 36);
//         header.writeUInt32LE(dataLength, 40);
//
//         return header;
//     }
// }