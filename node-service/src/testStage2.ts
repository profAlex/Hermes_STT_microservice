import record from 'node-record-lpcm16';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { VADService } from './services/vad.service.js';

dotenv.config();

async function runStage2Test() {
    console.log('🚀 Запуск Этапа 2: Тестирование VAD...');
    console.log('Говорите в микрофон! Запись остановится автоматически через 1.5 сек тишины.\n');

    const recorderType = (process.env.RECORDER_RECORDER as 'arecord' | 'sox') || 'sox';
    const device = process.env.LOCAL_MIC_DEVICE || undefined;

    const recording = record.record({
        sampleRate: 16000,
        channels: 1,
        audioType: 'wav',
        recorder: recorderType,
        device: device,
        extraArgs: ['gain', '-n', '-3'], // Авто-нормализация громкости, проверенная на Этапе 1
    });

    const micStream = recording.stream();

    // Игнорируем штатный сигнал завершения процесса sox
    micStream.on('error', (err: any) => {
        if (!err?.toString().includes('exited with error code')) {
            console.error('⚠️ Ошибка аудиопотока:', err);
        }
    });

    const vadDetector = new VADService({
        silenceThresholdMs: 1200,    // Поставим 1.2 секунды паузы
        speechMinDurationMs: 400,
        minEnergyThreshold: 2000,     // RMS Программная отсечка по громкости (RMS Power) Чем ВЫШЕ число, тем МЕНЕЕ чувствителен к шуму микрофон (попробуйте 400-800)
    });

    try {
        const audioBuffers = await vadDetector.captureSpeechSegment(micStream);

        recording.stop();

        const outputDir = path.resolve('recordings');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFile = path.join(outputDir, `vad_speech_${Date.now()}.wav`);
        const finalBuffer = Buffer.concat(audioBuffers);

        fs.writeFileSync(outputFile, finalBuffer);
        console.log(`✅ Успешно записан сегмент речи: ${outputFile} (${finalBuffer.length} байт)`);

    } catch (err) {
        console.error('❌ Ошибка во время VAD:', err);
        recording.stop();
    }
}

runStage2Test();