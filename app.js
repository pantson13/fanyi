const $ = (s) => document.querySelector(s);
const video = $('#video');
const videoFile = $('#videoFile');
const startBtn = $('#startBtn');
const theaterBtn = $('#theaterBtn');
const exitTheaterBtn = $('#exitTheaterBtn');
const emptyState = $('#emptyState');
const statusMain = $('#statusMain');
const statusSub = $('#statusSub');
const statusDot = $('#statusDot');
const progressBar = $('#progressBar');
const modelMetric = $('#modelMetric');
const queueMetric = $('#queueMetric');
const deviceMetric = $('#deviceMetric');
const subtitleLayer = $('#subtitleLayer');
const subtitleEn = $('#subtitleEn');
const subtitleZh = $('#subtitleZh');
const subtitleMode = $('#subtitleMode');
const chunkSeconds = $('#chunkSeconds');
const fontSize = $('#fontSize');
const subtitleBottom = $('#subtitleBottom');
const autoPause = $('#autoPause');
const logEl = $('#log');

let objectUrl = null;
let worker = null;
let workerReady = false;
let translationActive = false;
let audioContext = null;
let mediaSource = null;
let processor = null;
let muteGain = null;
let rawChunks = [];
let rawSamples = 0;
let chunkStartTime = 0;
let idCounter = 0;
let pending = new Map();
let pausedForBacklog = false;
let latestSubtitle = { en: '', zh: '', until: 0 };
let lastModelProgress = 0;

function log(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(main, sub = '', tone = '') {
  statusMain.textContent = main;
  statusSub.textContent = sub;
  statusDot.className = `status-dot ${tone}`.trim();
}

function setProgress(value) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  progressBar.style.width = `${v}%`;
}

function updateQueue() {
  queueMetric.textContent = `队列：${pending.size}`;
  if (autoPause.checked && pending.size >= 3 && !video.paused && !pausedForBacklog) {
    pausedForBacklog = true;
    video.pause();
    setStatus('AI 正在追赶字幕', '队列积压，已临时暂停视频。', 'warn');
  }
  if (pausedForBacklog && pending.size <= 1) {
    pausedForBacklog = false;
    video.play().catch(() => {});
  }
}

function createWorker() {
  if (worker) return;
  worker = new Worker('./ai-worker.js', { type: 'module' });

  worker.onmessage = (event) => {
    const msg = event.data || {};

    if (msg.type === 'MODEL_PROGRESS') {
      const p = Number(msg.progress);
      if (Number.isFinite(p)) {
        lastModelProgress = p;
        setProgress(p);
      }
      const shortName = msg.model?.includes('whisper') ? '语音识别' : '翻译';
      setStatus(`正在准备${shortName}模型`, msg.file ? `下载/缓存：${msg.file}` : '首次使用需要下载模型。', 'warn');
      return;
    }

    if (msg.type === 'STATUS') {
      if (msg.stage === 'loading') setStatus('正在加载本地 AI', msg.message || '', 'warn');
      if (msg.stage === 'recognizing') setStatus('正在听视频声音', '本地 Whisper 正在识别英文。', 'ok');
      if (msg.stage === 'translating') setStatus('正在翻译', '英→中模型正在生成字幕。', 'ok');
      if (msg.stage === 'warning') log(msg.message || 'Worker warning');
      return;
    }

    if (msg.type === 'READY') {
      workerReady = true;
      modelMetric.textContent = '模型：已加载';
      deviceMetric.textContent = `推理：${msg.device === 'webgpu' ? 'WebGPU' : 'WASM'}`;
      setProgress(100);
      setStatus('本地 AI 已就绪', '现在点视频播放，字幕会开始生成。', 'ok');
      startBtn.textContent = translationActive ? '停止翻译' : '开始实时翻译';
      log(`模型加载完成，推理设备：${msg.device}`);
      if (translationActive && video.paused) {
        video.play().catch(() => setStatus('本地 AI 已就绪', '请手动点视频播放按钮开始。', 'ok'));
      }
      return;
    }

    if (msg.type === 'RESULT') {
      const meta = pending.get(msg.id);
      pending.delete(msg.id);
      updateQueue();
      if (!meta) return;

      const current = video.currentTime || 0;
      const hold = Math.max(4.2, Number(chunkSeconds.value) * 0.9);
      latestSubtitle = {
        en: msg.english || '',
        zh: msg.chinese || '',
        until: Math.max(meta.end, current + hold),
      };
      renderSubtitle();
      log(`字幕 #${msg.id} (${(msg.elapsed / 1000).toFixed(1)}s): ${msg.english || '[无语音]'} -> ${msg.chinese || '[无译文]'}`);
      return;
    }

    if (msg.type === 'ERROR') {
      if (msg.id) {
        pending.delete(msg.id);
        updateQueue();
      }
      setStatus('本地 AI 运行失败', '展开运行日志查看错误。可尝试刷新页面或改用较短视频测试。', 'bad');
      log(`ERROR: ${msg.message}`);
    }
  };

  worker.onerror = (event) => {
    setStatus('AI Worker 启动失败', event.message || '浏览器阻止了模型脚本。', 'bad');
    log(`Worker error: ${event.message}`);
  };
}

function initAI() {
  createWorker();
  worker.postMessage({ type: 'INIT' });
}

function renderSubtitle() {
  const active = translationActive && latestSubtitle.until > (video.currentTime || 0) && (latestSubtitle.en || latestSubtitle.zh);
  subtitleLayer.classList.toggle('has-text', !!active);

  const mode = subtitleMode.value;
  subtitleEn.textContent = latestSubtitle.en;
  subtitleZh.textContent = latestSubtitle.zh;
  subtitleEn.classList.toggle('show', active && (mode === 'bilingual' || mode === 'en'));
  subtitleZh.classList.toggle('show', active && (mode === 'bilingual' || mode === 'zh'));
}

function downsample(buffer, inputRate, outputRate = 16000) {
  if (inputRate === outputRate) return buffer;
  if (outputRate > inputRate) return buffer;
  const ratio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function flushAudioChunk() {
  if (!rawSamples || !audioContext || !translationActive || !workerReady) return;
  const combined = new Float32Array(rawSamples);
  let offset = 0;
  for (const part of rawChunks) {
    combined.set(part, offset);
    offset += part.length;
  }
  rawChunks = [];
  rawSamples = 0;

  const pcm16k = downsample(combined, audioContext.sampleRate, 16000);
  const id = ++idCounter;
  const end = video.currentTime || chunkStartTime + combined.length / audioContext.sampleRate;
  const start = Math.max(0, chunkStartTime);
  pending.set(id, { start, end });
  updateQueue();

  worker.postMessage({
    type: 'PROCESS',
    id,
    audio: pcm16k.buffer,
    duration: Math.max(2, end - start),
  }, [pcm16k.buffer]);
}

async function ensureAudioTap() {
  if (audioContext) {
    await audioContext.resume();
    return;
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('当前 Safari 不支持 Web Audio API。');

  audioContext = new AudioContextCtor();
  mediaSource = audioContext.createMediaElementSource(video);
  processor = audioContext.createScriptProcessor(4096, 2, 1);
  muteGain = audioContext.createGain();
  muteGain.gain.value = 0;

  // 正常声音直达扬声器；分析支路静音，避免双重播放。
  mediaSource.connect(audioContext.destination);
  mediaSource.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(audioContext.destination);

  processor.onaudioprocess = (event) => {
    if (!translationActive || video.paused || video.ended || !workerReady) return;

    const input = event.inputBuffer;
    const channels = input.numberOfChannels;
    const length = input.length;
    const mono = new Float32Array(length);

    for (let c = 0; c < channels; c++) {
      const data = input.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }

    if (rawSamples === 0) chunkStartTime = video.currentTime || 0;
    rawChunks.push(mono);
    rawSamples += mono.length;

    const seconds = Number(chunkSeconds.value) || 5;
    if (rawSamples >= audioContext.sampleRate * seconds) flushAudioChunk();
  };

  await audioContext.resume();
  log(`Web Audio 已连接，采样率 ${audioContext.sampleRate} Hz`);
}

async function startTranslation() {
  if (!video.src) return;

  translationActive = true;
  startBtn.textContent = '停止翻译';
  setStatus('正在准备本地 AI', '首次使用需要下载模型，请保持此页面在前台。', 'warn');

  try {
    await ensureAudioTap();
    if (!workerReady) {
      if (!video.paused) video.pause();
      initAI();
    } else if (video.paused) {
      await video.play();
    }
  } catch (error) {
    translationActive = false;
    startBtn.textContent = '开始实时翻译';
    setStatus('无法启动音频分析', error.message || String(error), 'bad');
    log(`Audio setup error: ${error.stack || error}`);
  }
}

function stopTranslation() {
  translationActive = false;
  startBtn.textContent = '开始实时翻译';
  flushAudioChunk();
  rawChunks = [];
  rawSamples = 0;
  latestSubtitle = { en: '', zh: '', until: 0 };
  renderSubtitle();
  setStatus(workerReady ? '翻译已停止' : '等待启动', '视频仍可正常播放。', workerReady ? 'ok' : '');
}

videoFile.addEventListener('change', async () => {
  const file = videoFile.files?.[0];
  if (!file) return;

  stopTranslation();
  pending.clear();
  updateQueue();

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  video.load();
  emptyState.style.display = 'none';
  startBtn.disabled = false;
  setStatus('视频已载入', `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`, 'ok');
  log(`选择视频：${file.name} (${file.type || 'unknown type'})`);
});

startBtn.addEventListener('click', () => {
  if (translationActive) stopTranslation();
  else startTranslation();
});

function setTheater(enabled) {
  document.body.classList.toggle('theater', enabled);
  theaterBtn.textContent = enabled ? '退出影院' : '影院模式';
}

theaterBtn.addEventListener('click', () => setTheater(!document.body.classList.contains('theater')));
exitTheaterBtn.addEventListener('click', () => setTheater(false));

document.addEventListener('dblclick', (event) => {
  if (event.target.closest('.video-wrap')) {
    setTheater(!document.body.classList.contains('theater'));
  }
});

video.addEventListener('seeking', () => {
  rawChunks = [];
  rawSamples = 0;
  latestSubtitle = { en: '', zh: '', until: 0 };
  renderSubtitle();
});

video.addEventListener('pause', () => {
  if (translationActive && !pausedForBacklog) flushAudioChunk();
});

video.addEventListener('ended', () => {
  flushAudioChunk();
  setStatus('视频播放结束', '仍可拖回任意位置继续测试。', 'ok');
});

video.addEventListener('timeupdate', renderSubtitle);
subtitleMode.addEventListener('change', renderSubtitle);
fontSize.addEventListener('input', () => document.documentElement.style.setProperty('--subtitle-size', `${fontSize.value}px`));
subtitleBottom.addEventListener('input', () => document.documentElement.style.setProperty('--subtitle-bottom', `${subtitleBottom.value}%`));

window.addEventListener('beforeunload', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((error) => log(`Service worker: ${error.message}`));
}

const hasWebGPU = !!navigator.gpu;
deviceMetric.textContent = `推理：${hasWebGPU ? '优先 WebGPU' : 'WASM'}`;
log(`WebGPU: ${hasWebGPU ? 'available' : 'not available'}`);
log(`UA: ${navigator.userAgent}`);

setInterval(renderSubtitle, 250);
