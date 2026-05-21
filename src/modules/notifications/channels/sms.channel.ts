let warned = false;

export interface SmsPayload {
  to: string;
  message: string;
}

export async function sendSms(payload: SmsPayload): Promise<boolean> {
  const apiUrl = process.env.SMS_API_URL;
  const apiKey = process.env.SMS_API_KEY;

  if (!apiUrl || !apiKey) {
    if (!warned) {
      console.warn("[SMS Channel] SMS_API_URL or SMS_API_KEY not configured — SMS sending disabled");
      warned = true;
    }
    console.log("[SMS Channel] Skipping SMS. Would send to:", payload.to, "Message:", payload.message.slice(0, 50));
    return false;
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: payload.to,
        message: payload.message,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[SMS Channel] API error:", res.status, text);
      return false;
    }

    console.log("[SMS Channel] Sent to", payload.to);
    return true;
  } catch (err) {
    console.error("[SMS Channel] Failed to send:", err);
    return false;
  }
}
