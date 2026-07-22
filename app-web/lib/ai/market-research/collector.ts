import {
  searchVideosByKeyword,
  type YouTubeVideo,
} from "@/lib/services/youtube";
import { supabaseAdmin } from "@/lib/supabase";
import { createSearchStrategy } from "@/lib/ai/market-research/search-strategy-ai";

const MIN_VIEW_COUNT = 200_000;
const MAX_DURATION_SECONDS = 180;
const RESEARCH_PERIOD_DAYS = 30;

// 1ジャンルあたり最終的に保存したい動画数
const TARGET_VIDEOS_PER_GENRE = 30;

// YouTubeから1回の検索で取得する件数
// 条件で除外される動画があるため、多めに取得する
const SEARCH_RESULTS_PER_GENRE = 50;

const MARKET_GENRES = [
  {
    id: "animals",
    name: "動物",
    searchKeyword: "動物 ショート",
  },
  {
    id: "education",
    name: "教育・豆知識",
    searchKeyword: "豆知識 ショート",
  },
  {
    id: "cooking",
    name: "料理",
    searchKeyword: "料理 ショート",
  },
  {
    id: "beauty",
    name: "美容",
    searchKeyword: "美容 ショート",
  },
  {
    id: "ai",
    name: "AI",
    searchKeyword: "AI ショート",
  },
] as const;

type CollectedMarketVideo = {
  videoId: string;
  genreId: string;
  genreName: string;
  searchKeyword: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string | null;
  thumbnail: string | null;
  duration: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  url: string;
};

type SaveResult = {
  savedCount: number;
  skippedCount: number;
};

function parseIsoDurationToSeconds(duration: string): number {
  const match = duration.match(
    /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/
  );

  if (!match) {
    return 0;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);

  return hours * 3600 + minutes * 60 + seconds;
}

function formatVideo(
  video: YouTubeVideo,
  genre: (typeof MARKET_GENRES)[number]
): CollectedMarketVideo {
  const duration = video.contentDetails?.duration ?? "PT0S";

  return {
    videoId: video.id,
    genreId: genre.id,
    genreName: genre.name,
    searchKeyword: genre.searchKeyword,
    title: video.snippet?.title ?? "タイトルなし",
    description: video.snippet?.description ?? "",
    channelTitle:
      video.snippet?.channelTitle ?? "チャンネル名なし",
    publishedAt: video.snippet?.publishedAt ?? null,
    thumbnail:
      video.snippet?.thumbnails?.medium?.url ?? null,
    duration,
    durationSeconds: parseIsoDurationToSeconds(duration),
    viewCount: Number(video.statistics?.viewCount ?? 0),
    likeCount: Number(video.statistics?.likeCount ?? 0),
    commentCount: Number(video.statistics?.commentCount ?? 0),
    url: `https://www.youtube.com/watch?v=${video.id}`,
  };
}

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

async function saveMarketVideos(
  videos: CollectedMarketVideo[]
): Promise<SaveResult> {
  if (videos.length === 0) {
    return {
      savedCount: 0,
      skippedCount: 0,
    };
  }

  const { startOfDay, endOfDay } = getTodayRangeInJapan();
  const videoIds = videos.map((video) => video.videoId);

  const { data: existingRows, error: selectError } =
    await supabaseAdmin
      .from("market_videos")
      .select("video_id")
      .gte("created_at", startOfDay)
      .lt("created_at", endOfDay)
      .in("video_id", videoIds);

  if (selectError) {
    throw new Error(
      `保存済み動画の確認に失敗しました: ${selectError.message}`
    );
  }

  const existingVideoIds = new Set(
    (existingRows ?? []).map((row) => row.video_id)
  );

  const newVideos = videos.filter(
    (video) => !existingVideoIds.has(video.videoId)
  );

  const skippedCount = videos.length - newVideos.length;

  if (newVideos.length === 0) {
    return {
      savedCount: 0,
      skippedCount,
    };
  }

  const rows = newVideos.map((video) => ({
    video_id: video.videoId,
    genre_id: video.genreId,
    genre_name: video.genreName,
    search_keyword: video.searchKeyword,
    title: video.title,
    description: video.description,
    channel_title: video.channelTitle,
    published_at: video.publishedAt,
    view_count: video.viewCount,
    like_count: video.likeCount,
    comment_count: video.commentCount,
    duration_seconds: video.durationSeconds,
    url: video.url,
    thumbnail: video.thumbnail,
  }));

  const { data, error: insertError } = await supabaseAdmin
    .from("market_videos")
    .insert(rows)
    .select("id");

  if (insertError) {
    throw new Error(
      `Supabaseへの保存に失敗しました: ${insertError.message}`
    );
  }

  return {
    savedCount: data?.length ?? 0,
    skippedCount,
  };
}

// 1つのジャンルについて、AIが作った検索キーワードで動画を集める関数
// 1つのジャンルについて、AIが考え直しながら動画を集める関数
async function collectGenreVideos(
  genre: (typeof MARKET_GENRES)[number],
  publishedAfter: string
): Promise<CollectedMarketVideo[]> {
  // Search Strategy AIへ相談した回数
  let attempt = 0;

  // すでに検索したキーワードを記録する
  const usedKeywords: string[] = [];

  // 集めた動画を動画IDごとに保存する
  // 同じ動画が複数回見つかっても、1本として扱う
  const collectedVideoMap = new Map<
    string,
    CollectedMarketVideo
  >();

  // 30本未満、かつAIへの相談が3回未満なら続ける
  while (
    collectedVideoMap.size < TARGET_VIDEOS_PER_GENRE &&
    attempt < 3
  ) {
    attempt += 1;

    console.log(
      `Search Strategy AIへ相談: ${genre.name} ${attempt}回目`
    );

    // 現在の本数と、使用済みキーワードをAIへ伝える
    const strategy = await createSearchStrategy(
      genre.name,
      collectedVideoMap.size,
      TARGET_VIDEOS_PER_GENRE,
      usedKeywords
    );

    console.log(
      `Search Strategy AI結果: ${genre.name} ${attempt}回目`,
      strategy
    );

    for (const keyword of strategy.keywords) {
      // AIが以前と同じキーワードを返した場合は検索しない
      if (usedKeywords.includes(keyword)) {
        console.log(
          `使用済みのためスキップ: ${genre.name} → ${keyword}`
        );
        continue;
      }

      // 検索済みキーワードとして記録する
      usedKeywords.push(keyword);

      console.log(
        `検索中: ${genre.name} → ${keyword}`
      );

      const videos = await searchVideosByKeyword(
        keyword,
        SEARCH_RESULTS_PER_GENRE,
        publishedAfter
      );

      const filteredVideos = videos
        .map((video) => ({
          ...formatVideo(video, genre),
          searchKeyword: keyword,
        }))
        .filter(
          (video) =>
            video.viewCount >= MIN_VIEW_COUNT &&
            video.durationSeconds > 0 &&
            video.durationSeconds <= MAX_DURATION_SECONDS
        );

      // 動画IDを使って重複を除きながら追加する
      for (const video of filteredVideos) {
        if (!collectedVideoMap.has(video.videoId)) {
          collectedVideoMap.set(video.videoId, video);
        }
      }

      console.log(
        `${genre.name}の現在の収集数: ` +
          `${collectedVideoMap.size} / ${TARGET_VIDEOS_PER_GENRE}`
      );

      // 30本に到達したら、残りのキーワードは検索しない
      if (
        collectedVideoMap.size >= TARGET_VIDEOS_PER_GENRE
      ) {
        console.log(
          `${genre.name}は目標の${TARGET_VIDEOS_PER_GENRE}本に到達しました`
        );

        break;
      }
    }
  }

  // 3回相談しても30本未満だった場合も、そのまま次へ進む
  if (collectedVideoMap.size < TARGET_VIDEOS_PER_GENRE) {
    console.log(
      `${genre.name}は最大3回検索しましたが、` +
        `${collectedVideoMap.size}本でした。そのまま次へ進みます。`
    );
  }

  // 再生回数が多い順に並べ、最大30本だけ返す
  return Array.from(collectedVideoMap.values())
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, TARGET_VIDEOS_PER_GENRE);
}

export async function collectMarketVideos() {
  const collectedVideos: CollectedMarketVideo[] = [];
  const genreResults = [];

  const publishedAfterDate = new Date();

  publishedAfterDate.setDate(
    publishedAfterDate.getDate() - RESEARCH_PERIOD_DAYS
  );

  const publishedAfter = publishedAfterDate.toISOString();

  for (const genre of MARKET_GENRES) {
    const filteredVideos = await collectGenreVideos(
      genre,
      publishedAfter
    );

    collectedVideos.push(...filteredVideos);

    genreResults.push({
      genreId: genre.id,
      genreName: genre.name,
      searchKeyword: genre.searchKeyword,
      collectedCount: filteredVideos.length,
      matchedCount: filteredVideos.length,
    });
  }

  const uniqueVideos = Array.from(
    new Map(
      collectedVideos.map((video) => [video.videoId, video])
    ).values()
  ).sort((a, b) => b.viewCount - a.viewCount);

  const { savedCount, skippedCount } =
    await saveMarketVideos(uniqueVideos);

  return {
    researchedAt: new Date().toISOString(),
    researchPeriodDays: RESEARCH_PERIOD_DAYS,
    publishedAfter,
    minimumViewCount: MIN_VIEW_COUNT,
    maximumDurationSeconds: MAX_DURATION_SECONDS,
    genreCount: MARKET_GENRES.length,
    genreResults,
    matchedCountBeforeDeduplication: collectedVideos.length,
    uniqueVideoCount: uniqueVideos.length,
    savedCount,
    skippedCount,
    videos: uniqueVideos,
  };
}