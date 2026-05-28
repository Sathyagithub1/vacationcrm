# Phase 6d setup script — run this from the project root
# C:\Users\Sathyamoorthy V\Documents\Claude\Holiday Delight CRM

Set-Location "C:\Users\Sathyamoorthy V\Documents\Claude\Holiday Delight CRM"

# ── Step 1: Create branch ──────────────────────────────────────────────────────
git checkout -b phase-6d

# ── Step 2: Apply migration + regenerate client ────────────────────────────────
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/holiday_delight_crm"
npx prisma migrate deploy
npx prisma generate

# ── Step 3: Commit sub-task 6d.1 (schema + migration) ─────────────────────────
git add prisma/schema.prisma
git add "prisma/migrations/20260527300000_phase_6d_voice_ivr/migration.sql"
git add src/lib/prisma.ts
git commit -m "feat(6d/schema): VoiceCall + VoiceCallSegment + tenant telephony config"

# ── Step 4: Commit sub-task 6d.2 (telephony adapters) ─────────────────────────
git add src/lib/telephony/
git commit -m "feat(6d/telephony): Exotel/Plivo/Twilio adapter interface"

# ── Step 5: Commit sub-task 6d.3 (STT/TTS stubs) ─────────────────────────────
git add src/lib/voice/
git commit -m "feat(6d/voice): STT + TTS provider abstraction (stubbed for v1)"

# ── Step 6: Commit sub-task 6d.4 (voice agent engine) ────────────────────────
git add src/modules/voice/agent.ts
git add src/modules/voice/agent.test.ts
git commit -m "feat(6d/agent): voice agent dialogue engine with customer memory"

# ── Step 7: Commit sub-task 6d.5 (IVR webhook routes) ────────────────────────
git add "src/app/api/webhooks/voice/"
git commit -m "feat(6d/api): voice + IVR webhook routes"

# ── Step 8: Commit sub-task 6d.6 (conversation sync) ─────────────────────────
git add src/modules/voice/conversation-sync.ts
git add src/modules/voice/conversation-sync.test.ts
git commit -m "feat(6d/conversation): mirror voice segments into Message thread"

# ── Step 9: Commit sub-task 6d.7 (UI + API) ──────────────────────────────────
git add "src/app/api/voice-calls/"
git add "src/app/(dashboard)/settings/voice/"
git add "src/app/(dashboard)/settings/layout.tsx"
git add TODO_BLOCKERS.md
git commit -m "feat(6d/ui): voice call list with segments timeline"

# ── Step 10: Run tests ────────────────────────────────────────────────────────
npx vitest run

# ── Step 11: TypeScript check ─────────────────────────────────────────────────
npx tsc --noEmit

# ── Step 12: Tag completion ───────────────────────────────────────────────────
git tag -a phase-6d-complete -m "6a-6d series complete: intake + multi-channel + payments + voice/IVR"

Write-Host "Phase 6d complete! Remove PHASE_6D_SETUP.ps1 after running."
