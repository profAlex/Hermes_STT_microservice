// import { Readable } from 'stream';
//
// // Имитация источника (микрофона), который шлет куски текста
// function createTextStream(): Readable {
//     const chunks = ["Прив", "ет м", "ир! Как де", "ла? Все ", "отлич", "но!"];
//     return new Readable({
//         read() {
//             if (chunks.length > 0) {
//                 this.push(chunks.shift());
//             } else {
//                 this.push(null); // Конец потока
//             }
//         }
//     });
// }
//
// // ===================================================
// // РУЧНАЯ ЛОГИКА (Аналог нашего изначального VAD)
// // ===================================================
// function processTextManual(stream: Readable) {
//     let accumulator = '';            // Аналог bufferAccumulator
//     const wordQueue: string[] = [];   // Аналог frameQueue
//     let isProcessing = false;         // Аналог isProcessingQueue (мьютекс)
//
//     // Функция-обработчик очереди (Аналог processQueue)
//     const processQueue = async () => {
//         if (isProcessing) return; // Если уже работаем — выходим
//         isProcessing = true;
//
//         while (wordQueue.length > 0) {
//             const word = wordQueue.shift()!;
//
//             // Имитируем асинхронную работу (например, VAD / Запрос к API)
//             console.log(`[Ручной] Начинаю обработку: "${word}"`);
//             await new Promise((r) => setTimeout(r, 500));
//             console.log(`[Ручной] Готово: ${word.toUpperCase()}\n---`);
//         }
//
//         isProcessing = false; // Снимаем замок
//     };
//
//     // Слушатель входящих данных (Аналог onData)
//     stream.on('data', (chunk: Buffer) => {
//         accumulator += chunk.toString();
//
//         // Нарезаем по пробелам
//         const words = accumulator.split(' ');
//
//         // Последний кусок может быть неполным словом — оставляем в аккумуляторе
//         accumulator = words.pop() || '';
//
//         // Все целые слова складываем в НАШУ РУЧНУЮ очередь
//         for (const word of words) {
//             if (word.trim()) {
//                 wordQueue.push(word.trim());
//             }
//         }
//
//         // Запускаем обработку очереди
//         processQueue();
//     });
//
//     stream.on('end', () => {
//         if (accumulator.trim()) {
//             wordQueue.push(accumulator.trim());
//             processQueue();
//         }
//     });
// }
//
// // Запуск
// const stream1 = createTextStream();
// processTextManual(stream1);