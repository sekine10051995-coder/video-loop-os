import { NextResponse } from "next/server";
import { collectMarketVideos } from "@/lib/ai/market-research/collector";

export async function GET() {
  try {
    const result = await collectMarketVideos();

    return NextResponse.json({
      success: true,
      message:
        "市場収集AIが複数ジャンルの動画候補を収集しました。",
      ...result,
    });
  } catch (error) {
    console.error("Market collection error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "市場収集中に予期しないエラーが発生しました。",
      },
      { status: 500 }
    );
  }
}