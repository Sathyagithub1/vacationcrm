let warned = false;

export interface WhatsAppPayload {
  to: string;
  message: string;
}

export async function sendWhatsApp(payload: WhatsAppPayload): Promise<boolean> {
  const apiUrl = process.env.WHATSAPP_API_URL;
  const apiKey = process.env.WHATSAPP_API_KEY;

  if (!apiUrl || !apiKey) {
    if (!warned) {
      console.warn("[WhatsApp Channel] WHATSAPP_API_URL or WHATSAPP_API_KEY not configured — WhatsApp sending disabled");
      warned = true;
    }
    console.log("[WhatsApp Channel] Skipping WhatsApp. Would send to:", payload.to, "Message:", payload.message.slice(0, 50));
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
      console.error("[WhatsApp Channel] API error:", res.status, text);
      return false;
    }

    console.log("[WhatsApp Channel] Sent to", payload.to);
    return true;
  } catch (err) {
    console.error("[WhatsApp Channel] Failed to send:", err);
    return false;
  }
}
