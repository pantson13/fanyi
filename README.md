# 本地 AI 视频字幕（iPhone Safari / GitHub Pages 原型）

这是一个纯前端原型：从 iPhone / iPad 的“文件”选择本地视频，在 Safari / PWA 内播放，读取播放出来的声音，使用浏览器本地 AI 做英文语音识别和英→中翻译，再把字幕叠在视频上。

## 当前版本做到了什么

- 本地选择视频，不上传视频文件
- 网页内播放
- Web Audio 捕获正在播放的视频声音
- Whisper Tiny English（Transformers.js）本地英文识别
- OPUS-MT EN→ZH（Transformers.js）本地中文翻译
- 中英双语 / 仅中文 / 仅英文
- 字幕字号和位置调节
- 3 / 5 / 8 秒识别分段
- 推理队列积压时可自动暂停视频
- PWA，可添加到 iPhone 主屏幕
- CSS 影院模式，避免调用 iPhone 原生全屏播放器后丢失网页字幕

## 重要限制

1. **首次使用需要联网下载 AI 模型**。模型文件较大，Safari 会缓存可复用的部分文件，但 iOS 可能因为存储压力清理缓存。
2. 第一版是“边播放边识别”，所以字幕会有几秒延迟。不是提前解析整部视频。
3. Safari 最稳妥的视频格式是 MP4（H.264/H.265 视设备支持）+ AAC。MKV、某些编码可能无法直接播放。
4. 本地模型的翻译自然度通常不等同于 GPT / DeepSeek 这类大型云端 LLM。本项目第一版优先验证“完全本地 + iOS 浏览器 + 实时链路”。
5. iPhone 上性能取决于机型、iOS 版本和 WebGPU 支持。若 WebGPU 初始化失败会回退到 WASM，速度可能明显变慢。

## 部署到 GitHub Pages

1. GitHub 新建一个公开仓库，例如 `local-ai-video-translator`。
2. 把本项目目录里的文件全部上传到仓库根目录。
3. 打开仓库 `Settings` → `Pages`。
4. `Build and deployment` 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选 `/ (root)`，保存。
6. 等 GitHub Pages 部署完成后，在 iPhone Safari 打开生成的网址。
7. Safari 点“分享” → “添加到主屏幕”，以后从桌面图标进入。

## iPhone 测试顺序

1. 先选一个 1～3 分钟、英文对白清楚的 MP4。
2. 点“开始实时翻译”。
3. 等待两个模型首次下载并显示“本地 AI 已就绪”。
4. 视频播放后观察字幕。
5. 如果手机明显跟不上，把“识别分段”改成 8 秒，或勾选“队列积压时自动暂停”。

## 技术栈

- HTML / CSS / JavaScript
- Web Audio API
- Web Worker
- Transformers.js
- `onnx-community/whisper-tiny.en`
- `Xenova/opus-mt-en-zh`
- Service Worker / PWA

## 下一版适合做的事情

- 提前解析整部本地视频，不必真实播放后才识别
- 字幕时间轴和历史缓存
- SRT 导入 / 导出
- 更自然的本地小型 LLM 二次润色
- 自动语言检测与多语言翻译
- 断句、重叠语音和人名术语优化
