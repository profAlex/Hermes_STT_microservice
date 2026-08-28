// // ВЕРСИЯ С АКТИВАЦИЕЙ PUSH-TO-ACTIVATE

import recorder from 'node-record-lpcm16';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import * as pty from 'node-pty';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8085';

export class VoiceCliClient {
    private ws: WebSocket | null = null;
    private recordingProcess: any = null;
    private ptyProcess: pty.IPty | null = null;

    // --- Переключатель записи по горячей клавише ---
    private isRecording: boolean = false;

    public start(): void {
        this.initHermesPty();
        this.connectWebSocket();
    }

    private initHermesPty(): void {
        const hermesPath = '/home/bb/.hermes/hermes-agent/venv/bin/hermes';

        this.ptyProcess = pty.spawn(hermesPath, [/*'--yolo'*/], {
            name: 'xterm-256color',
            cols: process.stdout.columns || 100,
            rows: process.stdout.rows || 30,
            cwd: process.env.HOME || '/home/bb',
            env: {
                ...process.env,
                TERM: 'xterm-256color',
                COLORTERM: 'truecolor'
            }
        });

        this.ptyProcess.onData((data: string) => {
            process.stdout.write(data);
        });

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', (key: Buffer) => {
                const char = key.toString();

                // Ctrl+C (\u0003) — остановка приложения
                if (char === '\u0003') {
                    this.stop();
                }
                // Ctrl+B (\u0002) — переключатель записи микрофона (Toggle Recording)
                else if (char === '\u0002') {
                    this.toggleRecording();
                }
                // Все остальные клавиши пробрасываем напрямую в CLI Hermes
                else if (this.ptyProcess) {
                    this.ptyProcess.write(key);
                }
            });
        }

        process.stdout.on('resize', () => {
            if (this.ptyProcess) {
                this.ptyProcess.resize(
                    process.stdout.columns || 100,
                    process.stdout.rows || 30
                );
            }
        });

        setTimeout(() => {
            this.renderPassiveStatus();
        }, 1000);
    }

    private connectWebSocket(): void {
        this.ws = new WebSocket(SERVER_URL);
        this.ws.binaryType = 'nodebuffer';

        this.ws.on('open', () => {
            // this.startMicrophone();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const payload = JSON.parse(data.toString());
                this.handleServerEvent(payload);
            } catch (err) {
                // Игнорируем ошибки парсинга
            }
        });

        this.ws.on('close', () => this.stop());
        this.ws.on('error', () => this.stop());
    }

    private startMicrophone(): void {
        this.recordingProcess = recorder.record({
            sampleRate: 16000,
            channels: 1,
            audioType: 'raw',
            recorder: 'rec',
            threshold: 0,
            extraArgs: ['-e', 'signed-integer', '-b', '16', '-L']
        });

        const stream = this.recordingProcess.stream();

        stream.on('data', (chunk: Buffer) => {
            // ИЗМЕНЕНИЕ: Отправляем байты ТОЛЬКО если активен режим записи
            if (this.isRecording && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(chunk);
            }
        });

        stream.on('error', () => {});
    }

    private stopMicrophone(): void {
        if (this.recordingProcess) {
            this.recordingProcess.stop();
        }

    }

    private toggleRecording(): void {
        this.isRecording = !this.isRecording;

        if (this.isRecording) {
            this.renderActiveStatus();
            this.startMicrophone();
            // Уведомляем сервер, что началась новая фраза
            this.ws?.send(JSON.stringify({ event: 'start_recording' }));
        } else {
            this.renderPassiveStatus();
            this.stopMicrophone();
            // Уведомляем сервер, что фраза окончена!
            this.ws?.send(JSON.stringify({ event: 'stop_recording' }));
        }
    }

    private handleServerEvent(payload: any): void {
        switch (payload.event) {
            case 'stt_result':
                if (!payload.text) break;

                const rawText = payload.text.trim();
                if (rawText.length > 0) {
                    this.sendToHermes(rawText);
                }
                break;

            default:
                break;
        }
    }

    private renderActiveStatus(): void {
        this.renderStatusIndicator('\x1b[42m\x1b[30m 🎙️  МИКРОФОН ВКЛЮЧЕН (Ctrl+B - выключить) \x1b[0m');
    }

    private renderPassiveStatus(): void {
        this.renderStatusIndicator('\x1b[44m\x1b[37m 🔴 МИКРОФОН ВЫКЛЮЧЕН (Ctrl+B - включить) \x1b[0m');
    }

    private renderStatusIndicator(statusHtml: string): void {
        process.stdout.write(`\x1b[s\x1b[1;1H\x1b[K ${statusHtml}\x1b[u`);
    }

    private sendToHermes(text: string): void {
        if (this.ptyProcess) {
            this.ptyProcess.write(`${text}\r`);
        }
    }

    public stop(): void {
        if (this.recordingProcess) {
            this.recordingProcess.stop();
        }
        if (this.ws) {
            this.ws.close();
        }
        if (this.ptyProcess) {
            this.ptyProcess.kill();
        }
        process.exit(0);
    }
}

const client = new VoiceCliClient();
client.start();

process.on('SIGINT', () => {
    client.stop();
});


// // ВЕРСИЯ С АКТИВАЦИЕЙ ГОЛОСОМ ЧЕРЕЗ WAKE-WORD

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
//     // --- Настройки Wake Word ---
//     private WAKE_WORDS = ['алиса', 'эй алиса', 'слушай алиса', 'слушай, алиса', 'так, алиса', 'так алиса', 'прием, алиса', 'прием алиса'];
//     private isActive: boolean = false;
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
//                 if (key.toString() === '\u0003') {
//                     this.stop();
//                 } else if (this.ptyProcess) {
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
//             this.startMicrophone();
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
//             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
//                 this.ws.send(chunk);
//             }
//         });
//
//         stream.on('error', () => {});
//     }
//
//     private handleServerEvent(payload: any): void {
//         switch (payload.event) {
//             case 'stt_result':
//                 if (!payload.text) break;
//
//                 const rawText = payload.text.trim();
//                 const lowerText = rawText.toLowerCase();
//
//                 const detectedWakeWord = this.WAKE_WORDS.find(word => lowerText.includes(word));
//
//                 // 1. Если ключевое слово распознано в этом чанке
//                 if (detectedWakeWord) {
//                     let cleanCommand = rawText
//                         .replace(new RegExp(detectedWakeWord, 'gi'), '')
//                         .replace(/^(так|ну|э-э|хм)[,\s\.]*/gi, '')
//                         .replace(/^[,\s\.\!]+/, '')
//                         .trim();
//
//                     // Переходим в активный режим (без таймаутов!)
//                     this.activateListening();
//
//                     // Если вместе с ключевым словом сразу была сказана фраза
//                     if (cleanCommand.length > 0) {
//                         this.sendToHermesAndDeactivate(cleanCommand);
//                     }
//                 }
//                 // 2. Если мы УЖЕ в активном режиме и прилетел следующий чанк с командой
//                 else if (this.isActive) {
//                     this.sendToHermesAndDeactivate(rawText);
//                 }
//                 break;
//
//             default:
//                 break;
//         }
//     }
//
//     private activateListening(): void {
//         this.isActive = true;
//         this.renderActiveStatus();
//     }
//
//     private deactivateListening(): void {
//         this.isActive = false;
//         this.renderPassiveStatus();
//     }
//
//     /**
//      * Отправляет команду в Hermes и сразу переводит систему в режим ожидания
//      */
//     private sendToHermesAndDeactivate(text: string): void {
//         if (this.ptyProcess) {
//             this.ptyProcess.write(`${text}\r`);
//         }
//         // После успешной отправки промпта возвращаемся в режим ожидания
//         this.deactivateListening();
//     }
//
//     private renderActiveStatus(): void {
//         this.renderStatusIndicator('\x1b[42m\x1b[30m 🎙️  ГЕРМЕС: СЛУШАЮ КОМАНДУ... \x1b[0m');
//     }
//
//     private renderPassiveStatus(): void {
//         this.renderStatusIndicator('\x1b[44m\x1b[37m 💤  ГЕРМЕС: ОЖИДАНИЕ КЛЮЧЕВОГО СЛОВА \x1b[0m');
//     }
//
//     private renderStatusIndicator(statusHtml: string): void {
//         process.stdout.write(`\x1b[s\x1b[1;1H\x1b[K ${statusHtml}\x1b[u`);
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



// // ВЕРСИЯ ГДЕ НЕТ АКТИВАЦИИ НИ ГОЛОСОМ НИ ПО КОМБИНАЦИИ КЛАВИШ

// import recorder from 'node-record-lpcm16';
// import WebSocket from 'ws';
// import {fileURLToPath} from "url";
// import path from "path";
// import dotenv from "dotenv";
//
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// dotenv.config({ path: path.resolve(__dirname, '../../.env') });
//
// // Читаем адрес сервера из переменной окружения или используем дефолтный localhost
// const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8085';
//
// export class VoiceCliClient {
//     private ws: WebSocket | null = null;
//     private recordingProcess: any = null;
//
//     public start(): void {
//         console.log(`🔌 Подключение к VoiceGateway: ${SERVER_URL}...`);
//         this.ws = new WebSocket(SERVER_URL);
//
//         // ВАЖНО: Настраиваем прием бинарных данных как Buffer
//         this.ws.binaryType = 'nodebuffer';
//
//         this.ws.on('open', () => {
//             console.log('🟢 [Client] Успешно подключено к серверу!');
//             this.startMicrophone();
//         });
//
//         this.ws.on('message', (data: WebSocket.RawData) => {
//             try {
//                 const payload = JSON.parse(data.toString());
//                 this.handleServerEvent(payload);
//             } catch (err) {
//                 console.error('⚠️ [Client] Ошибка парсинга ответа от сервера:', err);
//             }
//         });
//
//         this.ws.on('close', () => {
//             console.log('🔴 [Client] Соединение с сервером закрыто.');
//             this.stop();
//         });
//
//         this.ws.on('error', (err) => {
//             console.error('❌ [Client] Ошибка WebSocket:', err);
//             this.stop();
//         });
//     }
//
//     // private startMicrophone(): void {
//     //     console.log('🎙️ [Client] Запуск записи с микрофона (SoX)... Скажите что-нибудь!');
//     //
//     //     // Запускаем SoX через утилиту node-record-lpcm16
//     //     this.recordingProcess = recorder.record({
//     //         sampleRate: 16000,
//     //         channels: 1,
//     //         audioType: 'raw', // Передаем чистый PCM без WAV-заголовка
//     //         recorder: 'sox',  // Используем SoX в PulseAudio/PipeWire
//     //     });
//     //
//     //     const stream = this.recordingProcess.stream();
//     //
//     //     // Пробрасываем байты от SoX напрямую в WebSocket
//     //     stream.on('data', (chunk: Buffer) => {
//     //         if (this.ws && this.ws.readyState === WebSocket.OPEN) {
//     //             this.ws.send(chunk);
//     //         }
//     //     });
//     //
//     //     stream.on('error', (err: any) => {
//     //         console.error('⚠️ [Client] Ошибка аудиозаписи SoX:', err);
//     //     });
//     // }
//
//
//     private startMicrophone(): void {
//         console.log('🎙️ [Client] Запуск записи с микрофона... Скажите что-нибудь!');
//
//         this.recordingProcess = recorder.record({
//             sampleRate: 16000,
//             channels: 1,
//             audioType: 'raw',        // Чистый PCM без WAV заголовка
//             recorder: 'rec',         // Или 'arecord'
//             threshold: 0,            // Отключаем внутреннюю отсечку SoX
//             // Передаем параметры формата прямо утилите rec/sox:
//             // -e signed-integer (знаковое целое)
//             // -b 16 (16 бит)
//             // -L (Little Endian)
//             extraArgs: ['-e', 'signed-integer', '-b', '16', '-L']
//         });
//
//         const stream = this.recordingProcess.stream();
//
//         stream.on('data', (chunk: Buffer) => {
//             if (this.ws && this.ws.readyState === WebSocket.OPEN) {
//                 this.ws.send(chunk);
//             }
//         });
//
//         stream.on('error', (err: any) => {
//             console.error('⚠️ [Client] Ошибка аудиозаписи:', err);
//         });
//     }
//
//
//     private handleServerEvent(payload: any): void {
//         switch (payload.event) {
//             case 'stt_processing':
//                 console.log('⏳ [Server] Фраза захвачена VAD, запуск Whisper...');
//                 break;
//
//             case 'stt_result':
//                 console.log(`\n🗣️ [Результат] (${payload.executionTimeMs} мс): "${payload.text}"\n`);
//                 break;
//
//             case 'error':
//                 console.error('❌ [Server Error]:', payload.message);
//                 break;
//
//             default:
//                 console.log('📩 [Server Event]:', payload);
//         }
//     }
//
//     public stop(): void {
//         if (this.recordingProcess) {
//             this.recordingProcess.stop();
//             console.log('🛑 [Client] Микрофон остановлен.');
//         }
//         if (this.ws) {
//             this.ws.close();
//         }
//         process.exit(0);
//     }
// }
//
// // Точка входа для запуска
// const client = new VoiceCliClient();
// client.start();
//
// // Корректная обработка Ctrl+C
// process.on('SIGINT', () => {
//     console.log('\nОстановка клиента...');
//     client.stop();
// });

