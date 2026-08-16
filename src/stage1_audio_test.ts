import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import record from 'node-record-lpcm16';
import {fileURLToPath} from 'url';
import {exec} from 'child_process';
import {promisify} from 'util';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const sampleRate = parseInt(process.env.AUDIO_SAMPLE_RATE || '16000', 10);
const channels = parseInt(process.env.AUDIO_CHANNELS || '1', 10);
const recorderType = (process.env.RECORDER_RECORDER as 'arecord' | 'sox') || 'arecord';
const device = process.env.LOCAL_MIC_DEVICE || undefined;

const outputFilePath = path.join(__dirname, '../test_record.wav');
const RECORD_DURATION_SEC = 5;

async function runStage1Test() {
    console.log('--------------------------------------------------');
    console.log('🎙️  [Этап 1] Тестирование захвата и воспроизведения');
    console.log('--------------------------------------------------');
    console.log(`Параметры: ${sampleRate}Hz, ${channels}ch, Утилита: ${recorderType}, Устройство: ${device || 'default'}`);
    console.log(`Запись начнется прямо сейчас (${RECORD_DURATION_SEC} сек). Говорите в микрофон!...\n`);

    const fileStream = fs.createWriteStream(outputFilePath);

    const recording = record.record({
        sampleRate: sampleRate,
        channels: channels,
        audioType: 'wav',
        recorder: recorderType,
        device: device,
        // Добавляем флаги усиления для SoX
        extraArgs: ['gain', '-n', '-3'], // Авто-нормализация до -3dB (сделать громко, но без клиппинга)
    });

    const audioStream = recording.stream();

    // Обработка ошибок потока (чтобы предотвратить ERR_UNHANDLED_ERROR)
    audioStream.on('error', (err: any) => {
        // Игнорируем штатный сигнал остановки
        if (!err?.toString().includes('exited with error code')) {
            console.error('⚠️ Ошибка аудиопотока:', err);
        }
    });

    audioStream.pipe(fileStream);

    let timeLeft = RECORD_DURATION_SEC;
    const timer = setInterval(() => {
        process.stdout.write(`⏱️  Запись: ${timeLeft} сек... \r`);
        timeLeft--;
    }, 1000);

    setTimeout(async () => {
        clearInterval(timer);
        recording.stop();
        console.log('\n\n✅ Запись завершена!');

        // Даем файлу 200мс на закрытие дескриптора
        await new Promise((resolve) => setTimeout(resolve, 200));

        const stats = fs.statSync(outputFilePath);
        console.log(`📁 Файл: ${outputFilePath}`);
        console.log(`📊 Размер: ${(stats.size / 1024).toFixed(2)} KB`);

        console.log('\n🔊 Проигрываем результат...');
        try {
            await execAsync(`aplay ${outputFilePath}`);
            console.log('🎉 Воспроизведение завершено!');
        } catch (error) {
            console.error('⚠️ Ошибка воспроизведения через aplay (возможно, задействован PulseAudio/PipeWire):');
            console.log('Попробуйте вручную послушать файл через: paplay test_record.wav');
        }
    }, RECORD_DURATION_SEC * 1000);
}

runStage1Test().catch((err) => {
    console.error('💥 Ошибка:', err);
});