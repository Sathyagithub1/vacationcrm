import { NextResponse } from "next/server";
import { createPasswordReset } from "@/modules/auth/password-reset.service";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      // Still return 200 to not reveal validation details
      return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
    }

    const result = await createPasswordReset(email);

    if (result) {
      // TODO: Send email with reset link (Task 17)
      // For now, log the token for development
      console.log(`[Password Reset] Token for ${result.email}: ${result.token}`);
    }

    // Always return success — don't reveal whether user exists
    return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
  } catch (error) {
    console.error("[Password Reset] Error:", error);
    return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
  }
}
