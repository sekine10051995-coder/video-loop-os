import { NextResponse } from "next/server";

const MIN_VIEW_COUNT = 200_000;
const MAX_SHORT_DURATION_SECONDS = 180;

type YouTubeVideo = {
  id: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
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

export async function GET() {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "YOUTUBE_API_KEYが設定されていません。",
        },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      part: "snippet,statistics,contentDetails",
      chart: "mostPopular",
      regionCode: "JP",
      maxResults: "50",
      key: apiKey,
    });

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`,
      {
        cache: "no-store",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("YouTube API error:", data);

      return NextResponse.json(
        {
          success: false,
          error: "YouTube APIから動画を取得できませんでした。",
          details: data,
        },
        { status: response.status }
      );
    }

    const videos: YouTubeVideo[] = data.items ?? [];

    const filteredVideos = videos
      .map((video) => {
        const duration = video.contentDetails?.duration ?? "PT0S";
        const durationSeconds = parseIsoDurationToSeconds(duration);

        return {
          videoId: video.id,
          title: video.snippet?.title ?? "タイトルなし",
          channelTitle:
            video.snippet?.channelTitle ?? "チャンネル名なし",
          publishedAt: video.snippet?.publishedAt ?? null,
          thumbnail:
            video.snippet?.thumbnails?.medium?.url ?? null,
          duration,
          durationSeconds,
          viewCount: Number(video.statistics?.viewCount ?? 0),
          likeCount: Number(video.statistics?.likeCount ?? 0),
          commentCount: Number(
            video.statistics?.commentCount ?? 0
          ),
          url: `https://www.youtube.com/watch?v=${video.id}`,
        };
      })
      .filter(
        (video) =>
          video.viewCount >= MIN_VIEW_COUNT &&
          video.durationSeconds <= MAX_SHORT_DURATION_SECONDS
      )
      .sort((a, b) => b.viewCount - a.viewCount);

    return NextResponse.json({
      success: true,
      message:
        "20万再生以上かつ3分以内の動画候補を取得しました。",
      collectedCount: videos.length,
      matchedCount: filteredVideos.length,
      minimumViewCount: MIN_VIEW_COUNT,
      maximumDurationSeconds: MAX_SHORT_DURATION_SECONDS,
      videos: filteredVideos,
    });
  } catch (error) {
    console.error("YouTube collection error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "予期しないエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}