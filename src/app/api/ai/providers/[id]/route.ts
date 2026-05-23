import { NextRequest, NextResponse } from "next/server";
import {
  requirePermission,
  unauthorized,
  forbidden,
} from "@/modules/auth/tenant.middleware";
import { encrypt } from "@/lib/encryption";

const VALID_PROVIDERS = ["CLAUDE", "OPENAI", "GEMINI"] as const;
type ProviderName = (typeof VALID_PROVIDERS)[number];

// PUT /api/ai/providers/[id] — update provider name, model, or rotate API key
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { db } = await requirePermission("settings:ai");
    const { id } = params;

    const existing = await db.aIProvider.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "AI provider not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { provider, apiKey, modelName, isActive } = body as {
      provider?: string;
      apiKey?: string;
      modelName?: string;
      isActive?: boolean;
    };

    // Validate provider name if provided
    if (provider !== undefined && !VALID_PROVIDERS.includes(provider as ProviderName)) {
      return NextResponse.json(
        { error: `provider must be one of: ${VALID_PROVIDERS.join(", ")}` },
        { status: 400 }
      );
    }

    // Build the update payload
    const data: Record<string, unknown> = {};
    if (provider !== undefined) data.provider = provider as ProviderName;
    if (modelName !== undefined && modelName.trim()) {
      data.modelName = modelName.trim();
    }
    if (apiKey !== undefined && apiKey.trim()) {
      // Rotate: encrypt the new key — old encrypted key is discarded
      data.apiKey = encrypt(apiKey.trim());
    }

    // If activating this provider, deactivate all others first
    if (isActive === true) {
      await db.$transaction(async (tx) => {
        await tx.aIProvider.updateMany({
          where: { isActive: true, id: { not: id } },
          data: { isActive: false },
        });
        await tx.aIProvider.update({
          where: { id },
          data: { ...data, isActive: true },
        });
      });
    } else {
      if (isActive !== undefined) data.isActive = isActive;
      await db.aIProvider.update({ where: { id }, data });
    }

    // Re-fetch and return without apiKey
    const updated = await db.aIProvider.findFirst({
      where: { id },
      select: {
        id: true,
        provider: true,
        modelName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ provider: updated });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return unauthorized();
    if (error instanceof Error && error.message === "Forbidden")
      return forbidden();
    console.error("PUT /api/ai/providers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update AI provider" },
      { status: 500 }
    );
  }
}

// DELETE /api/ai/providers/[id] — remove a provider configuration
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { db } = await requirePermission("settings:ai");
    const { id } = params;

    const existing = await db.aIProvider.findFirst({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "AI provider not found" },
        { status: 404 }
      );
    }

    await db.aIProvider.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized")
      return unauthorized();
    if (error instanceof Error && error.message === "Forbidden")
      return forbidden();
    console.error("DELETE /api/ai/providers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete AI provider" },
      { status: 500 }
    );
  }
}
