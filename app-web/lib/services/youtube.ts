const API_KEY = process.env.YOUTUBE_API_KEY;

export type YouTubeVideo = {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    description?: string;
    categoryId?: string;
    thumbnails?: {
      medium?: {
        url?: string;
      };
    };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
};

type YouTubeSearchResponse = {
  items?: Array<{
    id?: {
      videoId?: string;
    };
  }>;
};

type YouTubeVideosResponse = {
  items?: YouTubeVideo[];
};

function getApiKey(): string {
  if (!API_KEY) {
    throw new Error("YouTube APIキーが設定されていません。");
  }

  return API_KEY;
}

export async function getPopularVideos(): Promise<YouTubeVideo[]> {
  const apiKey = getApiKey();

  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    chart: "mostPopular",
    regionCode: "JP",
    maxResults: "50",
    key: apiKey,
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
    { cache: "no-store" }
  );

  const data: YouTubeVideosResponse = await response.json();

  if (!response.ok) {
    throw new Error("YouTubeの人気動画取得に失敗しました。");
  }

  return data.items ?? [];
}

export async function searchVideosByKeyword(
  keyword: string,
  maxResults = 10
): Promise<YouTubeVideo[]> {
  const apiKey = getApiKey();

  const searchParams = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: keyword,
    regionCode: "JP",
    relevanceLanguage: "ja",
    order: "viewCount",
    maxResults: String(maxResults),
    key: apiKey,
  });

  const searchResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`,
    { cache: "no-store" }
  );

  const searchData: YouTubeSearchResponse = await searchResponse.json();

  if (!searchResponse.ok) {
    throw new Error(`「${keyword}」の動画検索に失敗しました。`);
  }

  const videoIds = (searchData.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((videoId): videoId is string => Boolean(videoId));

  if (videoIds.length === 0) {
    return [];
  }

  const videoParams = new URLSearchParams({
    part: "snippet,statistics,contentDetails",
    id: videoIds.join(","),
    key: apiKey,
  });

  const videoResponse = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${videoParams.toString()}`,
    { cache: "no-store" }
  );

  const videoData: YouTubeVideosResponse = await videoResponse.json();

  if (!videoResponse.ok) {
    throw new Error(`「${keyword}」の動画詳細取得に失敗しました。`);
  }

  return videoData.items ?? [];
}