import { WebSocketServer, WebSocket } from 'ws';
import { PassThrough } from 'node:stream';
import { VADService } from '../services/vad.service.js';
import { WhisperService } from '../services/whisper.service.js';

export interface VoiceGatewayConfig {
    port: number;
}

export class VoiceGateway {
    private wss: WebSocketServer;

    constructor(
        private config: VoiceGatewayConfig,
        private vadService: VADService,
        private whisperService: WhisperService
    ) {
        this.wss = new WebSocketServer({ port: this.config.port });
        this.init();
    }

    private init(): void {
        console.log(`📡 [VoiceGateway] WebSocket сервер запущен на порту :${this.config.port}`);

        this.wss.on('connection', (ws: WebSocket) => {
            console.log('🔌 [VoiceGateway] Новое подключение клиента.');

            // Создаем PassThrough-адаптер для текущей сессии
            const audioStream = new PassThrough();

            // Запускаем фоновый цикл обработки VAD -> STT
            this.processAudioPipeline(ws, audioStream);

            // Принимаем бинарные PCM-чанки от сокета и пишем в PassThrough
            ws.on('message', (data: Buffer, isBinary: boolean) => {
                if (isBinary && !audioStream.destroyed) {
                    audioStream.write(data);
                }
            });

            ws.on('close', () => {
                console.log('❌ [VoiceGateway] Клиент отключился.');
                audioStream.destroy(); // Завершаем поток при разрыве соединения
            });

            ws.on('error', (err) => {
                console.error('⚠️ [VoiceGateway] Ошибка сокета:', err);
                audioStream.destroy();
            });
        });
    }

    /**
     * Бесконечный цикл чтения фраз из PassThrough потока
     */
    private async processAudioPipeline(ws: WebSocket, audioStream: PassThrough): Promise<void> {
        try {
            // Пока клиент подключен — непрерывно слушаем фразы
            while (ws.readyState === WebSocket.OPEN && !audioStream.destroyed) {

                // 1. Твой VADService блокируется и ждет полноценную фразу из PassThrough
                const audioChunks = await this.vadService.captureSpeechSegment(audioStream);

                console.log(`📦 [Gateway] VAD захватил фразу из ${audioChunks.length} чанков. Запуск Whisper...`);

                this.sendJson(ws, { event: 'stt_processing' });

                // 2. Whisper переводит сегмент в текст
                const sttStartTime = Date.now();
                const transcribedText = await this.whisperService.transcribe(audioChunks);
                const sttTime = Date.now() - sttStartTime;

                console.log(`🗣️ [Gateway] Распознано (${sttTime} мс): "${transcribedText}"`);

                // 3. Отправляем распознанный текст обратно клиенту по WebSocket
                this.sendJson(ws, {
                    event: 'stt_result',
                    text: transcribedText,
                    executionTimeMs: sttTime,
                });
            }
        } catch (error) {
            // Игнорируем ошибку при штатном закрытии сокета
            if (ws.readyState === WebSocket.OPEN) {
                console.error('❌ [Gateway] Ошибка в пайплайне обработки речи:', error);
                this.sendJson(ws, { event: 'error', message: 'Ошибка обработки речи на сервере' });
            }
        }
    }

    private sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }
}