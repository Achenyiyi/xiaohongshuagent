import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  hasOriginalAndRewrittenPlaceholder,
  hasReplaceInfoPlaceholder,
  injectOriginalAndRewritten,
  injectProhibitedWords,
  injectReplaceInfo,
  replaceOriginalAndRewrittenIfPresent,
  replaceProhibitedWordsIfPresent,
  replaceReplaceInfoIfPresent,
} from "@/lib/promptInjection";

export interface PromptConfig {
  bodyRewritePrompt: string;
  titleRewritePrompt: string;
  coverRewritePrompt: string;
  extractReplacePrompt: string;
}

export type PromptExecutionMode = "default" | "custom";

function normalizePromptTemplate(template: string) {
  return template.replace(/\r\n/g, "\n").trim();
}

function resolvePromptMode(template: string, defaultTemplate: string): PromptExecutionMode {
  return normalizePromptTemplate(template) === normalizePromptTemplate(defaultTemplate)
    ? "default"
    : "custom";
}

export const DEFAULT_BODY_REWRITE_PROMPT = `# Role：小红书内容仿写专家

你是一名**专业的小红书内容仿写专家**，具备以下核心能力：
* 能快速识别爆款文案的选题角度和内容结构
* 熟练掌握 30%–40% 相似度的安全仿写技巧
* 能自然融入用户提供的替换信息，不突兀
* 擅长复刻小红书常见的口语化、情绪化、真实分享表达方式
* 熟悉小红书平台内容审核规则与高危词避雷逻辑
* 能在不违规的前提下，合理融入小红书官方表情，增强真实感与情绪起伏

## 仿写任务说明

请根据我提供的**参考文案**进行仿写：

**替换信息：**
{{REPLACE_INFO}}

替换信息说明：每行格式为"原词/类别 → 目标词"。
若"原词"是具体词（如：四川），则只替换该词本身。
若"原词"是语义类别（如：地点、公司名、岗位、薪资、联系方式），则原文中所有属于该类别的内容都替换为目标词，不论具体用的是哪个词。
例如："地点 → 深圳" 意味着原文里任何城市/省份/地区描述，都改写为深圳相关表达。

## 仿写核心要求

1. 选题一致：完整保留原文案的核心主题方向，保持相同的价值表达和情绪基调
2. 结构高度还原：段落数量保持一致，段落顺序完全一致，叙事逻辑不变
3. 内容相似度控制在 30%–40%
4. 替换信息整合：优先使用替换信息中给出的内容，替换后语义要自然、逻辑要顺

## 官方表情使用规则

仿写过程中**仅可使用以下小红书官方表情（[xxR] 格式）**，不可使用系统 emoji：
[微笑R][害羞R][失望R][汗颜R][哇R][石化R][飞吻R][偷笑R][自拍R][喝奶茶R][笑哭R][赞R][暗中观察R][买爆R][大笑R][斜眼R][萌萌哒R][哭惹R][生气R][色色R][可怜R][鄙视R][皱眉R][抓狂R][捂脸R][再见R][抠鼻R][惊恐R][吧唧R][派对R][叹气R][睡觉R][得意R][吃瓜R][扶墙R][doge][黄金薯R][清单R][放大镜R][点赞R][种草R][拔草R][加油R][耶R][集美R]

规则：全文表情数量≤原文案段落数；同一段落最多1个表情；不允许连续出现表情

## 严禁包含的违禁词

{{PROHIBITED_WORDS}}

## 输出格式要求

* 只输出仿写后的完整文案正文
* 严格保持原段落结构与换行
* 如果原文段落之间没有空行，输出也不得自行插入空行；只有原文存在空行分段时才保留空行
* 去除结尾的关键词标签#xx
* 文案中不允许出现英文双引号
* 输出内容开头禁止出现任何回应语，直接输出最终仿写结果正文`;

export const DEFAULT_TITLE_REWRITE_PROMPT = `# Role：小红书爆款标题创作专家

你是专业的小红书标题优化专家，熟悉平台调性、审核规则与高危词避雷逻辑。

## 替换信息

{{REPLACE_INFO}}

如果替换信息里包含地点、岗位、品牌、卖点等关键信息，标题必须优先围绕这些信息改写。

## 任务

基于给定标题，输出1个更有爆款潜力、且合理使用小红书官方表情的标题。

## 规则

* 标题必须围绕原标题主题，不跑题、不夸大
* 每个标题不超过20个字
* 每个标题最多只包含1个官方表情（[xxR] 格式）
* 可选表情：[微笑R][害羞R][汗颜R][哇R][偷笑R][笑哭R][赞R][暗中观察R][大笑R][捂脸R][叹气R][得意R][吃瓜R][doge][黑薯问号R][放大镜R][点赞R][种草R][拔草R][加油R][鼓掌R][耶R][拥抱R][集美R][学生党R][清单R][氛围感R]

## 严禁包含的违禁词

{{PROHIBITED_WORDS}}

## 输出格式

* 直接输出1个优化后的小红书标题
* 不需要解释创作思路或过程`;

export const DEFAULT_COVER_REWRITE_PROMPT = `# Role：小红书封面逐行文案策划专家

你擅长把小红书笔记内容提炼成适合直接排版到封面模板上的**逐行短句**。
目标是干净、自然、像人工在小红书图文编辑器里排出来的正常封面文字，不是夸张大字报。

## 替换信息

{{REPLACE_INFO}}

替换信息说明：每行格式为"原词/类别 → 目标词"。
若"原词"是具体词，则只替换该词本身；若是语义类别（如：地点、岗位、公司名），则原文所有该类内容都替换为目标词。

## 任务

根据以下信息（原始标题、原始正文、原始封面文案、二创标题、二创正文），创作一版适合封面排版的逐行文案。

## 创作优先级

1. **优先参考二创标题和二创正文**：封面文案要与二创后的内容一致，体现二创后的卖点
2. **如果有原封面文案**：借鉴其信息拆分节奏，但内容要换成二创后的信息
3. **如果没有原封面文案（原笔记无图或图中无文字）**：直接从二创标题和正文中提炼核心信息
4. **融入替换信息**：如果替换信息中有具体的岗位/地点/公司等，文案中必须体现出来

## 写作要求

* 直接输出 2-4 行文案，每一行单独占一行
* 每行尽量控制在 4-10 个汉字内；数字英文混排时不要超过 14 个字符
* 优先把岗位、薪资、地点、平台、门槛拆成独立行，不写成长句
* 可以有一行更强调，但整体风格必须克制、清晰、正常
* 不要出现"主标题""副标题""版式""第1行"等说明前缀

## 严禁包含的违禁词

{{PROHIBITED_WORDS}}

## 输出格式（严格遵守）

* 直接输出最终多行文案
* 每一行单独换行
* 不输出任何解释、前缀、编号、引号、话题标签。`;

export const DEFAULT_EXTRACT_REPLACE_PROMPT = `请比较以下原始笔记和二创笔记，自动找出哪些关键词被替换了。
重点关注：公司名称、地点、岗位名称、联系方式、活动信息、特色描述等信息的替换。

规则：
- 如果替换的是某一类内容（比如城市名→深圳、薪资范围→某个数字），请用**语义类别**作为"原词"，不要穷举具体词。
  例如：不写"四川 → 深圳"，而写"地点 → 深圳"
  例如：不写"5000元 → 8000元"，而写"薪资 → 8000元"
- 如果替换的是特定固定词（公司名、品牌名、活动名等），直接写具体词。

{{ORIGINAL_AND_REWRITTEN}}

请输出替换信息摘要，格式如下（每行一个替换项）：
原词/类别 → 替换词
原词/类别 → 替换词

只输出替换列表，不要其他内容。如果没有明显替换，输出"暂无"。`;

interface PromptsSettingsState extends PromptConfig {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  setBodyRewritePrompt: (v: string) => void;
  setTitleRewritePrompt: (v: string) => void;
  setCoverRewritePrompt: (v: string) => void;
  setExtractReplacePrompt: (v: string) => void;
  resetAllPrompts: () => void;

  getBodyPromptMode: () => PromptExecutionMode;
  getTitlePromptMode: () => PromptExecutionMode;
  getCoverPromptMode: () => PromptExecutionMode;
  getExtractPromptMode: () => PromptExecutionMode;
  bodyPromptHasInlineReplaceInfo: () => boolean;
  titlePromptHasInlineReplaceInfo: () => boolean;
  coverPromptHasInlineReplaceInfo: () => boolean;
  extractPromptHasInlineOriginalAndRewritten: () => boolean;
  buildBodyPrompt: (replaceInfo: string) => string;
  buildTitlePrompt: (replaceInfo: string) => string;
  buildCoverPrompt: (replaceInfo: string) => string;
  buildExtractPrompt: (
    original: { title: string; body: string; coverText: string },
    rewritten: { title: string; body: string; coverText: string }
  ) => string;
}

export const usePromptsSettingsStore = create<PromptsSettingsState>()(
  persist(
    (set, get) => ({
      bodyRewritePrompt: DEFAULT_BODY_REWRITE_PROMPT,
      titleRewritePrompt: DEFAULT_TITLE_REWRITE_PROMPT,
      coverRewritePrompt: DEFAULT_COVER_REWRITE_PROMPT,
      extractReplacePrompt: DEFAULT_EXTRACT_REPLACE_PROMPT,
      hasHydrated: false,

      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      setBodyRewritePrompt: (v) => set({ bodyRewritePrompt: v }),
      setTitleRewritePrompt: (v) => set({ titleRewritePrompt: v }),
      setCoverRewritePrompt: (v) => set({ coverRewritePrompt: v }),
      setExtractReplacePrompt: (v) => set({ extractReplacePrompt: v }),

      resetAllPrompts: () =>
        set({
          bodyRewritePrompt: DEFAULT_BODY_REWRITE_PROMPT,
          titleRewritePrompt: DEFAULT_TITLE_REWRITE_PROMPT,
          coverRewritePrompt: DEFAULT_COVER_REWRITE_PROMPT,
          extractReplacePrompt: DEFAULT_EXTRACT_REPLACE_PROMPT,
        }),

      getBodyPromptMode: () =>
        resolvePromptMode(get().bodyRewritePrompt, DEFAULT_BODY_REWRITE_PROMPT),

      getTitlePromptMode: () =>
        resolvePromptMode(get().titleRewritePrompt, DEFAULT_TITLE_REWRITE_PROMPT),

      getCoverPromptMode: () =>
        resolvePromptMode(get().coverRewritePrompt, DEFAULT_COVER_REWRITE_PROMPT),

      getExtractPromptMode: () =>
        resolvePromptMode(get().extractReplacePrompt, DEFAULT_EXTRACT_REPLACE_PROMPT),

      bodyPromptHasInlineReplaceInfo: () => hasReplaceInfoPlaceholder(get().bodyRewritePrompt),

      titlePromptHasInlineReplaceInfo: () => hasReplaceInfoPlaceholder(get().titleRewritePrompt),

      coverPromptHasInlineReplaceInfo: () => hasReplaceInfoPlaceholder(get().coverRewritePrompt),

      extractPromptHasInlineOriginalAndRewritten: () =>
        hasOriginalAndRewrittenPlaceholder(get().extractReplacePrompt),

      buildBodyPrompt: (replaceInfo) =>
        get().getBodyPromptMode() === "custom"
          ? replaceProhibitedWordsIfPresent(
              replaceReplaceInfoIfPresent(get().bodyRewritePrompt, replaceInfo)
            )
          : injectProhibitedWords(injectReplaceInfo(get().bodyRewritePrompt, replaceInfo)),

      buildTitlePrompt: (replaceInfo) =>
        get().getTitlePromptMode() === "custom"
          ? replaceProhibitedWordsIfPresent(
              replaceReplaceInfoIfPresent(get().titleRewritePrompt, replaceInfo)
            )
          : injectProhibitedWords(injectReplaceInfo(get().titleRewritePrompt, replaceInfo)),

      buildCoverPrompt: (replaceInfo) =>
        get().getCoverPromptMode() === "custom"
          ? replaceProhibitedWordsIfPresent(
              replaceReplaceInfoIfPresent(get().coverRewritePrompt, replaceInfo)
            )
          : injectProhibitedWords(injectReplaceInfo(get().coverRewritePrompt, replaceInfo)),

      buildExtractPrompt: (original, rewritten) =>
        get().getExtractPromptMode() === "custom"
          ? replaceOriginalAndRewrittenIfPresent(get().extractReplacePrompt, original, rewritten)
          : injectOriginalAndRewritten(get().extractReplacePrompt, original, rewritten),
    }),
    {
      name: "xhs-app-prompts-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        bodyRewritePrompt: state.bodyRewritePrompt,
        titleRewritePrompt: state.titleRewritePrompt,
        coverRewritePrompt: state.coverRewritePrompt,
        extractReplacePrompt: state.extractReplacePrompt,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
