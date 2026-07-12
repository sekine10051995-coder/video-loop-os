import { NextResponse } from "next/server";

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
      maxResults: "1",
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

    return NextResponse.json({
      success: true,
      message: "YouTube APIへの接続に成功しました。",
      video: data.items?.[0] ?? null,
    });
  } catch (error) {
    console.error("YouTube connection error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "予期しないエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}