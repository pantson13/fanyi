# 本地 AI 视频字幕

这是一个纯前端 iPhone Safari / GitHub Pages 原型。

功能：
- 选择 iPhone 本地视频，不上传视频文件
- 网页内播放并读取视频声音
- 本地 Whisper 语音识别
- 本地生成中文字幕
- 支持英文声音 → 中文
- 支持日文声音 → 中文
- 双语 / 仅中文 / 仅原文
- 字幕字号、位置、分段长度可调
- 影院模式
- PWA，可添加到 iPhone 主屏幕

## 日文模式

日文模式使用多语言 Whisper：

1. 日语声音 → Whisper 转写为日文原文
2. 同一段声音 → Whisper 本地翻译为英文中间层
3. 英文中间层 → 本地 OPUS-MT 翻译为中文

因此不需要 DeepSeek、GPT 或其他付费 API，也不会上传视频或音频。

日文模式比英文模式多一次 Whisper 推理，所以耗时、发热和电量消耗会更高。若字幕跟不上，可以把“识别分段”设为 8 秒，并保持“队列积压时自动暂停视频”开启。

## 当前模型

- 语音识别：`onnx-community/whisper-tiny`
- 英文→中文：`Xenova/opus-mt-en-zh`
- 运行框架：Transformers.js
- 优先 WebGPU，不可用时回退 WASM

## iPhone 使用

1. GitHub Pages 开启后，用 Safari 打开网页。
2. 点“选择本地视频”。
3. 在“原语言”中选择“英文”或“日文”。
4. 点“开始实时翻译”。
5. 第一次使用会下载本地模型，需要等待。
6. Safari → 分享 → 添加到主屏幕，可作为 PWA 使用。

推荐先用短 MP4 测试，H.264 + AAC 最稳。
