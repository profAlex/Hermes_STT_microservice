import record from 'node-record-lpcm16';
import path from 'node:path';
import { VoiceActivityDetector } from './vadService.js';
import { WhisperService } from './WhisperService.js';

async function runStage3Test() {
    console.log('🚀 === [Тест Этапа 3: VAD + Whisper STT] ===');

    // 1. Инициализируем VAD
    const vadService = new VoiceActivityDetector({
        sampleRate: 16000,
        minEnergyThreshold: 2000,
        silenceThresholdMs: 1500,
        speechMinDurationMs: 400,
    });

    // 2. Инициализируем WhisperService
    // Укажи точные пути к собранному whisper.cpp и модели!
    const whisperService = new WhisperService({
        whisperCliPath: path.resolve('/home/bb/Documents/STT_TTS_microservice_localAI/WhisperSurfaceBuild/whisper.cpp/build/bin/whisper-cli'),
        modelPath: path.resolve('/home/bb/Documents/STT_TTS_microservice_localAI/WhisperSurfaceBuild/whisper.cpp/models/ggml-small.bin'),
        language: 'ru',
    });

    // 3. Запускаем микрофонный поток
    console.log('🎙️ Запуск микрофона...');
    const recording = record.record({
        sampleRate: 16000,
        channels: 1,
        audioType: 'raw',
        recorder: 'sox',
    });

    const micStream = recording.stream();

    try {
        console.log('🎧 Говорите в микрофон! (Запись автоматически остановится при паузе > 1.5 сек)');

        const startTime = Date.now();
        // Ждем сегмент речи от VAD
        const audioChunks = await vadService.captureSpeechSegment(micStream);
        const vadTime = Date.now() - startTime;

        console.log(`\n📦 [VAD] Сегмент речи захвачен за ${vadTime} мс. Размер: ${audioChunks.reduce((acc, c) => acc + c.length, 0)} байт.`);

        // 4. Передаем PCM буферы в Whisper
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