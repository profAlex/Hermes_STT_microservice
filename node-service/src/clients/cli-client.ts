import WebSocket from 'ws';
import record from 'node-record-lpcm16';
import { GlobalKeyboardListener } from 'node-global-key-listener';

// --- КОНФИГУРАЦИЯ ---
const GATEWAY_WS_URL = process.env.GATEWAY_WS_URL || 'ws://192.168.1.100:8085'; // Укажи IP/порт своего Gateway
const INJECT_HTTP_URL = process.env.INJECT_HTTP_URL || 'http://127.0.0.1:9999/inject';
const HOTKEY_NAME = 'F12'; // Клавиша для перехвата записи

let ws: WebSocket | null = null;
let recordingStream: any = null;
let isRecording = false;

// --- 1. ОТПРАВКА РАСПОЗНАННОГО ТЕКСТА В PYTHON-ПЛАГИН ---
async function injectTextToHermes(text: string): Promise<void> {
    if (!text || !text.trim()) return;

    try {
        const response = await fetch(INJECT_HTTP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text }),
        });

        if (!response.ok) {
            console.error(`[Voice Client] ❌ Ошибка вставки текста (HTTP ${response.status})`);
        }
    } catch (error) {
        console.error('[Voice Client] ❌ Не удалось связаться с Python-плагином:', (error as Error).message);
    }
}

// --- 2. ИНИЦИАЛИЗА WEBSOCKET СОЕДИНЕНИЯ C GATEWAY ---
function connectWebSocket(): void {
    ws = new WebSocket(GATEWAY_WS_URL);

    ws.on('open', () => {
        // В тихом режиме можно не выводить ничего, чтобы не мусорить в консоли
    });

    ws.on('message', async (data: WebSocket.RawData) => {
        try {
            const message = JSON.parse(data.toString());

            // При получении распознанного текста от Whisper Gateway
            if (message.type === 'transcription' && message.text) {
                await injectTextToHermes(message.text);
            }
        } catch (e) {
            console.error('[Voice Client] Ошибка обработки сообщения от Gateway:', e);
        }
    });

    ws.on('close', () => {
        // Автоматическое переподключение через 3 секунды при обрыве
        setTimeout(connectWebSocket, 3000);
    });

    ws.on('error', (err) => {
        // Глушим вывод ошибок, если сервер временно недоступен
    });
}

// --- 3. УПРАВЛЕНИЕ ЗАПИСЬЮ АУДИОСИГНАЛА ---
function startRecording(): void {
    if (isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;

    isRecording = true;

    recordingStream = record.record({
        sampleRate: 16000,
        channels: 1,
        audioType: 'raw', // PCM16 без заголовков
        recorder: 'rec', // Требует установленный sox/rec в Linux
    }).stream();

    recordingStream.on('data', (chunk: Buffer) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
        }
    });

    recordingStream.on('error', (err: any) => {
        console.error('[Voice Client] Ошибка аудиозаписи:', err);
    });
}

function stopRecording(): void {
    if (!isRecording) return;

    isRecording = false;

    if (recordingStream) {
        recordingStream.destroy();
        recordingStream = null;
    }

    // Сигнализируем Gateway-серверу о завершении потока фреймов
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'end_of_stream' }));
    }
}

// Предохранитель от повторных срабатываний при удержании клавиши
let isHotkeyPressed = false;

// --- 4. СЛУШАТЕЛЬ ГЛОБАЛЬНЫХ НАЖАТИЙ КЛАВИШ (TOGGLE: CTRL + B) ---
function setupGlobalHotkeys(): void {
    const keyboardListener = new GlobalKeyboardListener();

    keyboardListener.addListener((e: any, down: any) => {
        const isCtrlPressed = down['LEFT CTRL'] || down['RIGHT CTRL'];

        // Проверяем событие клавиши 'B'
        if (e.name === 'B') {

            // 1. Момент НАЖАТИЯ Ctrl + B
            if (e.state === 'DOWN' && isCtrlPressed) {
                if (!isHotkeyPressed) {
                    isHotkeyPressed = true; // Защита от авто-повтора ОС при зажатии

                    // ПЕРЕКЛЮЧАТЕЛЬ (TOGGLE)
                    if (!isRecording) {
                        startRecording();
                    } else {
                        stopRecording();
                    }
                }
            }

            // 2. Момент ОТПУСКАНИЯ B — сбрасываем флаг нажатия
            else if (e.state === 'UP') {
                isHotkeyPressed = false;
            }
        }
    });
}

// --- ТОЧКА ВХОДА ---
connectWebSocket();
setupGlobalHotkeys();


// // ВЕРСИЯ С АКТИВАЦИЕЙ PUSH-TO-ACTIVATE
//
// import recorder from 'node-record-lpcm16';
// import WebSocket from 'ws';
// import { fileURLToPath } from 'url';
// import path from 'path';
// import dotenv from 'dotenv';
// import * as pty from 'node-pty';
//
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// dotenv.config({ path: path.resolve(__dirname, '../../.env') });
//
// const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8085';
//
// export class VoiceCliClient {
//     private ws: WebSocket | null = null;
//     private recordingProcess: any = null;
//     private ptyProcess: pty.IPty | null = null;
//
//     // --- Переключатель записи по горячей клавише ---
//     private isRecording: boolean = false;
//
//     public start(): void {
//         this.initHermesPty();
//         this.connectWebSocket();
//     }
//
//     private initHermesPty(): void {
//         const hermesPath = '/home/bb/.hermes/hermes-agent/venv/bin/hermes';
//
//         this.ptyProcess = pty.spawn(hermesPath, [/*'--yolo'*/], {
//             name: 'xterm-256color',
//             cols: process.stdout.columns || 100,
//             rows: process.stdout.rows || 30,
//             cwd: process.env.HOME || '/home/bb',
//             env: {
//                 ...process.env,
//                 TERM: 'xterm-256color',
//                 COLORTERM: 'truecolor'
//             }
//         });
//
//         this.ptyProcess.onData((data: string) => {
//             process.stdout.write(data);
//         });
//
//         if (process.stdin.isTTY) {
//             process.stdin.setRawMode(true);
//             process.stdin.resume();
//             process.stdin.on('data', (key: Buffer) => {
//                 const char = key.toString();
//
//                 // Ctrl+C (\u0003) — остановка приложения
//                 if (char === '\u0003') {
//                     this.stop();
//                 }
//                 // Ctrl+B (\u0002) — переключатель записи микрофона (Toggle Recording)
//                 else if (char === '\u0002') {
//                     this.toggleRecording();
//                 }
//                 // Все остальные клавиши пробрасываем напрямую в CLI Hermes
//                 else if (this.ptyProcess) {
//                     this.ptyProcess.write(key);
//                 }
//             });
//         }
//
//         process.stdout.on('resize', () => {
//             if (this.ptyProcess) {
//                 this.ptyProcess.resize(
//                     process.stdout.columns || 100,
//                     process.stdout.rows || 30
//                 );
//             }
//         });
//
//         setTimeout(() => {
//             this.renderPassiveStatus();
//         }, 1000);
//     }
//
//     private connectWebSocket(): void {
//         this.ws = new WebSocket(SERVER_URL);
//         this.ws.binaryType = 'nodebuffer';
//
//         this.ws.on('open', () => {
//             // this.startMicrophone();
//         });
//
//         this.ws.on('message', (data: WebSocket.RawData) => {
//             try {
//                 const payload = JSON.parse(data.toString());
//                 this.handleServerEvent(payload);
//             } catch (err) {
//                 // Игнорируем ошибки парсинга
//             }
//         });
//
//         this.ws.on('close', () => this.stop());
//         this.ws.on('error', () => this.stop());
//     }
//
//     private startMicrophone(): void {
//         this.recordingProcess = recorder.record({
//             sampleRate: 16000,
//             channels: 1,
//             audioType: 'raw',
//             recorder: 'rec',
//             threshold: 0,
//             extraArgs: ['-e', 'signed-integer', '-b', '16', '-L']
//         });
//
//         const stream = this.recordingProcess.stream();
//
//         stream.on('data', (chunk: Buffer) => {
//             // ИЗМЕНЕНИЕ: Отправляем байты ТОЛЬКО если активен режим записи
//             if (this.isRecording && this.ws && this.ws.readyState === WebSocket.OPEN) {
//                 this.ws.send(chunk);
//             }
//         });
//
//         stream.on('error', () => {});
//     }
//
//     private stopMicrophone(): void {
//         if (this.recordingProcess) {
//             this.recordingProcess.stop();
//         }
//
//     }
//
//     private toggleRecording(): void {
//         this.isRecording = !this.isRecording;
//
//         if (this.isRecording) {
//             this.renderActiveStatus();
//             this.startMicrophone();
//             // Уведомляем сервер, что началась новая фраза
//             this.ws?.send(JSON.stringify({ event: 'start_recording' }));
//         } else {
//             this.renderPassiveStatus();
//             this.stopMicrophone();
//             // Уведомляем сервер, что фраза окончена!
//             this.ws?.send(JSON.stringify({ event: 'stop_recording' }));
//         }
//     }
//
//     private handleServerEvent(payload: any): void {
//         switch (payload.event) {
//             case 'stt_result':
//                 if (!payload.text) break;
//
//                 const rawText = payload.text.trim();
//                 if (rawText.length > 0) {
//                     this.sendToHermes(rawText);
//                 }
//                 break;
//
//             default:
//                 break;
//         }
//     }
//
//     private renderActiveStatus(): void {
//         this.renderStatusIndicator('\x1b[42m\x1b[30m 🎙️  МИКРОФОН ВКЛЮЧЕН (Ctrl+B - выключить) \x1b[0m');
//     }
//
//     private renderPassiveStatus(): void {
//         this.renderStatusIndicator('\x1b[44m\x1b[37m 🔴 МИКРОФОН ВЫКЛЮЧЕН (Ctrl+B - включить) \x1b[0m');
//     }
//
//     private renderStatusIndicator(statusHtml: string): void {
//         process.stdout.write(`\x1b[s\x1b[1;1H\x1b[K ${statusHtml}\x1b[u`);
//     }
//
//     private sendToHermes(text: string): void {
//         if (this.ptyProcess) {
//             this.ptyProcess.write(`${text}\r`);
//         }
//     }
//
//     public stop(): void {
//         if (this.recordingProcess) {
//             this.recordingProcess.stop();
//         }
//         if (this.ws) {
//             this.ws.close();
//         }
//         if (this.ptyProcess) {
//             this.ptyProcess.kill();
//         }
//         process.exit(0);
//     }
// }
//
// const client = new VoiceCliClient();
// client.start();
//
// process.on('SIGINT', () => {
//     client.stop();
// });
//
