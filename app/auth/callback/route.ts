import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const error = requestUrl.searchParams.get("error")
  const errorDescription = requestUrl.searchParams.get("error_description")
  const errorCode = requestUrl.searchParams.get("error_code")
  const token = requestUrl.searchParams.get("token")
  const type = requestUrl.searchParams.get("type")

  console.log("Auth callback received:", {
    code: code ? "present" : "missing",
    token: token ? "present" : "missing",
    type,
    error,
    errorDescription,
    errorCode,
    fullUrl: request.url,
  })

  if (error) {
    console.error("Auth callback error:", { error, errorDescription, errorCode })

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

    return NextResponse.redirect(redirectUrl)
  }

  const cookieStore = cookies()
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore })

  // Handle both code-based and token-based verification
  if (code) {
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
        console.log("Email verified successfully, redirecting to terminal")
        const redirectUrl = new URL("/terminal", requestUrl.origin)
        redirectUrl.searchParams.set("verified", "true")
        return NextResponse.redirect(redirectUrl)
      } else {
        console.log("User exists but email not confirmed")
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
  } else if (token && type === "signup") {
    // Handle legacy token-based verification
    try {
      console.log("Attempting token-based verification...")

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: token,
        type: "signup",
      })

      if (error) {
        console.error("Token verification error:", error)
        const redirectUrl = new URL("/", requestUrl.origin)
        redirectUrl.searchParams.set("error", "verification_invalid")
        redirectUrl.searchParams.set(
          "message",
          "Email verification link is invalid or expired. Please request a new one.",
        )
        return NextResponse.redirect(redirectUrl)
      }

      if (data.user) {
        console.log("Token verification successful, redirecting to terminal")
        const redirectUrl = new URL("/terminal", requestUrl.origin)
        redirectUrl.searchParams.set("verified", "true")
        return NextResponse.redirect(redirectUrl)
      }
    } catch (err) {
      console.error("Token verification exception:", err)
      const redirectUrl = new URL("/", requestUrl.origin)
      redirectUrl.searchParams.set("error", "verification_error")
      redirectUrl.searchParams.set("message", "An unexpected error occurred during verification.")
      return NextResponse.redirect(redirectUrl)
    }
  }

  // No valid verification parameters
  console.log("No valid verification parameters, redirecting to home")
  const redirectUrl = new URL("/", requestUrl.origin)
  redirectUrl.searchParams.set("error", "verification_error")
  redirectUrl.searchParams.set("message", "Invalid verification link. Please request a new one.")
  return NextResponse.redirect(redirectUrl)
}
