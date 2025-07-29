import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorDescription = requestUrl.searchParams.get("error_description")
  const errorCode = requestUrl.searchParams.get("error_code")

  console.log("Auth callback received:", {
    code: code ? "present" : "missing",
    error,
    errorDescription,
    errorCode,
    fullUrl: request.url,
  })

  if (error) {
    console.error("Auth callback error:", { error, errorDescription, errorCode })

    // Handle various error cases
    const redirectUrl = new URL("/", requestUrl.origin)

    if (error === "access_denied") {
      if (errorCode === "otp_expired" || errorDescription?.includes("expired")) {
        redirectUrl.searchParams.set("error", "verification_expired")
        redirectUrl.searchParams.set("message", "Email verification link has expired. Please request a new one.")
      } else if (errorDescription?.includes("invalid")) {
        redirectUrl.searchParams.set("error", "verification_invalid")
        redirectUrl.searchParams.set("message", "Email verification link is invalid. Please request a new one.")
      } else {
        redirectUrl.searchParams.set("error", "verification_failed")
        redirectUrl.searchParams.set("message", "Email verification failed. Please try again.")
      }
    } else {
      redirectUrl.searchParams.set("error", "verification_error")
      redirectUrl.searchParams.set("message", "An error occurred during verification. Please try again.")
    }

    console.log("Redirecting to:", redirectUrl.toString())
    return NextResponse.redirect(redirectUrl)
  }

  if (code) {
    const cookieStore = cookies()
    const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

    try {
      console.log("Attempting to exchange code for session...")

      const { data, error } = await supabase.auth.exchangeCodeForSession(code)

      console.log("Exchange result:", {
        success: !error,
        error: error?.message,
        user: data?.user?.email,
        emailConfirmed: data?.user?.email_confirmed_at,
      })

      if (error) {
        console.error("Code exchange error:", error)

        const redirectUrl = new URL("/", requestUrl.origin)

        if (error.message.includes("expired")) {
          redirectUrl.searchParams.set("error", "verification_expired")
          redirectUrl.searchParams.set("message", "Email verification link has expired. Please request a new one.")
        } else if (error.message.includes("invalid")) {
          redirectUrl.searchParams.set("error", "verification_invalid")
          redirectUrl.searchParams.set("message", "Email verification link is invalid. Please request a new one.")
        } else {
          redirectUrl.searchParams.set("error", "verification_failed")
          redirectUrl.searchParams.set("message", `Verification failed: ${error.message}`)
        }

        return NextResponse.redirect(redirectUrl)
      }

      const isEmailVerified =
        data?.user?.email_confirmed_at ||
        data?.user?.confirmed_at ||
        data?.user?.user_metadata?.email_verified === true ||
        data?.user?.app_metadata?.email_verified === true

      if (isEmailVerified) {
        // Successful verification - redirect to terminal
        console.log("Email verified successfully, redirecting to terminal")
        const redirectUrl = new URL("/terminal", requestUrl.origin)
        redirectUrl.searchParams.set("verified", "true")
        return NextResponse.redirect(redirectUrl)
      } else {
        // User exists but email not confirmed
        console.log("User exists but email not confirmed", {
          email_confirmed_at: data?.user?.email_confirmed_at,
          confirmed_at: data?.user?.confirmed_at,
          user_metadata: data?.user?.user_metadata,
          app_metadata: data?.user?.app_metadata,
        })
        const redirectUrl = new URL("/", requestUrl.origin)
        redirectUrl.searchParams.set("error", "email_not_verified")
        redirectUrl.searchParams.set("message", "Email verification is still pending. Please check your email again.")
        return NextResponse.redirect(redirectUrl)
      }
    } catch (err) {
      console.error("Auth callback exception:", err)
      const redirectUrl = new URL("/", requestUrl.origin)
      redirectUrl.searchParams.set("error", "verification_error")
      redirectUrl.searchParams.set("message", "An unexpected error occurred during verification.")
      return NextResponse.redirect(redirectUrl)
    }
  }

  // No code parameter - redirect to home
  console.log("No code parameter, redirecting to home")
  const redirectUrl = new URL("/", requestUrl.origin)
  redirectUrl.searchParams.set("error", "verification_error")
  redirectUrl.searchParams.set("message", "Invalid verification link.")
  return NextResponse.redirect(redirectUrl)
}
