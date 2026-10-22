# Serenity · 声形之间

**[在线体验 / Play online](https://laiyutao.github.io/serenity-web/)** · [GitHub](https://github.com/LaiYutao/serenity-web)

详细图文说明：[中文 PDF](assets/manual/Serenity-User-Guide-ZH.pdf) · [English PDF](assets/manual/Serenity-User-Guide-EN.pdf)。网页右上角「？」也可下载与当前语言对应的版本。

[LaiYutao 的 Serenity](https://github.com/LaiYutao/Serenity-a-game-of-audio-visual-meditation) 的浏览器 JavaScript 移植。原生 HTML / CSS / JavaScript、Canvas 2D 与 Web Audio，无运行时第三方依赖，不需要后端服务。

## 运行

安装 Node.js 20 或更新版本后，在本目录执行：

```sh
npm start
```

打开 http://127.0.0.1:4173 。点击「开始」开启音频，也可直接载入三个场源的示例。静态文件也可部署到普通静态托管服务。ES modules 需要通过 HTTP 服务加载，请勿直接双击 HTML。

右上角「中 / EN」即时切换中英文，包括操作指南、状态、选区和错误提示。默认中文，语言偏好保存在当前浏览器中；切换语言不会重置波场、声音模式、参数或取声选区。

```sh
npm test
```

## 操作

点击画布定位，双击或点击「在此处种下」种植。点击已有场源后，滑块修改该场参数；空位置的滑块控制下一颗场源。触屏使用点击定位和侧栏按钮。

声音默认取自全局。在「聆听画面」中点击「框选取声」，再在画布上连续拖出多个矩形，每次拖动新增一个选框，保留已有选框。两种音乐模式和音高强度条统计所有选框覆盖的叠加高度，重叠部分只统计一次，权重按实际覆盖的格点数计算。框外场源传播进框内的波仍会被听见。可反向拖动；点击「完成框选」或按 Esc 返回种植操作，保留全部已有选区。之后可点击「添加选区」继续框选。「恢复全局」移除全部选框；取消拖动仅撤销当前未完成的框。清空画面或载入示例时恢复全局取声。鼠标和触屏均可框选。

| 按键 | 操作 |
| --- | --- |
| WASD | 以原作每秒 5 格的速度移动 |
| J / K | 种下圆形 / 螺旋场 |
| 按住 J + W / S | 调整选中场振幅 |
| 按住 K + W / S | 调整选中场频率 |
| J + K | 切换音乐模式 |
| M | 静音 |
| O | 录入；直录时再次按下停止 |
| P / 空格 | 暂停 / 继续实时场，已有音轨继续播放 |
| R | 清空 |
| X | 停止并回到开始页 |
| Esc | 退出滚轮控制；未选中控件时结束框选 |

单击滑条或旋钮即可选中，用橙色描边提示；鼠标移开后仍可用滚轮调节。按住任意一侧 Shift 可再慢十倍，整数或固定档位参数会累计到有效步长后变化。点击其他位置或按 Esc 退出，恢复页面滚动。单击滑条只选中，不会跳动把手；按住拖动仍直接调节，不显示选中框。旋钮双击恢复默认值，键盘方向键也可调整。

## 音轨与效果器

- 「叠场」保存当前场与取声选区的独立声音演变；「直录」记录当前画面的实时声音，可以边录边调整参数。录入不包含已有音轨。
- 下方每页显示三轨。点击音轨，在右侧调整静音、独听、音量、时间遮罩和音高范围。音量 100 为原响度，可调至 200。
- 新录入的叠场音轨在秒数与循环标识之间有一个实心三角形。单击可唤回录入时的场、取声框、发声模式及波形，替换当前场；已有音轨继续独立播放，后加的音轨速度、遮罩和效果不会写回场。直录音轨不提供此功能。
- 每轨的 Normal 与 Stretch 各自记住 0.25–4× 的数值，并始终同时生效。Normal 同时改变速度和音高，Stretch 在此基础上只改变速度；按钮只选择正在编辑的参数，切换不改变声音或播放位置。最终速度为两者相乘，例如 Normal 2×、Stretch 0.5× 会保持原节奏、音高升高八度。工程文件保留两个数值；直录在极端倍率下可能有时间伸缩的音色变化。
- Filter 提供 Cutoff、Reso、Env Mod、Decay；Delay 提供 Time、Feedback、Mix、Tone；Fade 提供 In Time、In Curve、Out Time、Out Curve；Drive 提供 Drive、Fuzz、Tone、Mix。四组独立保存且可以同时开启，切换标签只切换控制页。调整旋钮会启用当前组，电源键旁通当前组。
- Drive 位于 Filter 之前：Drive 调节失真强度，Fuzz 从柔和饱和过渡到更硬、更毛躁的削波，Tone 调节明暗，Mix 混合原声与效果声。默认关闭，调整旋钮会开启；工程保存、实时与循环导出均包含此效果。
- Fade 每个音轨周期从零渐入、向零渐出。Time 按周期比例保存，显示为实际时长，变速后跟随周期；Curve 的 Lin 为线性，正负值连续改变弯曲程度。谱图橙线显示启用的包络。Fade 不裁剪、不拉伸音轨，也不改变循环长度和 Mask；它同时作用于本轨干声与回声。两端渐变重叠时会平滑相乘，中间音量也可能降低。
- 上方速度控制实时画面及对应声音。负速度反转当前波场的演变方向，不撤销场源操作，也不影响已有音轨。
- 「启动 / 暂停」只控制实时画面与其声音；已录音轨继续播放。
- 按 Record 后，继续演奏或直录前，重新点击上方「十二音」或「微分音」发声模式。

## 音频导出

音轨计数左侧的下载键提供两种 WAV 导出：

- **实时导出**：点击开始收录当前听到的混音，包括实时场、已有音轨及演奏中的参数变化；再点下载键停止并下载，最长 10 分钟。
- **循环导出**：选择起点音轨，复制当前音频状态，离线计算从它下一轮起点开始的共同周期。只导出已有音轨，保留开始时的速度、音量、遮罩和 Drive / Filter / Delay / Fade，无需等待音乐正常播完。计算期间锁定音轨编辑；再点下载键会取消计算，不下载半成品。

循环导出计算全部分页中的可听音轨。共同周期超过 10 分钟时，面板明确标注截断，导出前 10 分钟音频，文件名包含 `truncated`。微分音载波与效果尾音不保证首尾无缝。音轨只保留在当前页面；WAV 保存的是声音，不能还原可编辑项目，刷新或关闭前应先导出。

## 与原作的对应及差异

- 以 240 × 150 为基准，根据画面比例调整网格行列数，保持圆形波为正圆；保留 100 ms 模拟步长、波速 10 格/秒、13 档字符灰度，以及圆形/螺旋场、多层高度叠加。负数采用 C++ 的绝对值四舍五入方式。
- 用网格到场源的距离判断激活，替代密集射线捕捉；因此不会完全复刻射线的漏点、离散相位误差。场源参数变更依旧以波速传播，前沿外的介质保留旧参数。
- 螺旋角相位来自原来的 `10.05 / frequency` 延迟公式，先做代数约分。频率为零时冻结各点当时的相位；零振幅会真正归零。统一全局时间基准，修复原实现创建时间与相位计算混用的问题。
- 音簇使用全部十二个音高，按各高度档位占总网格的比例混合，不再只取原作占比最高的五档。零高度档保持静默，未出现的高度档不发声。基音外保留 0.1、0.056、0.042、0.037 四个泛音权重。
- UI「微分音」对应原作的「微分白噪音」：高度分布加权音高后的正弦波，非随机白噪音。
- Web Audio 原生振荡器在音频线程持续运行，音量与频率平滑过渡；替代原作逐帧 70 ms PCM 片段，减少咔哒声。保留音高映射与谐波比例，但音频连续性、音色细节与 Windows 版不完全相同。
- 原仓库缺少封面引用的 `txtfile/` 素材，因此重做了网页开始页和操作指南。
- 增加暂停、可调音量、示例场景、触屏控制；切到后台自动停止模拟并淡出音频，返回后继续。最多同时 32 个场源，避免无界内存增长。
- Canvas 支持自适应显示。实际性能取决于设备与场源数；此版本优先保持原作 10 Hz 更新节奏。

## 部署

仓库通过 GitHub Actions 部署到 GitHub Pages。推送到 `main` 后先运行测试，通过后只发布网页所需的 HTML、CSS、JavaScript 和许可证。也可以在 Actions 中手动运行 `Test and deploy to GitHub Pages`。仓库 Settings → Pages 的发布来源应为 GitHub Actions。

## 文件

- `simulation.js`：场源、传播、叠加、灰度量化和音乐映射。
- `audio.js`：音簇和加权频率正弦波的 Web Audio 合成。
- `app.js`：Canvas 渲染、交互和模拟时钟。
- `server.js`：仅用于本地预览的零依赖静态服务器，监听本机地址。
- `tests/simulation.test.js`：传播、叠加、参数边界、音乐映射和重置测试。

原作及本移植遵循 MIT 许可，保留原作者版权声明。

### 工程存档 / Project files

下载键弹窗中的 **保存工程** 会下载一个 `.serenity` 文件，包含当前场、场源历史与框选区域、原始及处理后的音频、每轨速度与 Normal/Stretch、音量、静音/独奏、Mask、Drive/Filter/Delay/Fade 参数，以及叠场音轨的可唤回场快照。

点击下载键旁的 **上传键**，选择工程文件即可继续编辑。文件在本地读取，不会上传到服务器。打开会替换当前现场，以暂停状态恢复播放位置和各轨的错开关系；按播放继续。效果尾音从头建立。正在录制、处理音轨或导出时，请先结束该操作再存档或打开工程。工程格式带版本检查，单文件上限 768 MB。

Choose **Save project** in the download dialog to save a self-contained `.serenity` file. The adjacent **upload** button opens it locally, replacing the session and restoring the field, editable audio, track settings, field-recall snapshots and relative playback positions. Projects load paused; press play to continue. Effect tails restart. Finish recording, track processing or export before saving/opening. Files are version checked and limited to 768 MB; no server upload is involved.

### Step 采样与基础音色 / Step sampling and timbres

上方速度区的 **Normal / Step** 与下方音轨速度模式横向对齐，各自记住独立数值，且两个参数始终同时生效。按钮只切换正在编辑的参数，不启停采样、不重置采样时钟或声音相位。Normal 控制场的演变速度、方向及整体音高；Step 只调画面转成声音的采样疏密，沿用 Normal 的画面速度。Step 范围为 0.05×–4×，滑条采用对数刻度。1× 每个模拟帧取一次，0.25× 每四帧取一次，0.05× 每二十帧取一次；取样之间保持上次声音参数，形成阶梯变化。它改变的是声音控制数据的更新间隔，不是 WAV 的音频采样率。叠场音轨、场唤回和工程文件均保留此设置。

波形菜单新增两个基础短音色：**气泡 / Bubble** 以基音为主，圆润、短促；**电弦 / Electric** 参考 CC0 FreePats 单音清音电吉他的泛音和衰减，使用带延音的弦振动模型。两者跟随声音采样帧：Bubble 保留不超过 90 ms 的短尾音；Electric 在新帧之间平滑衔接，保留弦的主体，并在约 6 ms 内跟随新的声音强度。Electric 建议从 Normal 1×、Step 0.5× 开始试听（仍是两个独立参数）；已校准常用速度下的响度，避免必须调到 4× 才能听清。旧工程中的 Pluck 作为 Bubble 兼容读取。支持十二音／微分音、直录／叠场、音轨处理及音频导出。

The upper **Normal / Step** bank aligns with the track tempo bank. Normal keeps the existing field speed/direction/pitch control. Step changes only how densely the field is sampled for sound, holding the last values between samples. Step spans 0.05×–4× on a logarithmic slider. At 1× it samples every simulation frame; at 0.25× every four frames; at 0.05× every twenty frames. Both parameters remain active and remember their values. The buttons only select which parameter to edit; switching does not reset sampling or audio phase. This changes control updates, not the audio file sample rate. **Bubble** emphasizes the fundamental for a round, short tone. **Electric** uses modal amplitudes and decay times informed by CC0 FreePats isolated clean-guitar notes. Bubble keeps its 90 ms tail; Electric sustains between sampled frames, reconnects smoothly and tracks new intensity in about 6 ms. Try Normal 1× / Step 0.5× as an Electric starting point; the parameters remain independent. Both stay audible at normal speeds. Legacy Pluck projects remain readable as Bubble. The timbres survive field capture and project storage.

Electric 单音参考 / isolated-note reference: [FreePats FSBS Clean Electric Guitar](https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html), bridge-pickup B4, CC0. The app synthesizes the voice; reference recordings are not bundled.
