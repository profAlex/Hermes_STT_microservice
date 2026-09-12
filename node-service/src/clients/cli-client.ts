// tail -f /tmp/voice_node.log - для просмотра логово и дебага
// npm run start:client - для запуска отдельно приложения-клиента
// fuser -k 9999/tcp; pkill -f "cli-client.ts" - для сброса зависшего приложения в порту


import WebSocket from 'ws';
import record from 'node-record-lpcm16';
import { exec } from 'child_process';
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";
import readline from "readline";

// --- КОНФИГУРАЦИЯ ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GATEWAY_WS_URL = process.env.GATEWAY_WS_URL || 'ws://192.168.0.52:8085';
const INJECT_HTTP_URL = process.env.INJECT_HTTP_URL || 'http://127.0.0.1:9999/inject';

const IS_WINDOWS = process.platform === 'win32';

let ws: WebSocket | null = null;
let isRecording = false;

// --- 1. ВСПЛЫВАЮЩИЕ УВЕДОМЛЕНИЯ ОС ---
function showNotification(title: string, message: string): void {
    if (IS_WINDOWS) {
        const psScript = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;
      $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);
      $text = $xml.GetElementsByTagName('text');
      $text[0].AppendChild($xml.CreateTextNode('${title}')) | Out-Null;
      $text[1].AppendChild($xml.CreateTextNode('${message}')) | Out-Null;
      $toast = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Hermes Voice');
      $toast.Show([Windows.UI.Notifications.ToastNotification]::new($xml));
    `.replace(/\n/g, '');

        exec(`powershell -NoProfile -Command "${psScript}"`, (err) => {
            if (err) console.error('[Voice Client] Ошибка Toast в Windows:', err.message);
        });
    } else {
        exec(`notify-send "${title}" "${message}" -t 2000`, (err) => {
            if (err) console.error('[Voice Client] Ошибка notify-send в Linux:', err.message);
        });
    }
}

// --- 2. ОТПРАВКА РАСПОЗНАННОГО ТЕКСТА В PYTHON-ПЛАГИН (IPC HTTP) ---
async function injectTextToHermes(text: string): Promise<void> {


    const trimmedText = text ? text.trim() : '';
    console.log(`[✅ Voice Client injecting message:] ${trimmedText} `);
    if (!trimmedText) return;

    try {
        const response = await fetch(INJECT_HTTP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: trimmedText }),
        });

        if (!response.ok) {
            console.error(`[Voice Client] ❌ Ошибка вставки текста (HTTP ${response.status})`);
        }
    } catch (error) {
        console.error('[Voice Client] ❌ Не удалось связаться с Python-плагином:', (error as Error).message);
    }
}

// --- 3. ИНИЦИАЛИЗА WEBSOCKET СОЕДИНЕНИЯ C GATEWAY ---
function connectWebSocket(): void {
    ws = new WebSocket(GATEWAY_WS_URL);

    ws.on('open', () => {
        console.log('✅ [Voice Client] Успешно подключено к Gateway WebSocket');
    });

    ws.on('message', async (data: WebSocket.RawData) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`[✅ Voice Client Received message...]`);

            // Принимаем финальное событие stt_result или fallback по полю text
            if ((message.event === 'stt_result' || message.type === 'transcription') && message.text) {
                console.log(`💬 [Whisper]: ${message.text.trim()}`);
                await injectTextToHermes(message.text);
            }
        } catch (e) {
            console.error('[Voice Client] Ошибка обработки сообщения от Gateway:', e);
        }
    });

    ws.on('close', () => {
        console.log('⚠️ [Voice Client] WS соединение закрыто, переподключение через 3 сек...');
        setTimeout(connectWebSocket, 3000);
    });

    ws.on('error', (err) => {
        console.error('❌ [Voice Client] Ошибка WS соединения:', err.message);
    });
}

// --- 4. УПРАВЛЕНИЕ АУДИОЗАПИСЬЮ ---
let recordingProcess: any = null;
let recordingStream: any = null;

async function startRecording(): Promise<void> {
    if (isRecording) return;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('❌ [Voice Client] Нельзя начать запись: WebSocket не подключен!');
        return;
    }

    isRecording = true;
    console.log('🎤 [Voice Client] СТАРТ записи');

    // 1. Уведомляем Gateway о начале сессии записи
    ws.send(JSON.stringify({ event: 'start_recording' }));
    showNotification('Hermes Voice', '🎤 Запись начата...');

    // 2. Запускаем запись микрофона
    recordingProcess = record.record({
        sampleRate: 16000,
        channels: 1,
        audioType: 'raw',
        recorder: IS_WINDOWS ? 'sox' : 'rec',
    });

    recordingStream = recordingProcess.stream();

    recordingStream.on('data', (chunk: Buffer) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
        }
    });

    recordingStream.on('error', (err: any) => {
        const errStr = String(err);
        if (errStr.includes('exited with error code null') || errStr.includes('code null')) {
            return;
        }
        console.error('❌ [Voice Client] Ошибка аудиозаписи:', err);
    });
}

async function stopRecording(): Promise<void> {
    if (!isRecording) return;

    isRecording = false;
    console.log('🛑 [Voice Client] СТОП записи, завершение сессии...');

    // 1. Останавливаем процесс записи микрофона
    if (recordingProcess) {
        recordingProcess.stop();
        recordingProcess = null;
        recordingStream = null;
    }

    showNotification('Hermes Voice', '⏳ Обработка в Whisper...');

    // 2. Уведомляем Gateway об остановке записи для запуска Whisper
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'stop_recording' }));
    }
}

// --- 5. ОБРАБОТЧИК КОМАНД ИЗ STDIN ---
function setupStdinListener(): void {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });

    rl.on('line', (line: string) => {
        const command = line.trim().toLowerCase();

        if (command === 'start') {
            startRecording().catch((err) =>
                console.error('[Voice Client] Ошибка старта записи:', err)
            );
        } else if (command === 'stop') {
            stopRecording().catch((err) =>
                console.error('[Voice Client] Ошибка остановки записи:', err)
            );
        }
    });
}

// --- ТОЧКА ВХОДА ---
connectWebSocket();
setupStdinListener();