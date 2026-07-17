import OpenAI from "openai";
import { supabaseAdmin } from "@/lib/supabase";

const MODEL_NAME = "gpt-5-mini";
const PROMPT_VERSION = "v1";
const DEFAULT_PROCESS_LIMIT = 40;

const openaiApiKey = process.env.OPENAI_API_KEY;

if (!openaiApiKey) {
  throw new Error("OPENAI_API_KEYが設定されていません。");
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

type MarketVideo = {
  id: number;
  video_id: string;
  genre_id: string;
  genre_name: string;
  search_keyword: string;
  title: string;
  description: string | null;
  channel_title: string;
  published_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  duration_seconds: number;
  url: string;
  thumbnail: string | null;
  created_at: string;
};

type VideoUnderstandingResult = {
  main_genre: string;
  sub_genres: string[];
  values_provided: string[];
  emotions_triggered: string[];
  target_audience: string[];
  video_formats: string[];
  hook_type: string;
  hook_summary: string;
  watch_reason: string;
  comment_reason: string;
  share_reason: string;
  save_reason: string;
  success_hypothesis: string;
  evidence: string[];
  alternative_explanation: string;
  confidence_score: number;
};

type UnderstandingSuccess = {
  marketVideoId: number;
  understandingId: number;
  videoId: string;
  title: string;
  confidenceScore: number;
};

type UnderstandingFailure = {
  marketVideoId: number;
  videoId: string;
  title: string;
  error: string;
};

function getTodayRangeInJapan(): {
  startOfDay: string;
  endOfDay: string;
} {
  const todayInJapan = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const startDate = new Date(`${todayInJapan}T00:00:00+09:00`);
  const endDate = new Date(
    startDate.getTime() + 24 * 60 * 60 * 1000
  );

  return {
    startOfDay: startDate.toISOString(),
    endOfDay: endDate.toISOString(),
  };
}

 async function findVideosNeedingUnderstanding(
  limit: number
): Promise<MarketVideo[]> {
  const { data: videos, error: videosError } =
    await supabaseAdmin
      .from("market_videos")
      .select(`
        id,
        video_id,
        genre_id,
        genre_name,
        search_keyword,
        title,
        description,
        channel_title,
        published_at,
        view_count,
        like_count,
        comment_count,
        duration_seconds,
        url,
        thumbnail,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);

  if (videosError) {
    throw new Error(
      `市場動画の取得に失敗しました: ${videosError.message}`
    );
  }

  if (!videos || videos.length === 0) {
    return [];
  }

  const marketVideoIds = videos.map((video) => video.id);

  const { data: existingResults, error: existingError } =
    await supabaseAdmin
      .from("market_video_classifications")
      .select("market_video_id")
      .eq("prompt_version", PROMPT_VERSION)
      .in("market_video_id", marketVideoIds);

  if (existingError) {
    throw new Error(
      `動画理解済みデータの確認に失敗しました: ${existingError.message}`
    );
  }

  const understoodVideoIds = new Set(
    (existingResults ?? []).map(
      (result) => result.market_video_id
    )
  );

  return (videos as MarketVideo[])
    .filter((video) => !understoodVideoIds.has(video.id))
    .slice(0, limit);
}

async function analyzeVideo(
  video: MarketVideo
): Promise<VideoUnderstandingResult> {
  const response = await openai.responses.create({
    model: MODEL_NAME,

    input: [
      {
        role: "system",
        content: `
あなたはVideo Loop OSの動画理解AIです。

あなたの仕事は、YouTubeショート動画の情報を読み、
会社が動画から学べる特徴・価値・感情・仮説を抽出することです。

【判断ルール】

1. 与えられた情報だけを根拠に判断する。
2. 事実と仮説を明確に分ける。
3. 実際の映像・音声は提供されていない。
4. 判断できない内容は「判断材料不足」と明記する。
5. 再生数が多いだけで内容が優れていると断定しない。
6. 複数の可能性を考え、最有力仮説と別の可能性を分ける。
7. 根拠には、タイトル・説明文・再生数・高評価数・
   コメント数・動画時間など、提供された情報を使う。
8. タイトルや説明文から推測した内容は、推測だと分かる表現にする。
9. 信頼度は0〜100の整数で示す。
10. 回答は日本語で作成する。
        `.trim(),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            video: {
              marketVideoId: video.id,
              youtubeVideoId: video.video_id,
              title: video.title,
              description: video.description ?? "",
              collectedGenre: video.genre_name,
              searchKeyword: video.search_keyword,
              channelTitle: video.channel_title,
              publishedAt: video.published_at,
              viewCount: video.view_count,
              likeCount: video.like_count,
              commentCount: video.comment_count,
              durationSeconds: video.duration_seconds,
              url: video.url,
            },
          },
          null,
          2
        ),
      },
    ],

    text: {
      format: {
        type: "json_schema",
        name: "video_understanding",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,

          properties: {
            main_genre: {
              type: "string",
            },
            sub_genres: {
              type: "array",
              items: { type: "string" },
            },
            values_provided: {
              type: "array",
              items: { type: "string" },
            },
            emotions_triggered: {
              type: "array",
              items: { type: "string" },
            },
            target_audience: {
              type: "array",
              items: { type: "string" },
            },
            video_formats: {
              type: "array",
              items: { type: "string" },
            },
            hook_type: {
              type: "string",
            },
            hook_summary: {
              type: "string",
            },
            watch_reason: {
              type: "string",
            },
            comment_reason: {
              type: "string",
            },
            share_reason: {
              type: "string",
            },
            save_reason: {
              type: "string",
            },
            success_hypothesis: {
              type: "string",
            },
            evidence: {
              type: "array",
              items: { type: "string" },
            },
            alternative_explanation: {
              type: "string",
            },
            confidence_score: {
              type: "integer",
              minimum: 0,
              maximum: 100,
            },
          },

          required: [
            "main_genre",
            "sub_genres",
            "values_provided",
            "emotions_triggered",
            "target_audience",
            "video_formats",
            "hook_type",
            "hook_summary",
            "watch_reason",
            "comment_reason",
            "share_reason",
            "save_reason",
            "success_hypothesis",
            "evidence",
            "alternative_explanation",
            "confidence_score",
          ],
        },
      },
    },
  });

  if (!response.output_text) {
    throw new Error(
      "動画理解AIから判定結果を取得できませんでした。"
    );
  }

  try {
    return JSON.parse(
      response.output_text
    ) as VideoUnderstandingResult;
  } catch {
    throw new Error(
      "動画理解AIの判定結果を読み取れませんでした。"
    );
  }
}

async function saveUnderstandingResult(
  marketVideoId: number,
  result: VideoUnderstandingResult
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("market_video_classifications")
    .insert({
      market_video_id: marketVideoId,

      main_genre: result.main_genre,
      sub_genres: result.sub_genres,

      values_provided: result.values_provided,
      emotions_triggered: result.emotions_triggered,
      target_audience: result.target_audience,
      video_formats: result.video_formats,

      hook_type: result.hook_type,
      hook_summary: result.hook_summary,

      watch_reason: result.watch_reason,
      comment_reason: result.comment_reason,
      share_reason: result.share_reason,
      save_reason: result.save_reason,

      success_hypothesis: result.success_hypothesis,
      evidence: result.evidence,
      alternative_explanation:
        result.alternative_explanation,
      confidence_score: result.confidence_score,

      model_name: MODEL_NAME,
      prompt_version: PROMPT_VERSION,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      `動画理解結果の保存に失敗しました: ${error.message}`
    );
  }

  return data.id;
}

export async function understandOneVideo() {
  const videos = await findVideosNeedingUnderstanding(1);
  const targetVideo = videos[0];

  if (!targetVideo) {
    return {
      status: "no_target",
      message:
        "今日保存された動画の中に、理解が必要な動画はありません。",
    };
  }

  const understandingResult =
    await analyzeVideo(targetVideo);

  const understandingId =
    await saveUnderstandingResult(
      targetVideo.id,
      understandingResult
    );

  return {
    status: "success",
    message: "動画理解AIが動画1本を理解しました。",
    marketVideoId: targetVideo.id,
    understandingId,
    video: {
      videoId: targetVideo.video_id,
      title: targetVideo.title,
      url: targetVideo.url,
    },
    understanding: understandingResult,
    modelName: MODEL_NAME,
    promptVersion: PROMPT_VERSION,
  };
}

export async function understandTodayVideos(
  limit = DEFAULT_PROCESS_LIMIT
) {
  const startedAt = new Date();
  const safeLimit = Math.min(Math.max(limit, 1), 40);

  const targetVideos =
    await findVideosNeedingUnderstanding(safeLimit);

  if (targetVideos.length === 0) {
    return {
      status: "no_target",
      message:
        "今日保存された動画の中に、理解が必要な動画はありません。",
      requestedLimit: safeLimit,
      targetCount: 0,
      successCount: 0,
      errorCount: 0,
      averageConfidenceScore: null,
      results: [],
      errors: [],
    };
  }

  const results: UnderstandingSuccess[] = [];
  const errors: UnderstandingFailure[] = [];

  // API料金と制限を管理しやすくするため、1本ずつ順番に処理する
  for (const video of targetVideos) {
    try {
      const understandingResult =
        await analyzeVideo(video);

      const understandingId =
        await saveUnderstandingResult(
          video.id,
          understandingResult
        );

      results.push({
        marketVideoId: video.id,
        understandingId,
        videoId: video.video_id,
        title: video.title,
        confidenceScore:
          understandingResult.confidence_score,
      });
    } catch (error) {
      console.error(
        `Video understanding failed: marketVideoId=${video.id}`,
        error
      );

      errors.push({
        marketVideoId: video.id,
        videoId: video.video_id,
        title: video.title,
        error:
          error instanceof Error
            ? error.message
            : "不明なエラーが発生しました。",
      });
    }
  }

  const finishedAt = new Date();

  const averageConfidenceScore =
    results.length > 0
      ? Number(
          (
            results.reduce(
              (total, result) =>
                total + result.confidenceScore,
              0
            ) / results.length
          ).toFixed(1)
        )
      : null;

  return {
    status:
      errors.length === 0
        ? "success"
        : results.length > 0
          ? "partial_success"
          : "failed",

    message:
      errors.length === 0
        ? "動画理解AIが対象動画をすべて理解しました。"
        : "一部の動画でエラーが発生しましたが、残りの処理は続行しました。",

    requestedLimit: safeLimit,
    targetCount: targetVideos.length,
    successCount: results.length,
    errorCount: errors.length,
    averageConfidenceScore,

    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    processingSeconds: Number(
      (
        (finishedAt.getTime() - startedAt.getTime()) /
        1000
      ).toFixed(1)
    ),

    modelName: MODEL_NAME,
    promptVersion: PROMPT_VERSION,

    results,
    errors,
  };
}