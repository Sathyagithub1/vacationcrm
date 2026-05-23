import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { encrypt } from "@/lib/encryption";

const VALID_PROVIDERS = ["CLAUDE", "OPENAI", "GEMINI", "CUSTOM"] as const;
type ProviderName = (typeof VALID_PROVIDERS)[number];

// GET /api/ai/providers — list all configured AI providers (apiKey never returned)
export async function GET(_request: NextRequest) {
  try {
    const { db } = await requirePermission("settings:ai");

    const providers = await db.aIProvider.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        provider: true,
        modelName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        // apiKey is intentionally excluded — never expose encrypted keys
      },
    });

    return NextResponse.json({ providers });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return unauthorized();
    if (error instanceof Error && error.message === "Forbidden")
      return forbidden();
    console.error("GET /api/ai/providers error:", error);
    return NextResponse.json(
      { error: "Failed to fetch AI providers" },
      { status: 500 }
    );
  }
}

// POST /api/ai/providers — create a new AI provider and deactivate all others
export async function POST(request: NextRequest) {
  try {
    const { user, db } = await requirePermission("settings:ai");

    const body = await request.json();
    const { provider, apiKey, modelName } = body as {
      provider?: string;
      apiKey?: string;
      modelName?: string;
    };

    // Validation
    if (!provider || !VALID_PROVIDERS.includes(provider as ProviderName)) {
      return NextResponse.json(
        { error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { error: "apiKey is required" },
        { status: 400 }
      );
    }
    if (!modelName || typeof modelName !== "string" || !modelName.trim()) {
      return NextResponse.json(
        { error: "modelName is required" },
        { status: 400 }
      );
    }

    const encryptedKey = encrypt(apiKey.trim());

    // Deactivate all existing providers, then create the new active one
    // Both operations run inside a transaction for atomicity.
    const newProvider = await db.$transaction(async (tx) => {
      await tx.aIProvider.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      return tx.aIProvider.create({
        data: {
          tenantId: user.tenantId,
          provider: provider as ProviderName,
          apiKey: encryptedKey,
          modelName: modelName.trim(),
          isActive: true,
        },
        select: {
          id: true,
          provider: true,
          modelName: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          // apiKey excluded
        },
      });
    });

    return NextResponse.json({ provider: newProvider }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return unauthorized();
    if (error instanceof Error && error.message === "Forbidden")
      return forbidden();
    console.error("POST /api/ai/providers error:", error);
    return NextResponse.json(
      { error: "Failed to create AI provider" },
      { status: 500 }
    );
  }
}
