# CW 手键练习器（cw-practice）

一个纯前端的**摩尔斯电码（CW）直键练习器**：把你的 USB HID 直键练习器（系统认成鼠标）
当手键用，软件自动识别你拍出的点划、与你选定的报文逐字比对，并在证据变多时**回改前面
判断有误的字符**。

- 零运行时依赖：HTML + CSS + ES Module，直接部署成 GitHub Pages 就能用
- 自适应时序：不写死“小于 80ms 算点”，而是在线估计你的点长/划长/手抖幅度
- 全局最优解码：每按一下都对整段重跑一次 Viterbi（动态规划）分割，线上与复核同一套逻辑
- 课程内容都是有意义的报文/词组/缩略语（带中文含义），不是随机字母
- 逐字提示摩尔斯码：发对变绿、发错变红、还没落定画成斜体待定

## 快速开始

```bash
pnpm install          # 装开发依赖（只有 vite / typescript / @types/node）
pnpm dev              # 开发服务器，默认 http://localhost:5173
pnpm test             # 核心逻辑单元测试（Node 原生，零依赖，36 个用例）
pnpm build            # tsc 类型检查 + vite 打包到 dist/
pnpm build:nodeps     # 零依赖构建（只用 Node，见下文“为什么有两套构建”）
pnpm verify:dist      # 产物自检：路径/依赖是否能在子目录下正常部署
pnpm test:smoke       # 无浏览器冒烟测试：用最小 DOM 桩把产物真跑一遍
pnpm test:audio       # 离线渲染侧音波形，断言点划长度与段数
pnpm serve            # 用零依赖静态服务器预览 dist（默认 8080）
pnpm test:browser     # 用无头 Chrome 真点真拍并截图（见“浏览器实测”）
```

打开页面后：**课程**里选一课 → **练习** → 点「开始」（或按 `Esc`）→ 像拍真直键一样点击。

没有硬件也能练：鼠标左键/右键、键盘 `空格` `J` `K` `回车` 都可以当直键。
`Esc` 开始/停止，`R` 听当前条目的标准参考发送，`N` 下一条。

## 自动化测试与“截图验收”

四层，全部零依赖（不引入 puppeteer/playwright）：

| 命令 | 做什么 |
| --- | --- |
| `pnpm test` | 引擎行为规格（拍错不放过、前缀不判错、50~250ms 手速自适应）+ 码表、课程、进度 |
| `pnpm test:smoke` | 构建产物 + 最小 DOM 桩，真跑一遍 App：路由、渲染、拍一段字、结算弹窗（26 项断言） |
| `pnpm test:audio` | `OfflineAudioContext` 离线渲染，断言一个点只响 100ms、PARIS 响 14 段 |
| `pnpm test:browser` | 用 CDP 驱动无头 Chrome 打开页面，真点按钮、真按空格拍键，截图并断言（25 项） |

`pnpm test:browser` 需要先起静态服务器：

```bash
node scripts/serve.mjs dist 8123      # 另开一个进程
pnpm test:browser                     # 截图输出到 .shots/
CW_URL=https://lionnatsu.github.io/cw-practice/ pnpm test:browser   # 也可以直接测线上
```

它会检查：页面不是空白、无 JS 报错、开始状态、**判对的字是不是真的变绿**（读 computed
style 比对 rgb 值）、按住时发报条是不是真的长出来、拍错是不是真的给红问号、
成绩弹窗有成绩、报文里能看出分词，并留下 12 张截图（帮助/练习/开始/按住/拍对/拍错/
结算/课程/长报文/设置/统计）。

> 之所以做这些，是因为踩过一次真实的坑：线上白屏了两轮，第一轮是 Pages 发的是仓库根
> 目录而不是构建产物，第二轮是产物里残留 `src="/./main.js"`（绝对路径 → 子目录下 404）。
> 现在 `scripts/verify-dist.mjs` 和 CI 里的产物自检会拦住这类问题。

## 它是怎么“听懂”手键的

全部判定都在 `src/core/practice.ts` 一个文件里，别处不再判。练习是**串行**的：
目标字从左到右，一次只发一个字。

### 1. 按你自己的长短读码

按键本身不判定，只记下时长。判定发生在停顿：静音超过 `symbolGapMax`（2.5 个单位）
就认为这个字发完了。

这时才把这次尝试整段读一遍。读法是**枚举说得通的单位时长假设**，各自算一个代价：

- 每个码元要么是 1 个单位（点）、要么是 3 个单位（划），取更像的那个；
- 段内间隔应当接近 1 个单位；
- 离起始速度越远代价越高。

候选的单位来自这次尝试自己的时长和间隔，再加上“目标字本该发几个单位”这个提示。
代价最低的假设胜出。所以起始速度设得不准也不致命：第一两个字之后，
点长就跟着你的手走了。

### 2. 宁可多等，不误判

断字用的是**最宽松的那个说得通的假设**，而不是最优假设。刚开始拍时点划还分不清，
一个 540ms 的按键既可能是慢的点、也可能是快的划；这时急着断字，就会出现
“字没拍完就给负反馈”。宽松一点只是多等一会儿，误判却会把人打回去重拍。

### 3. 一个字只有整个读对才收下

- 读出来正好是目标字 → 收下。**只要码形凑齐就立刻收**，不必等停顿，所以手感是跟手的；
- 读出来不是目标字 → 不认，给一次负反馈（“对方听到的是 X”），原地重发；
- 拍错的字不前进、不跳过。全对才走完。

## 关于硬件与精度（重要）

- USB 鼠标类 HID 最快 8ms（全速）或 1ms（高速）上报一次，再经系统与浏览器处理，
  一次按键的时长误差大约 ±8~16ms。
- 12 WPM（点长 100ms）下完全够用；25 WPM 以上（点长 48ms）量化台阶相对点长就变大了，
  识别开始变糙。真要高速高精度，需要能上报真实时间戳的串口/键盘设备。
- 程序监听的是 `mousedown` / `mouseup`（不是 `click`），所以系统双击检测不会干扰计时。
- 输入只丢弃短于 18ms 的脉冲。低于它的按键根本不像人按的，而丢一个点就是丢一个码元。
- 设置页最下面有一个**校准台**：连拍几十下，可以直接看到自己的点长、划长。

## 目录结构

```
index.html            页面骨架（顶部 tab + #view 容器）
src/styles.css        全部样式（深色、等宽字体）
src/main.ts           入口：装配 App、路由、各视图
src/App.ts            全局状态宿主（设置、进度、音频、当前引擎）
src/core/             ← 与 UI 完全解耦，可在 Node 里直接测
  types.ts            公共类型
  morse.ts            码表 + 前缀树 + prosign
  practice.ts         练习引擎：读码、判定、速度估计、成绩单（唯一判定来源）
  lessons.ts          课程内容（词组、缩略语、QSO，带中文含义）
  audio.ts            侧音 + 参考发送（Web Audio 调度）
  settings.ts         设置与进度的 localStorage 持久化
  util.ts             小工具
src/ui/               ← 视图与输入
  input.ts            鼠标/键盘 → 带精确时长的按下/抬起事件
  dom.ts              极简 h() 渲染助手 + toast
  practice-view.ts    练习主界面
  lessons-view.ts     课程浏览 + 码表速查
  stats-view.ts       统计（逐字符错误率、课程记录、导入导出）
  settings-view.ts    设置 + 手键校准台
  help-view.ts        帮助
tests/engine.test.ts  引擎行为规格：判定、分段、手速自适应（node:test，零依赖）
tests/core.test.ts    外围：码表、课程内容、设置与进度、整段收发
tests/helpers.ts      按标准节奏把码形“拍”成按键序列
tests/dom-smoke.mjs   最小 DOM 桩跑构建产物
tests/audio-check.mjs 离线渲染侧音波形做检查
tests/screenshot.mjs  CDP 驱动无头 Chrome 真拍真截图
scripts/build.mjs     零依赖静态站点构建
```

## 为什么有两套构建

- `pnpm build`：标准的 Vite 打包（会做压缩、tree-shaking、内容哈希），产物最优。
- `pnpm build:nodeps`：只用 Node 的 `stripTypeScriptTypes` 把 `src/**/*.ts` 转成
  `dist/**/*.js`，把 `./x.ts` 改写成 `./x.js`，再改写 `index.html` 的引用。
  产物是**未压缩的原生 ES Module**，浏览器直接能跑。

后者的存在有实际原因：某些受限环境禁止 Node spawn 带管道的子进程，Vite/esbuild 会直接
`Error: spawn EPERM` 起不来；而这个脚本只用文件系统 API。GitHub Pages 的 workflow
用的就是它。另外 `pnpm install` 里 esbuild 的 postinstall 也只是一次自我校验，
在那种环境下失败不影响使用（原生二进制已由平台包放好），所以 `pnpm-workspace.yaml`
里把 `allowBuilds.esbuild` 设成了 `false`。

## 部署

仓库自带 `.github/workflows/pages.yml`：推到 `main` 后先跑核心测试，再零依赖构建，
最后发布到 GitHub Pages（纯静态、无后端）。

## 已知取舍 / 后续可做

- 判定是“每次停顿读一次这次尝试”，开销与一次尝试的码元数成正比，与报文总长无关。
- 起始速度设得离实际太远时，第一个字可能是读不准的（尤其 E / T 这种单码元的字）。
  引擎会用“目标字本该发几个单位”做提示来自救，但把设置里的速度调到接近自己的手速最省事。
- 只对空格做了分词，标点与过程信号（AR、SK 等）还没进课程。
- 输入只支持直键；桨式（paddle / iambic）需要另做一层“设备自己生成点划”的输入。
