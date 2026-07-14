import {
  searchVideosByKeyword,
  type YouTubeVideo,
} from "@/lib/services/youtube";
import { supabaseAdmin } from "@/lib/supabase";

const MIN_VIEW_COUNT = 200_000;
const MAX_DURATION_SECONDS = 180;
const RESEARCH_PERIOD_DAYS = 30;

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

async function saveMarketVideos(
  videos: CollectedMarketVideo[]
): Promise<number> {
  if (videos.length === 0) {
    return 0;
  }

  const rows = videos.map((video) => ({
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

  const { data, error } = await supabaseAdmin
    .from("market_videos")
    .insert(rows)
    .select("id");

  if (error) {
    throw new Error(
      `Supabaseへの保存に失敗しました: ${error.message}`
    );
  }

  return data?.length ?? 0;
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
    const videos = await searchVideosByKeyword(
      genre.searchKeyword,
      10,
      publishedAfter
    );

    const filteredVideos = videos
      .map((video) => formatVideo(video, genre))
      .filter(
        (video) =>
          video.viewCount >= MIN_VIEW_COUNT &&
          video.durationSeconds > 0 &&
          video.durationSeconds <= MAX_DURATION_SECONDS
      );

    collectedVideos.push(...filteredVideos);

    genreResults.push({
      genreId: genre.id,
      genreName: genre.name,
      searchKeyword: genre.searchKeyword,
      collectedCount: videos.length,
      matchedCount: filteredVideos.length,
    });
  }

  const uniqueVideos = Array.from(
    new Map(
      collectedVideos.map((video) => [video.videoId, video])
    ).values()
  ).sort((a, b) => b.viewCount - a.viewCount);

  const savedCount = await saveMarketVideos(uniqueVideos);

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
    videos: uniqueVideos,
  };
}