import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorDescription = requestUrl.searchParams.get("error_description")

  if (error) {
    // Handle various error cases
    const redirectUrl = new URL("/", requestUrl.origin)

    if (error === "access_denied" && errorDescription?.includes("expired")) {
      redirectUrl.searchParams.set("error", "verification_expired")
    } else if (error === "access_denied") {
      redirectUrl.searchParams.set("error", "verification_failed")
    } else {
      redirectUrl.searchParams.set("error", "verification_error")
    }

    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const cookieStore = cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        const redirectUrl = new URL("/", requestUrl.origin)
        redirectUrl.searchParams.set("error", "verification_failed")
        return NextResponse.redirect(redirectUrl)
      }

      // Successful verification - redirect to terminal
      const redirectUrl = new URL("/terminal", requestUrl.origin)
      redirectUrl.searchParams.set("verified", "true")
      return NextResponse.redirect(redirectUrl)
    } catch (err) {
      const redirectUrl = new URL("/", requestUrl.origin)
      redirectUrl.searchParams.set("error", "verification_error")
      return NextResponse.redirect(redirectUrl)
    }
  }

  // No code parameter - redirect to home
  return NextResponse.redirect(new URL("/", requestUrl.origin))
}
