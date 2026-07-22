import OpenAI from "openai";

const MODEL_NAME = "gpt-5-mini";
const PROMPT_VERSION = "v2";

const openaiApiKey = process.env.OPENAI_API_KEY;

if (!openaiApiKey) {
  throw new Error("OPENAI_API_KEYが設定されていません。");
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

export type SearchStrategyResult = {
  keywords: string[];
  reason: string;
};

export async function createSearchStrategy(
  genre: string,
  currentCount: number,
  targetCount: number,
  usedKeywords: string[]
): Promise<SearchStrategyResult> {
  const remainingCount = Math.max(
    targetCount - currentCount,
    0
  );

  const attemptNumber =
    Math.floor(usedKeywords.length / 5) + 1;

  const response = await openai.responses.create({
    model: MODEL_NAME,

    input: [
      {
        role: "system",
        content: `
あなたはVideo Loop OSのYouTube市場収集AIです。

あなたの仕事は、
指定されたジャンルについて、
条件を満たすYouTube動画を集めるために、
次に検索すべき検索キーワードを5個作ることです。

YouTubeの検索欄へ、
人間が実際に入力しそうな短い検索語を作ってください。

【最重要目的】

珍しいテーマを考えることではありません。

YouTube上に動画が多く存在し、
検索結果を広く取得できる言葉を選ぶことが目的です。

【検索キーワードのルール】

・回答は日本語にする
・必ず5個提案する
・1つの検索キーワードは原則2〜4語にする
・検索キーワードは短く簡単にする
・文章や説明文のような検索語は禁止
・長すぎる専門用語は禁止
・一般の視聴者が入力しそうな言葉を使う
・YouTubeで動画数が多そうな言葉を優先する
・必要に応じて「ショート」「Shorts」「#shorts」を使う
・ジャンル名だけの検索より、少し具体的な検索語にする
・5個は、それぞれ違う切り口にする
・既に使用した検索キーワードは絶対に使わない
・使用済みキーワードとほぼ同じ意味の言葉も避ける
・固有名詞や専門用語に偏りすぎない
・検索結果を狭めすぎる細かい条件を入れない
・記号、括弧、読点、句点は検索キーワードに入れない

【良い検索キーワードの例】

ジャンルが動物の場合：

・犬 かわいい Shorts
・猫 おもしろ動画
・動物 赤ちゃん
・野生動物 ショート
・ペット 癒し動画

ジャンルが料理の場合：

・簡単レシピ Shorts
・時短料理
・節約ごはん
・お弁当 おかず
・電子レンジ レシピ

ジャンルが美容の場合：

・メイク Shorts
・スキンケア 方法
・韓国コスメ
・ヘアアレンジ
・美容ルーティン

ジャンルがAIの場合：

・ChatGPT Shorts
・生成AI 使い方
・AIツール 紹介
・画像生成AI
・AIニュース

【悪い検索キーワードの例】

次のような長く細かい検索語は禁止です。

・動物園や保護施設のバックヤードツアー
・オンデバイスAIの推論最適化実践方法
・日常生活で役立つ安全と法律の詳しい解説
・敏感肌向けファンデーションの成分比較
・家庭で楽しむ初心者向け本格燻製レシピ

【検索回数に応じた考え方】

1回目：
ジャンル内の人気が高く、
動画数が多そうな主要キーワードを選ぶ。

2回目：
1回目で動画が足りなかったため、
より短く、より広い検索語を選ぶ。

3回目：
それでも動画が足りなかったため、
専門性を下げ、
非常に一般的で検索結果が多そうな言葉を選ぶ。

現在の収集本数が少ないほど、
ニッチな検索語ではなく、
広く検索できる言葉を優先してください。

【理由の書き方】

reasonには、
なぜこの5個なら動画を集めやすいと判断したかを、
短く説明してください。

長い説明は不要です。

【出力形式】

回答は必ず指定されたJSON形式だけで返してください。
JSON以外の文章は出力しないでください。

プロンプトバージョン：
${PROMPT_VERSION}
        `.trim(),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            genre,
            currentCount,
            targetCount,
            remainingCount,
            attemptNumber,
            usedKeywords,
          },
          null,
          2
        ),
      },
    ],

    text: {
      format: {
        type: "json_schema",
        name: "search_strategy",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,

          properties: {
            keywords: {
              type: "array",
              items: {
                type: "string",
              },
              minItems: 5,
              maxItems: 5,
            },
            reason: {
              type: "string",
            },
          },

          required: ["keywords", "reason"],
        },
      },
    },
  });

  const result = JSON.parse(
    response.output_text
  ) as SearchStrategyResult;

  return result;
}