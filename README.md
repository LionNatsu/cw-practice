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
pnpm test             # 核心逻辑单元测试（Node 原生，零依赖，19 个用例）
pnpm build            # tsc 类型检查 + vite 打包到 dist/
pnpm build:nodeps     # 零依赖构建（只用 Node，见下文“为什么有两套构建”）
pnpm verify:dist      # 产物自检：路径/依赖是否能在子目录下正常部署
pnpm test:smoke       # 无浏览器冒烟测试：用最小 DOM 桩把产物真跑一遍
pnpm serve            # 用零依赖静态服务器预览 dist（默认 8080）
pnpm test:browser     # 用无头 Chrome 真点真拍并截图（见“浏览器实测”）
```

打开页面后：**课程**里选一课 → **练习** → 点「武装手键」（或按 `Esc`）→ 像拍真直键一样点击。

没有硬件也能练：鼠标左键/右键、键盘 `空格` `J` `K` `回车` 都可以当直键。
`Esc` 武装/解除，`R` 听当前条目的标准参考发送，`N` 下一条。

## 自动化测试与“截图验收”

三层，全部零依赖（不引入 puppeteer/playwright）：

| 命令 | 做什么 |
| --- | --- |
| `pnpm test` | 核心算法单测：时序模型收敛、抖动 ±18% 下的解码、不同手速自适应、回改行为、对齐计分、性能预算 |
| `pnpm test:smoke` | 构建产物 + 最小 DOM 桩，真跑一遍 App：路由、渲染、拍一段字、结算弹窗（25 项断言） |
| `pnpm test:browser` | 用 CDP 驱动无头 Chrome 打开页面，真点按钮、真按空格拍键，截图并断言 |

`pnpm test:browser` 需要先起静态服务器：

```bash
node scripts/serve.mjs dist 8123      # 另开一个进程
pnpm test:browser                     # 截图输出到 .shots/
CW_URL=https://lionnatsu.github.io/cw-practice/ pnpm test:browser   # 也可以直接测线上
```

它会检查：页面不是空白、无 JS 报错、武装状态、**判对的字是不是真的变绿**（读 computed
style 比对 rgb 值）、判错是不是真的变红、诊断面板有记录、结算弹窗有成绩，并留下 10 张
截图（帮助/练习/武装/拍对/拍错/结算/课程/设置/统计）。

> 之所以做这些，是因为踩过一次真实的坑：线上白屏了两轮，第一轮是 Pages 发的是仓库根
> 目录而不是构建产物，第二轮是产物里残留 `src="/./main.js"`（绝对路径 → 子目录下 404）。
> 现在 `scripts/verify-dist.mjs` 和 CI 里的产物自检会拦住这类问题。

## 它是怎么“听懂”手键的

三层结构，都在 `src/core/`：

### 1. 自适应时序模型（`timing-model.ts`）

维护最近 64 次按键，每次都用当前模型对它们重新做一次 **2-means 聚类**，
得到“点长、划长”以及各自的相对标准差 σ。

为什么不能只做指数滑动平均：一旦某次分类把 150ms 的“点”误判成“划”，这个错误会被
直接吸收进划长的估计，模型越跑越歪（实测会把点划合并）。整体重估让误差不会自我强化，
点划本来就重叠时也能如实反映（σ 变大、置信度降低，而不是硬判）。

### 2. 全局最优分割（`decoder.ts`）

每按一下，对**到目前为止的全部按键**重跑一遍动态规划：

```
dp[i] = 前 i 个按键解析完、且恰好以一个字符结尾的最小代价
转移  = dp[start] + 码元似然(start..end) + 字内间隔代价 + 断字代价 + 收尾代价
```

- 码元似然：对数正态，来自第 1 层的自适应参数
- 间隔代价：三种间隔（1/3/7 个单位）各用一个对数正态去比较，取相对最优的差值，
  保证量级和码元似然可比（早期版本这里用固定常数，结果“断字代价”被 40 nat 的
  码元似然彻底淹没，整句会被认成一串 E）
- 收尾代价：必须有（否则“把两个字符拼成一个更长的码字”因为不用收尾而显得更便宜）
- 语料偏置：课程里出现过的字符有一点点优惠，用来打破 `PARIS` vs `P+5` 这类平局

### 3. 可回改的落账（`decoder.ts` 的 `updateCommitted`）

维护最近 6 轮的解释，取它们的**最长公共前缀**作为“已落账”的内容；
公共前缀变短时，已落账的字会被自动撤回/改写，UI 上提示 `已回改前面第 N 个字符：T → 5`。
抄收区里的斜体字就是“还没落定、随时可能变”的部分。用户一停顿（默认 3.5 个单位时间，
可在设置里调），整条最优解释立刻全部落定。

### 附：为什么“停顿”很重要

CW 里字符之间是靠静音长度区分的（1 / 3 / 7 个单位 = 码元内 / 字符间 / 词间）。
停顿既是解码证据，也是“空格”的来源 —— 你不需要真的把空格发出来。

## 关于硬件与精度（重要）

- USB 鼠标类 HID 最快 8ms（全速）或 1ms（高速）上报一次，再经系统与浏览器处理，
  一次按键的时长误差大约 ±8~16ms。
- 12 WPM（点长 100ms）下完全够用；25 WPM 以上（点长 48ms）量化台阶相对点长就变大了，
  识别开始变糙。真要高速高精度，需要能上报真实时间戳的串口/键盘设备。
- 程序监听的是 `mousedown` / `mouseup`（不是 `click`），所以系统双击检测不会干扰计时。
- 设置页最下面有一个**校准台**：连拍几十下，可以实时看到点长/划长/σ/误判概率的收敛情况，
  识别不准时先看这里。

## 目录结构

```
index.html            页面骨架（顶部 tab + #view 容器）
src/styles.css        全部样式（深色、等宽字体）
src/main.ts           入口：装配 App、路由、各视图
src/App.ts            全局状态宿主（设置、进度、音频、当前会话）
src/core/             ← 与 UI 完全解耦，可在 Node 里直接测
  types.ts            公共类型
  morse.ts            码表 + 前缀树 + prosign
  timing-model.ts     自适应点划模型（2-means 重估、置信度）
  decoder.ts          全局最优分割 + 可回改落账
  alignment.ts        解码结果与目标文本的编辑距离对齐 + 成绩汇总
  session.ts          会话编排（按键 → 模型 → 解码 → 对齐 → 快照）
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
tests/core.test.ts    核心逻辑测试（node:test，零依赖）
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

- 解码是“每键一次全段重算”，几百个按键的报文平均每键约 1~3ms（见性能测试），
  但如果将来要练上千字符的超长报文，需要改成滑动窗口或增量 Viterbi。
- 输入键位目前是内置的（空格/J/K/回车），设置页还没有自定义键位。
- 只支持直键模式；桨式（paddle / iambic）需要改成“点划由设备自动生成”的另一套输入层。
