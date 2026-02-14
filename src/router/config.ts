/**
 * Default Routing Config — Customized for Direct API Keys
 * Forked from ClawRouter (MIT License). No payment dependencies.
 *
 * Tier models are mapped to providers YOU have API keys for.
 * Edit the `tiers` section to match your configured providers.
 *
 * Available providers (from openclaw.json):
 *   - anthropic: claude-opus-4-6
 *   - kimi-coding: kimi-for-coding (Kimi K2.5)
 *   - openai: gpt-4o, gpt-4o-mini, o3, o3-mini (add as needed)
 *   - google: gemini-2.5-pro, gemini-2.5-flash (add as needed)
 */

import type { RoutingConfig } from "./types.js";
import { getConfig } from "../config.js";

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  version: "2.0-direct",

  classifier: {
    llmModel: "kimi-coding/kimi-for-coding", // cheapest for classification fallback
    llmMaxTokens: 10,
    llmTemperature: 0,
    promptTruncationChars: 500,
    cacheTtlMs: 3_600_000,
  },

  scoring: {
    tokenCountThresholds: { simple: 5, complex: 40 },

    // ─── Multilingual keyword lists (unchanged from upstream) ───

    codeKeywords: [
      "function", "class", "import", "def", "SELECT", "async", "await",
      "const", "let", "var", "return", "```",
      "函数", "类", "导入", "定义", "查询", "异步", "等待", "常量", "变量", "返回",
      "関数", "クラス", "インポート", "非同期", "定数", "変数",
      "функция", "класс", "импорт", "определ", "запрос", "асинхронный", "ожидать", "константа", "переменная", "вернуть",
      "funktion", "klasse", "importieren", "definieren", "abfrage", "asynchron", "erwarten", "konstante", "variable", "zurückgeben",
    ],
    reasoningKeywords: [
      "prove", "theorem", "derive", "step by step", "chain of thought",
      "formally", "mathematical", "proof", "logically",
      "证明", "定理", "推导", "逐步", "思维链", "形式化", "数学", "逻辑",
      "証明", "定理", "導出", "ステップバイステップ", "論理的",
      "доказать", "докажи", "доказательств", "теорема", "вывести", "шаг за шагом", "пошагово", "поэтапно", "цепочка рассуждений", "рассуждени", "формально", "математически", "логически",
      "beweisen", "beweis", "theorem", "ableiten", "schritt für schritt", "gedankenkette", "formal", "mathematisch", "logisch",
    ],
    simpleKeywords: [
      "what is", "define", "translate", "hello", "yes or no", "capital of",
      "how old", "who is", "when was",
      "什么是", "定义", "翻译", "你好", "是否", "首都", "多大", "谁是", "何时",
      "とは", "定義", "翻訳", "こんにちは", "はいかいいえ", "首都", "誰",
      "что такое", "определение", "перевести", "переведи", "привет", "да или нет", "столица", "сколько лет", "кто такой", "когда", "объясни",
      "was ist", "definiere", "übersetze", "hallo", "ja oder nein", "hauptstadt", "wie alt", "wer ist", "wann", "erkläre",
    ],
    technicalKeywords: [
      "algorithm", "optimize", "architecture", "distributed", "kubernetes",
      "microservice", "database", "infrastructure",
      "算法", "优化", "架构", "分布式", "微服务", "数据库", "基础设施",
      "アルゴリズム", "最適化", "アーキテクチャ", "分散", "マイクロサービス", "データベース",
      "алгоритм", "оптимизировать", "оптимизаци", "оптимизируй", "архитектура", "распределённый", "микросервис", "база данных", "инфраструктура",
      "algorithmus", "optimieren", "architektur", "verteilt", "kubernetes", "mikroservice", "datenbank", "infrastruktur",
    ],
    creativeKeywords: [
      "story", "poem", "compose", "brainstorm", "creative", "imagine", "write a",
      "故事", "诗", "创作", "头脑风暴", "创意", "想象", "写一个",
      "物語", "詩", "作曲", "ブレインストーム", "創造的", "想像",
      "история", "рассказ", "стихотворение", "сочинить", "сочини", "мозговой штурм", "творческий", "представить", "придумай", "напиши",
      "geschichte", "gedicht", "komponieren", "brainstorming", "kreativ", "vorstellen", "schreibe", "erzählung",
    ],

    imperativeVerbs: [
      "build", "create", "implement", "design", "develop", "construct",
      "generate", "deploy", "configure", "set up",
      "构建", "创建", "实现", "设计", "开发", "生成", "部署", "配置", "设置",
      "構築", "作成", "実装", "設計", "開発", "生成", "デプロイ", "設定",
      "построить", "построй", "создать", "создай", "реализовать", "реализуй", "спроектировать", "разработать", "разработай", "сконструировать", "сгенерировать", "сгенерируй", "развернуть", "разверни", "настроить", "настрой",
      "erstellen", "bauen", "implementieren", "entwerfen", "entwickeln", "konstruieren", "generieren", "bereitstellen", "konfigurieren", "einrichten",
    ],
    constraintIndicators: [
      "under", "at most", "at least", "within", "no more than", "o(",
      "maximum", "minimum", "limit", "budget",
      "不超过", "至少", "最多", "在内", "最大", "最小", "限制", "预算",
      "以下", "最大", "最小", "制限", "予算",
      "не более", "не менее", "как минимум", "в пределах", "максимум", "минимум", "ограничение", "бюджет",
      "höchstens", "mindestens", "innerhalb", "nicht mehr als", "maximal", "minimal", "grenze", "budget",
    ],
    outputFormatKeywords: [
      "json", "yaml", "xml", "table", "csv", "markdown", "schema",
      "format as", "structured",
      "表格", "格式化为", "结构化",
      "テーブル", "フォーマット", "構造化",
      "таблица", "форматировать как", "структурированный",
      "tabelle", "formatieren als", "strukturiert",
    ],
    referenceKeywords: [
      "above", "below", "previous", "following", "the docs", "the api",
      "the code", "earlier", "attached",
      "上面", "下面", "之前", "接下来", "文档", "代码", "附件",
      "上記", "下記", "前の", "次の", "ドキュメント", "コード",
      "выше", "ниже", "предыдущий", "следующий", "документация", "код", "ранее", "вложение",
      "oben", "unten", "vorherige", "folgende", "dokumentation", "der code", "früher", "anhang",
    ],
    negationKeywords: [
      "don't", "do not", "avoid", "never", "without", "except", "exclude", "no longer",
      "不要", "避免", "从不", "没有", "除了", "排除",
      "しないで", "避ける", "決して", "なしで", "除く",
      "не делай", "не надо", "нельзя", "избегать", "никогда", "без", "кроме", "исключить", "больше не",
      "nicht", "vermeide", "niemals", "ohne", "außer", "ausschließen", "nicht mehr",
    ],
    domainSpecificKeywords: [
      "quantum", "fpga", "vlsi", "risc-v", "asic", "photonics", "genomics",
      "proteomics", "topological", "homomorphic", "zero-knowledge", "lattice-based",
      "量子", "光子学", "基因组学", "蛋白质组学", "拓扑", "同态", "零知识", "格密码",
      "量子", "フォトニクス", "ゲノミクス", "トポロジカル",
      "квантовый", "фотоника", "геномика", "протеомика", "топологический", "гомоморфный", "с нулевым разглашением", "на основе решёток",
      "quanten", "photonik", "genomik", "proteomik", "topologisch", "homomorph", "zero-knowledge", "gitterbasiert",
    ],

    agenticTaskKeywords: [
      "read file", "read the file", "look at", "check the", "open the",
      "edit", "modify", "update the", "change the", "write to", "create file",
      "execute", "deploy", "install", "npm", "pip", "compile",
      "after that", "and also", "once done", "step 1", "step 2",
      "fix", "debug", "until it works", "keep trying", "iterate",
      "make sure", "verify", "confirm",
      "读取文件", "查看", "打开", "编辑", "修改", "更新", "创建", "执行",
      "部署", "安装", "第一步", "第二步", "修复", "调试", "直到", "确认", "验证",
    ],

    // Dimension weights (sum ≈ 1.0)
    dimensionWeights: {
      tokenCount: 0.04,
      codePresence: 0.12,
      reasoningMarkers: 0.25,
      technicalTerms: 0.18,
      creativeMarkers: 0.05,
      simpleIndicators: 0.10,
      multiStepPatterns: 0.12,
      questionComplexity: 0.05,
      imperativeVerbs: 0.06,
      constraintCount: 0.04,
      outputFormat: 0.03,
      referenceComplexity: 0.02,
      negationComplexity: 0.01,
      domainSpecificity: 0.12,
      agenticTask: 0.04,
    },

    tierBoundaries: {
      simpleMedium: 0.0,
      mediumComplex: 0.03,
      complexReasoning: 0.15,
    },

    confidenceSteepness: 8,
    confidenceThreshold: 0.50,
  },

  // ─── TIER → MODEL MAPPING (YOUR API KEYS) ───
  // These use model IDs as configured in your openclaw.json providers.
  // Format: "provider/model-id" matching your openclaw.json config.

  tiers: {
    SIMPLE: {
      primary: "kimi-coding/kimi-for-coding",
      fallback: ["anthropic/claude-haiku-4-5"],
    },
    MEDIUM: {
      primary: "anthropic/claude-sonnet-4-5",
      fallback: ["anthropic/claude-opus-4-6"],
    },
    COMPLEX: {
      primary: "anthropic/claude-opus-4-6",
      fallback: ["anthropic/claude-haiku-4-5"],
    },
    REASONING: {
      primary: "anthropic/claude-opus-4-6",
      fallback: ["anthropic/claude-haiku-4-5"],
    },
  },

  // Agentic tier configs — models good at multi-step autonomous tasks
  agenticTiers: {
    SIMPLE: {
      primary: "kimi-coding/kimi-for-coding",
      fallback: ["anthropic/claude-haiku-4-5"],
    },
    MEDIUM: {
      primary: "anthropic/claude-sonnet-4-5",
      fallback: ["anthropic/claude-opus-4-6"],
    },
    COMPLEX: {
      primary: "anthropic/claude-opus-4-6",
      fallback: ["anthropic/claude-haiku-4-5"],
    },
    REASONING: {
      primary: "anthropic/claude-opus-4-6",
      fallback: ["anthropic/claude-haiku-4-5"],
    },
  },

  overrides: {
    maxTokensForceComplex: 100_000,
    structuredOutputMinTier: "MEDIUM",
    ambiguousDefaultTier: "MEDIUM",
    agenticMode: false,
  },
};


/**
 * Get the effective routing config, merging external config overrides.
 * External config can override: tiers, agenticTiers, tierBoundaries.
 * Scoring weights and keywords remain as coded defaults (advanced users edit source).
 */
export function getRoutingConfig(): RoutingConfig {
  const extCfg = getConfig();
  const config = { ...DEFAULT_ROUTING_CONFIG };

  // Override tiers from external config
  if (extCfg.tiers) {
    config.tiers = extCfg.tiers as RoutingConfig["tiers"];
  }

  // Override agentic tiers
  if (extCfg.agenticTiers) {
    config.agenticTiers = extCfg.agenticTiers as RoutingConfig["agenticTiers"];
  }

  // Override tier boundaries
  if (extCfg.tierBoundaries) {
    config.scoring = {
      ...config.scoring,
      tierBoundaries: extCfg.tierBoundaries,
    };
  }

  return config;
}
