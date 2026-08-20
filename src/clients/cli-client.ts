import recorder from 'node-record-lpcm16';
import WebSocket from 'ws';
import {fileURLToPath} from "url";
import path from "path";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Читаем адрес сервера из переменной окружения или используем дефолтный localhost
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8085';

export class VoiceCliClient {
    private ws: WebSocket | null = null;
    private recordingProcess: any = null;

    public start(): void {
        console.log(`🔌 Подключение к VoiceGateway: ${SERVER_URL}...`);
        this.ws = new WebSocket(SERVER_URL);

        // ВАЖНО: Настраиваем прием бинарных данных как Buffer
        this.ws.binaryType = 'nodebuffer';

        this.ws.on('open', () => {
            console.log('🟢 [Client] Успешно подключено к серверу!');
            this.startMicrophone();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const payload = JSON.parse(data.toString());
                this.handleServerEvent(payload);
            } catch (err) {
                console.error('⚠️ [Client] Ошибка парсинга ответа от сервера:', err);
            }
        });

        this.ws.on('close', () => {
            console.log('🔴 [Client] Соединение с сервером закрыто.');
            this.stop();
        });

        this.ws.on('error', (err) => {
            console.error('❌ [Client] Ошибка WebSocket:', err);
            this.stop();
        });
    }

    private startMicrophone(): void {
        console.log('🎙️ [Client] Запуск записи с микрофона (SoX)... Скажите что-нибудь!');

        // Запускаем SoX через утилиту node-record-lpcm16
        this.recordingProcess = recorder.record({
            sampleRate: 16000,
            channels: 1,
            audioType: 'raw', // Передаем чистый PCM без WAV-заголовка
            recorder: 'sox',  // Используем SoX в PulseAudio/PipeWire
        });

        const stream = this.recordingProcess.stream();

        // Пробрасываем байты от SoX напрямую в WebSocket
        stream.on('data', (chunk: Buffer) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(chunk);
            }
        });

        stream.on('error', (err: any) => {
            console.error('⚠️ [Client] Ошибка аудиозаписи SoX:', err);
        });
    }

    private handleServerEvent(payload: any): void {
        switch (payload.event) {
            case 'stt_processing':
                console.log('⏳ [Server] Фраза захвачена VAD, запуск Whisper...');
                break;

            case 'stt_result':
                console.log(`\n🗣️ [Результат] (${payload.executionTimeMs} мс): "${payload.text}"\n`);
                break;

            case 'error':
                console.error('❌ [Server Error]:', payload.message);
                break;

            default:
                console.log('📩 [Server Event]:', payload);
        }
    }

    public stop(): void {
        if (this.recordingProcess) {
            this.recordingProcess.stop();
            console.log('🛑 [Client] Микрофон остановлен.');
        }
        if (this.ws) {
            this.ws.close();
        }
        process.exit(0);
    }
}

// Точка входа для запуска
const client = new VoiceCliClient();
client.start();

// Корректная обработка Ctrl+C
process.on('SIGINT', () => {
    console.log('\nОстановка клиента...');
    client.stop();
});