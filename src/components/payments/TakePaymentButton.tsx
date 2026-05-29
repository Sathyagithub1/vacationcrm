"use client";

/**
 * src/components/payments/TakePaymentButton.tsx
 *
 * Phase 6c — "Take payment" button embeddable in conversations or lead detail.
 *
 * Usage:
 *   <TakePaymentButton
 *     customerId="cust-123"
 *     leadId="lead-abc"          // optional
 *     tourId="tour-xyz"          // optional
 *     seats={2}                  // optional, default 1
 *     amountPaise={50000}        // INR 500.00
 *     label="Pay ₹500"           // optional button label
 *     onSuccess={(data) => ...}  // called with { paymentId, razorpayOrderId }
 *     onError={(msg) => ...}     // called with error message string
 *   />
 *
 * Flow:
 *   1. Click → POST /api/payments → receive { razorpayOrderId, razorpayKeyId, amount }
 *   2. Open Razorpay Checkout (hosted via Razorpay JS CDN script tag)
 *   3. On success call onSuccess with the server paymentId + razorpayOrderId.
 *
 * Note: Razorpay Checkout JS is loaded via a <script> tag injected at runtime.
 * In production the Razorpay Checkout window is opened with the key_id and
 * order_id returned from the API.
 */

import { useState } from "react";

interface TakePaymentButtonProps {
  customerId: string;
  leadId?: string;
  tourId?: string;
  seats?: number;
  amountPaise: number;
  label?: string;
  notes?: Record<string, string>;
  onSuccess?: (data: { paymentId: string; razorpayOrderId: string }) => void;
  onError?: (message: string) => void;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name?: string;
  description?: string;
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string }) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => { open(): void };
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay Checkout script"));
    document.head.appendChild(script);
  });
}

export function TakePaymentButton({
  customerId,
  leadId,
  tourId,
  seats = 1,
  amountPaise,
  label,
  notes,
  onSuccess,
  onError,
}: TakePaymentButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      // 1. Create Razorpay order via CRM backend
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, leadId, tourId, seats, amountPaise, notes }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to create payment order");
      }

      const data = (await res.json()) as {
        paymentId: string;
        razorpayOrderId: string;
        amount: number;
        currency: string;
        razorpayKeyId: string | null;
        merchantName: string;
      };

      if (!data.razorpayKeyId) {
        throw new Error("Razorpay key not configured — contact admin");
      }

      // 2. Load Razorpay Checkout JS
      await loadRazorpayScript();

      if (!window.Razorpay) {
        throw new Error("Razorpay Checkout script failed to load");
      }

      // 3. Open Razorpay Checkout
      const rzp = new window.Razorpay({
        key: data.razorpayKeyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.razorpayOrderId,
        name: data.merchantName,
        description: tourId ? `Tour booking — ${seats} seat(s)` : "Payment",
        handler: (response) => {
          onSuccess?.({ paymentId: data.paymentId, razorpayOrderId: response.razorpay_order_id });
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      });

      rzp.open();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Payment failed";
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  const displayAmount = `₹${(amountPaise / 100).toLocaleString("en-IN")}`;
  const buttonLabel = label ?? `Pay ${displayAmount}`;

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={[
        "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium",
        "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2",
      ].join(" ")}
      aria-busy={loading}
    >
      {loading ? (
        <>
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Processing…
        </>
      ) : (
        buttonLabel
      )}
    </button>
  );
}
