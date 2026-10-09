-- Add the two EscalationReason values the code already writes.
--
-- POST /api/conversations/:id/escalate creates an Escalation with reason
-- MANUAL, and the auto-escalation worker uses UNRESPONSIVE. Neither value
-- existed in the enum, so both inserts failed at runtime with an invalid-enum
-- error (hidden from the type checker by an "as Function" cast).
--
-- Additive only: ADD VALUE never rewrites or deletes rows.
ALTER TYPE "EscalationReason" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "EscalationReason" ADD VALUE IF NOT EXISTS 'UNRESPONSIVE';
