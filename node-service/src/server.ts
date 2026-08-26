import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VADService } from './services/vad.service.js';
import { WhisperService } from './services/whisper.service.js';
import { VoiceGateway } from './gateways/voice.gateway.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function startServer() {
    const cpuCliPath = process.env.WHISPER_CPU_CLI_PATH;
    const cudaCliPath = process.env.WHISPER_CUDA_CLI_PATH;
    const modelPath = process.env.WHISPER_MODEL_PATH;
    const port = Number.parseInt(process.env.VOICE_GATEWAY_PORT || '3000', 10);

    if (!cpuCliPath || !modelPath) {
        console.error('❌ Ошибка: Не заданы пути к Whisper в .env!');
        process.exit(1);
    }

    // 1. Инициализируем твои готовые сервисы
    const vadService = new VADService({
        sampleRate: 16000,
        minEnergyThreshold: 400,
        // silenceThresholdMs: 1500,
    });

    const whisperService = new WhisperService({
        whisperCpuCliPath: path.resolve(cpuCliPath),
        whisperCudaCliPath: path.resolve(cudaCliPath || ''),
        modelPath: path.resolve(modelPath),
        language: process.env.WHISPER_LANGUAGE || 'ru',
        serverUrl: process.env.WHISPER_SERVER_URL // опционально
    });

    // 2. Запускаем WebSocket Gateway
    new VoiceGateway({ port }, vadService, whisperService);

    console.log(`🚀 Voice Gateway успешно запущен! Ожидание подключений...`);
}

startServer();