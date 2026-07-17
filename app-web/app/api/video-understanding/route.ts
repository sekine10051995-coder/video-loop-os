import { NextResponse } from "next/server";
import { understandTodayVideos } from "@/lib/ai/market-research/video-understanding";

export async function GET() {
  try {
    const result = await understandTodayVideos(10);

    return NextResponse.json({
      success: result.status !== "failed",
      ...result,
    });
  } catch (error) {
    console.error("Video understanding batch error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "動画理解処理中に予期しないエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}