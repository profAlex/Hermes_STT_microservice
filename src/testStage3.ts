import dotenv from 'dotenv';
import path from 'node:path';
import record from 'node-record-lpcm16';
import { VADService } from './services/vad.service.js';
import { WhisperService } from './services/whisper.service.js';
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runStage3Test() {
    console.log('--------------------------------------------------');
    console.log('🚀 [Этап 3] Сквозной тест: VAD + Whisper STT');
    console.log('--------------------------------------------------');

    const cpuCliPath = process.env.WHISPER_CPU_CLI_PATH;
    const modelPath = process.env.WHISPER_MODEL_PATH;

    if (!cpuCliPath || !modelPath) {
        console.error('❌ Ошибка: Не заданы WHISPER_CPU_CLI_PATH или WHISPER_MODEL_PATH в .env!');
        process.exit(1);
    }

    const sampleRate = Number.parseInt(process.env.AUDIO_SAMPLE_RATE || '16000', 10);
    const channels = Number.parseInt(process.env.AUDIO_CHANNELS || '1', 10);
    const recorderType = (process.env.RECORDER_RECORDER as 'arecord' | 'sox') || 'sox';
    const device = process.env.LOCAL_MIC_DEVICE || undefined;

    // 1. VAD Service
    const vadService = new VADService({
        sampleRate,
        minEnergyThreshold: 2000,
        silenceThresholdMs: 1500,
        speechMinDurationMs: 400,
    });

    // 2. Whisper Service
    const whisperService = new WhisperService({
        whisperCpuCliPath: path.resolve(cpuCliPath),
        whisperCudaCliPath: process.env.WHISPER_CUDA_CLI_PATH ? path.resolve(process.env.WHISPER_CUDA_CLI_PATH) : undefined,
        modelPath: path.resolve(modelPath),
        language: process.env.WHISPER_LANGUAGE || 'ru',
        cpuThreads: process.env.WHISPER_CPU_THREADS ? Number.parseInt(process.env.WHISPER_CPU_THREADS, 10) : undefined,
    });

    // 3. Захват потока с микрофона
    console.log(`🎙️ Запуск микрофона (${recorderType}, ${sampleRate}Hz, ${channels}ch)...`);
    const recording = record.record({
        sampleRate,
        channels,
        audioType: 'raw',
        recorder: recorderType,
        device,
    });

    const micStream = recording.stream();

    try {
        console.log('🎧 Говорите в микрофон! (Запись автоматически остановится при паузе > 1.5 сек)');

        const startTime = Date.now();
        const audioChunks = await vadService.captureSpeechSegment(micStream);
        const vadTime = Date.now() - startTime;

        const totalBytes = audioChunks.reduce((acc, c) => acc + c.length, 0);
        console.log(`\n📦 [VAD] Сегмент речи захвачен за ${vadTime} мс. Размер: ${totalBytes} байт.`);

        // 4. Транскрибация через Whisper
        console.log('⚡ [Whisper] Транскрибация аудио...');
        const sttStartTime = Date.now();

        const text = await whisperService.transcribe(audioChunks);
        const sttTime = Date.now() - sttStartTime;

        console.log('\n========================================');
        console.log(`🗣️ Распознанный текст: "${text}"`);
        console.log(`⏱️ Время транскрибации (STT): ${sttTime} мс`);
        console.log('========================================\n');

    } catch (error) {
        console.error('❌ Ошибка во время теста:', error);
    } finally {
        recording.stop();
        process.exit(0);
    }
}

runStage3Test();