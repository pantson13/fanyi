import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';

env.allowLocalModels = false;
env.useBrowserCache = true;

const ASR_MODEL = 'onnx-community/whisper-tiny.en';
const TRANSLATE_MODEL = 'Xenova/opus-mt-en-zh';

let asr = null;
let translator = null;
let device = 'wasm';
let chain = Promise.resolve();

function report(stage, payload = {}) {
  self.postMessage({ type: 'STATUS', stage, ...payload });
}

function progressFor(modelName, p) {
  if (!p || typeof p !== 'object') return;
  const percentage = Number.isFinite(p.progress) ? p.progress : null;
  self.postMessage({
    type: 'MODEL_PROGRESS',
    model: modelName,
    status: p.status || '',
    file: p.file || '',
    progress: percentage,
  });
}

async function createPipeline(task, model, dtype) {
  const preferWebGPU = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (preferWebGPU) {
    try {
      const pipe = await pipeline(task, model, {
        device: 'webgpu',
        dtype,
        progress_callback: (p) => progressFor(model, p),
      });
      device = 'webgpu';
      return pipe;
    } catch (error) {
      report('warning', { message: `WebGPU 初始化失败，改用 WASM：${error?.message || error}` });
    }
  }

  device = 'wasm';
  return pipeline(task, model, {
    device: 'wasm',
    dtype,
    progress_callback: (p) => progressFor(model, p),
  });
}

async function init() {
  if (asr && translator) {
    self.postMessage({ type: 'READY', device });
    return;
  }

  report('loading', { message: '正在加载英文语音识别模型…' });
  asr = await createPipeline('automatic-speech-recognition', ASR_MODEL, 'q8');

  report('loading', { message: '正在加载英→中翻译模型…' });
  translator = await createPipeline('translation', TRANSLATE_MODEL, 'q8');

  self.postMessage({ type: 'READY', device });
}

async function processChunk(msg) {
  if (!asr || !translator) await init();

  const audio = new Float32Array(msg.audio);
  const started = performance.now();

  report('recognizing', { id: msg.id });
  const recognized = await asr(audio, {
    chunk_length_s: Math.max(2, Math.min(12, msg.duration || 5)),
    stride_length_s: 0,
  });

  const english = String(recognized?.text || '').trim();
  if (!english) {
    self.postMessage({ type: 'RESULT', id: msg.id, english: '', chinese: '', elapsed: performance.now() - started });
    return;
  }

  report('translating', { id: msg.id, english });
  const translated = await translator(english, {
    max_new_tokens: 160,
  });

  const chinese = String(translated?.[0]?.translation_text || translated?.translation_text || '').trim();
  self.postMessage({
    type: 'RESULT',
    id: msg.id,
    english,
    chinese,
    elapsed: performance.now() - started,
  });
}

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'INIT') {
    chain = chain.then(init).catch((error) => self.postMessage({ type: 'ERROR', message: error?.stack || error?.message || String(error) }));
  } else if (msg.type === 'PROCESS') {
    chain = chain
      .then(() => processChunk(msg))
      .catch((error) => self.postMessage({ type: 'ERROR', id: msg.id, message: error?.stack || error?.message || String(error) }));
  }
};
