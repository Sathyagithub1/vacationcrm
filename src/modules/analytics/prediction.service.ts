import type { tenantPrisma } from "@/lib/prisma";

type TenantDb = ReturnType<typeof tenantPrisma>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type PredictionType =
  | "FOLLOW_UP_TIME"
  | "AGENT_MATCH"
  | "CONVERSION_PROB"
  | "MESSAGE_DRAFT";

export interface CreatePredictionData {
  tenantId: string;
  leadId: string;
  type: PredictionType;
  value: Record<string, unknown>;
  confidence: number;
  reasoning?: string;
}

export interface PredictionRecord {
  id: string;
  tenantId: string;
  leadId: string;
  type: PredictionType;
  value: Record<string, unknown>;
  confidence: number;
  reasoning: string | null;
  accepted: boolean | null;
  outcome: Record<string, unknown> | null;
  computedAt: Date;
}

export interface AccuracyResult {
  tenantId: string;
  total: number;
  accepted: number;
  withOutcome: number;
  accurate: number;
  accuracyRate: number;
  byType: Record<
    string,
    {
      total: number;
      accurate: number;
      accuracyRate: number;
    }
  >;
}

// ─── Create Prediction ────────────────────────────────────────────────────────

/**
 * Persist a new prediction record for a lead.
 * Confidence must be in range 0-1.
 */
export async function createPrediction(
  db: TenantDb,
  data: CreatePredictionData
): Promise<PredictionRecord> {
  if (data.confidence < 0 || data.confidence > 1) {
    throw new Error("Confidence must be between 0 and 1");
  }

  const lead = await db.lead.findFirst({
    where: { id: data.leadId, tenantId: data.tenantId },
    select: { id: true },
  });

  if (!lead) {
    throw new Error(`Lead not found: ${data.leadId}`);
  }

  const prediction = await (db.prediction as any).create({
    data: {
      tenantId: data.tenantId,
      leadId: data.leadId,
      type: data.type,
      value: data.value,
      confidence: data.confidence,
      reasoning: data.reasoning ?? null,
      accepted: null,
      outcome: null,
      computedAt: new Date(),
    },
  });

  return prediction as PredictionRecord;
}

// ─── Accept Prediction ────────────────────────────────────────────────────────

/**
 * Mark a prediction as accepted by the agent/user.
 * A prediction can only be accepted if it has not yet been explicitly rejected.
 */
export async function acceptPrediction(
  db: TenantDb,
  predictionId: string
): Promise<PredictionRecord> {
  const existing = await (db.prediction as any).findUnique({
    where: { id: predictionId },
    select: { id: true, accepted: true },
  });

  if (!existing) {
    throw new Error(`Prediction not found: ${predictionId}`);
  }

  if (existing.accepted === false) {
    throw new Error("Cannot accept a prediction that was already rejected");
  }

  const updated = await (db.prediction as any).update({
    where: { id: predictionId },
    data: { accepted: true },
  });

  return updated as PredictionRecord;
}

// ─── Record Outcome ───────────────────────────────────────────────────────────

/**
 * Record what actually happened after a prediction was made.
 * The outcome shape mirrors the prediction value structure (e.g. the actual
 * follow-up time, the actual agent assigned, the actual conversion result).
 */
export async function recordOutcome(
  db: TenantDb,
  predictionId: string,
  outcome: Record<string, unknown>
): Promise<PredictionRecord> {
  const existing = await (db.prediction as any).findUnique({
    where: { id: predictionId },
    select: { id: true },
  });

  if (!existing) {
    throw new Error(`Prediction not found: ${predictionId}`);
  }

  const updated = await (db.prediction as any).update({
    where: { id: predictionId },
    data: { outcome },
  });

  return updated as PredictionRecord;
}

// ─── Accuracy Evaluation ──────────────────────────────────────────────────────

/**
 * Determine whether a prediction's outcome matches the predicted value.
 *
 * Accuracy rules by prediction type:
 * - CONVERSION_PROB: predicted `converted` boolean matches outcome `converted`
 * - AGENT_MATCH:     predicted `agentId` matches outcome `agentId`
 * - FOLLOW_UP_TIME:  predicted `scheduledAt` within 30 minutes of outcome `actualAt`
 * - MESSAGE_DRAFT:   outcome `used` boolean is true (agent used the drafted message)
 */
function isAccurate(
  type: string,
  value: Record<string, unknown>,
  outcome: Record<string, unknown>
): boolean {
  switch (type) {
    case "CONVERSION_PROB": {
      return value.converted === outcome.converted;
    }
    case "AGENT_MATCH": {
      return value.agentId === outcome.agentId;
    }
    case "FOLLOW_UP_TIME": {
      const predicted = value.scheduledAt ? new Date(value.scheduledAt as string) : null;
      const actual = outcome.actualAt ? new Date(outcome.actualAt as string) : null;
      if (!predicted || !actual) return false;
      const diffMinutes = Math.abs(predicted.getTime() - actual.getTime()) / 60_000;
      return diffMinutes <= 30;
    }
    case "MESSAGE_DRAFT": {
      return outcome.used === true;
    }
    default:
      return false;
  }
}

/**
 * Compare accepted predictions against recorded outcomes to compute accuracy.
 * Only predictions where both `accepted === true` AND `outcome` is non-null
 * are included in the accuracy calculation.
 */
export async function getPredictionAccuracy(
  db: TenantDb,
  tenantId: string
): Promise<AccuracyResult> {
  const predictions = await (db.prediction as any).findMany({
    where: { tenantId },
    select: {
      id: true,
      type: true,
      value: true,
      confidence: true,
      accepted: true,
      outcome: true,
    },
  });

  const total = predictions.length;
  const accepted = predictions.filter((p: { accepted: boolean | null }) => p.accepted === true).length;

  // Only evaluate those that were accepted AND have an outcome recorded
  const evaluable = predictions.filter(
    (p: { accepted: boolean | null; outcome: Record<string, unknown> | null }) =>
      p.accepted === true && p.outcome !== null
  );

  const withOutcome = evaluable.length;

  let accurate = 0;
  const byType: Record<string, { total: number; accurate: number; accuracyRate: number }> = {};

  for (const prediction of evaluable) {
    const hit = isAccurate(
      prediction.type,
      prediction.value as Record<string, unknown>,
      prediction.outcome as Record<string, unknown>
    );

    if (hit) accurate++;

    if (!byType[prediction.type]) {
      byType[prediction.type] = { total: 0, accurate: 0, accuracyRate: 0 };
    }
    byType[prediction.type].total++;
    if (hit) byType[prediction.type].accurate++;
  }

  // Finalize per-type accuracy rates
  for (const type of Object.keys(byType)) {
    const entry = byType[type];
    entry.accuracyRate =
      entry.total > 0 ? Math.round((entry.accurate / entry.total) * 10000) / 100 : 0;
  }

  const accuracyRate =
    withOutcome > 0 ? Math.round((accurate / withOutcome) * 10000) / 100 : 0;

  return {
    tenantId,
    total,
    accepted,
    withOutcome,
    accurate,
    accuracyRate,
    byType,
  };
}
