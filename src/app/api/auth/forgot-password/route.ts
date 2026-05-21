import { NextResponse } from "next/server";
import { createPasswordReset } from "@/modules/auth/password-reset.service";
import { sendEmail } from "@/modules/notifications/channels/email.channel";

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      // Still return 200 to not reveal validation details
      return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
    }

    const result = await createPasswordReset(email);

    if (result) {
      const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
      const resetUrl = `${baseUrl}/reset-password?token=${result.token}`;

      await sendEmail({
        to: result.email,
        subject: "Reset your Holiday Delight CRM password",
        body: `You requested a password reset. Click the link below to reset your password:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, please ignore this email.`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1a1a1a;">Reset your password</h2>
            <p style="color: #555;">You requested a password reset for your Holiday Delight CRM account.</p>
            <p style="margin: 24px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: #f97316; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
                Reset Password
              </a>
            </p>
            <p style="color: #888; font-size: 13px;">This link expires in 1 hour. If you did not request this, please ignore this email.</p>
          </div>
        `,
      });

      console.log(`[Password Reset] Email sent to ${result.email}`);
    }

    // Always return success — don't reveal whether user exists
    return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
  } catch (error) {
    console.error("[Password Reset] Error:", error);
    return NextResponse.json({ message: "If an account exists, a reset link has been sent." });
  }
}
