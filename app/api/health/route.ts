import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = createClient()

    // Simple database connectivity test
    const { data, error } = await supabase.from("profiles").select("count").limit(1)

    if (error) {
      console.error("Health check database error:", error)
      return NextResponse.json(
        {
          status: "error",
          message: "Database connection failed",
          error: error.message,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
    })
  } catch (err) {
    console.error("Health check error:", err)
    return NextResponse.json(
      {
        status: "error",
        message: "Server error",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
