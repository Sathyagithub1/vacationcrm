import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;
let checked = false;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (checked) return null;
  checked = true;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass || !from) {
    console.warn("[Email Channel] SMTP not configured (missing SMTP_HOST/USER/PASS/FROM) — email sending disabled");
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.log("[Email Channel] Skipping email — SMTP not configured. Would send to:", payload.to);
    return false;
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM,
      to: payload.to,
      subject: payload.subject,
      text: payload.body,
      html: payload.html || payload.body,
    });
    console.log("[Email Channel] Sent to", payload.to);
    return true;
  } catch (err) {
    console.error("[Email Channel] Failed to send:", err);
    return false;
  }
}
