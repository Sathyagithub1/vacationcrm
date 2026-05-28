-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AIProviderType" AS ENUM ('CLAUDE', 'OPENAI', 'GEMINI', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."AIToolCallStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BroadcastChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "public"."BroadcastRecipientStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."BroadcastTargetType" AS ENUM ('ALL_CUSTOMERS', 'DEPARTMENT', 'STAGE', 'CUSTOM_FILTER');

-- CreateEnum
CREATE TYPE "public"."CallbackStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "public"."ConversationChannel" AS ENUM ('MANUAL', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'EMAIL', 'SMS', 'TELEGRAM', 'WEBSITE');

-- CreateEnum
CREATE TYPE "public"."ConversationStatus" AS ENUM ('ACTIVE', 'HUMAN_TAKEOVER', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."EscalationReason" AS ENUM ('REPEATED_FAILURE', 'COMPLEX_REQUEST', 'PAYMENT_ISSUE', 'TECHNICAL_ISSUE', 'VIP_CLIENT', 'CUSTOMER_REQUEST');

-- CreateEnum
CREATE TYPE "public"."EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."FollowUpStatus" AS ENUM ('PENDING', 'SENT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."FollowUpType" AS ENUM ('REMINDER', 'QUOTATION', 'DOCUMENT', 'PAYMENT', 'RE_ENGAGE');

-- CreateEnum
CREATE TYPE "public"."KnowledgeBaseType" AS ENUM ('FAQ', 'SOP', 'PRICING', 'DOCUMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."LeadActivityType" AS ENUM ('NOTE', 'STAGE_CHANGE', 'ASSIGNMENT', 'CALL', 'EMAIL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VIP');

-- CreateEnum
CREATE TYPE "public"."LeadScoreTier" AS ENUM ('HOT', 'WARM', 'COOL', 'COLD');

-- CreateEnum
CREATE TYPE "public"."LeadSource" AS ENUM ('WHATSAPP', 'WEBSITE', 'FB', 'IG', 'MANUAL');

-- CreateEnum
CREATE TYPE "public"."MessageSenderType" AS ENUM ('CUSTOMER', 'BOT', 'AGENT');

-- CreateEnum
CREATE TYPE "public"."MessageType" AS ENUM ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'LOCATION', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('LEAD_ASSIGNED', 'FOLLOW_UP_DUE', 'ESCALATION', 'CALLBACK', 'NEW_MESSAGE');

-- CreateEnum
CREATE TYPE "public"."PredictionType" AS ENUM ('FOLLOW_UP_TIME', 'AGENT_MATCH', 'CONVERSION_PROB', 'MESSAGE_DRAFT');

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'DEPT_MANAGER', 'AGENT', 'VIEWER');

-- CreateEnum
CREATE TYPE "public"."StatsDimension" AS ENUM ('DEPARTMENT', 'SOURCE', 'AGENT', 'HOUR', 'DAY', 'STAGE');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIAL', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TriggerType" AS ENUM ('STAGE_CHANGE', 'LEAD_CREATED', 'LEAD_INACTIVE');

-- CreateEnum
CREATE TYPE "public"."WebhookLogStatus" AS ENUM ('PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "public"."WeightCategory" AS ENUM ('ENGAGEMENT', 'ATTRIBUTE', 'HISTORICAL', 'CONVERSATION');

-- CreateEnum
CREATE TYPE "public"."WidgetButtonIcon" AS ENUM ('CHAT', 'HELP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."WidgetPosition" AS ENUM ('BOTTOM_RIGHT', 'BOTTOM_LEFT');

-- CreateEnum
CREATE TYPE "public"."WidgetSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "public"."WidgetType" AS ENUM ('STAT_COUNTER', 'BAR_CHART', 'PIE', 'PROGRESS', 'LIST', 'LINE', 'TABLE', 'FUNNEL', 'ACTIVITY');

-- CreateTable
CREATE TABLE "public"."ai_conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "provider_used" TEXT NOT NULL,
    "model_used" TEXT NOT NULL,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "handoff_reason" TEXT,
    "satisfaction_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_providers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" "public"."AIProviderType" NOT NULL,
    "api_key" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ai_tool_calls" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ai_conversation_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "public"."AIToolCallStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcast_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "status" "public"."BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."broadcasts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" "public"."BroadcastChannel" NOT NULL,
    "target_type" "public"."BroadcastTargetType" NOT NULL,
    "target_filter" JSONB,
    "status" "public"."BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."callbacks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "preferred_time" TIMESTAMP(3) NOT NULL,
    "status" "public"."CallbackStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "callbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."canned_responses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "shortcut" TEXT,
    "created_by" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."channel_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" "public"."ConversationChannel" NOT NULL,
    "credentials" TEXT NOT NULL,
    "webhook_secret" TEXT,
    "config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "customer_id" TEXT,
    "channel" "public"."ConversationChannel" NOT NULL DEFAULT 'MANUAL',
    "status" "public"."ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_agent_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."conversion_stats" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dimension" "public"."StatsDimension" NOT NULL,
    "dimension_value" TEXT NOT NULL,
    "total_leads" INTEGER NOT NULL DEFAULT 0,
    "converted_leads" INTEGER NOT NULL DEFAULT 0,
    "conversion_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_time_to_convert" DOUBLE PRECISION,
    "avg_messages" DOUBLE PRECISION,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversion_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" "public"."ConversationChannel" NOT NULL,
    "external_id" TEXT NOT NULL,
    "display_name" TEXT,
    "profile_pic_url" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "mobile" TEXT NOT NULL,
    "alternate_phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "total_leads" INTEGER NOT NULL DEFAULT 0,
    "last_lead_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."dashboard_widgets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "widget_type" "public"."WidgetType" NOT NULL,
    "title" TEXT NOT NULL,
    "data_source" TEXT NOT NULL,
    "filters" JSONB,
    "size" "public"."WidgetSize" NOT NULL DEFAULT 'SMALL',
    "position" JSONB,
    "refresh_interval" INTEGER NOT NULL DEFAULT 300,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."departments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "website_url" TEXT,
    "knowledge_base_config" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."escalations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "reason" "public"."EscalationReason" NOT NULL,
    "escalated_from" TEXT NOT NULL,
    "escalated_to" TEXT NOT NULL,
    "status" "public"."EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."file_uploads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."follow_up_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT,
    "trigger_type" "public"."TriggerType" NOT NULL,
    "trigger_value" TEXT,
    "follow_up_type" "public"."FollowUpType" NOT NULL,
    "delay_hours" INTEGER NOT NULL,
    "message_template" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."follow_ups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "type" "public"."FollowUpType" NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "status" "public"."FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "message_template" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invitations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "department_id" TEXT,
    "invited_by" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."knowledge_bases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "type" "public"."KnowledgeBaseType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB,
    "embedding_model" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lead_activities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "public"."LeadActivityType" NOT NULL,
    "content" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."lead_scores" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "tier" "public"."LeadScoreTier" NOT NULL,
    "previous_score" INTEGER,
    "previous_tier" "public"."LeadScoreTier",
    "engagement_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attribute_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "historical_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversation_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "factors" JSONB,
    "score_change" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "destination" TEXT,
    "travel_date" TIMESTAMP(3),
    "num_passengers" INTEGER,
    "special_requirement" TEXT,
    "source" "public"."LeadSource" NOT NULL DEFAULT 'MANUAL',
    "stage_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "priority" "public"."LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "is_future_interest" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."message_delivery" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_message_id" TEXT,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'SENT',
    "error_message" TEXT,
    "error_code" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),

    CONSTRAINT "message_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_type" "public"."MessageSenderType" NOT NULL,
    "sender_id" TEXT,
    "content" TEXT NOT NULL,
    "message_type" "public"."MessageType" NOT NULL DEFAULT 'TEXT',
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "channels_sent" JSONB NOT NULL DEFAULT '[]',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."pipeline_stages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "position" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."predictions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" "public"."PredictionType" NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT,
    "accepted" BOOLEAN,
    "outcome" JSONB,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."scoring_weights" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "feature_name" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "category" "public"."WeightCategory" NOT NULL,
    "auto_tuned" BOOLEAN NOT NULL DEFAULT false,
    "last_tuned_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scoring_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "product_name" TEXT NOT NULL DEFAULT 'Holiday Delight CRM',
    "theme_config" JSONB,
    "login_bg_url" TEXT,
    "email_template_config" JSONB,
    "notification_settings" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "address" TEXT,
    "subscription_status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "analytics_settings" JSONB,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_url" TEXT,
    "role" "public"."Role" NOT NULL,
    "department_id" TEXT,
    "notification_preferences" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."webhook_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "channel" "public"."ConversationChannel" NOT NULL,
    "event_type" TEXT,
    "payload" JSONB NOT NULL,
    "status" "public"."WebhookLogStatus" NOT NULL DEFAULT 'PROCESSED',
    "error_message" TEXT,
    "processing_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."widget_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "welcome_message" TEXT,
    "placeholder_text" TEXT,
    "position" "public"."WidgetPosition" NOT NULL DEFAULT 'BOTTOM_RIGHT',
    "button_icon" "public"."WidgetButtonIcon" NOT NULL DEFAULT 'CHAT',
    "theme_override" JSONB,
    "offline_message" TEXT,
    "pre_chat_form" JSONB,
    "quick_actions" JSONB,
    "business_hours" JSONB,
    "auto_open_delay_ms" INTEGER NOT NULL DEFAULT 0,
    "max_concurrent_visitors" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "widget_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."widget_visitors" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "first_page_url" TEXT,
    "referrer_url" TEXT,
    "user_agent" TEXT,
    "ip_country" TEXT,
    "ip_city" TEXT,
    "total_visits" INTEGER NOT NULL DEFAULT 1,
    "total_messages" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "widget_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_conversation_id_idx" ON "public"."ai_conversations"("conversation_id" ASC);

-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_idx" ON "public"."ai_conversations"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "ai_providers_tenant_id_idx" ON "public"."ai_providers"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "ai_tool_calls_ai_conversation_id_idx" ON "public"."ai_tool_calls"("ai_conversation_id" ASC);

-- CreateIndex
CREATE INDEX "ai_tool_calls_tenant_id_idx" ON "public"."ai_tool_calls"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_action_idx" ON "public"."audit_logs"("tenant_id" ASC, "action" ASC);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_idx" ON "public"."audit_logs"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "broadcast_recipients_broadcast_id_idx" ON "public"."broadcast_recipients"("broadcast_id" ASC);

-- CreateIndex
CREATE INDEX "broadcasts_tenant_id_idx" ON "public"."broadcasts"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "callbacks_tenant_id_idx" ON "public"."callbacks"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "canned_responses_tenant_id_idx" ON "public"."canned_responses"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "channel_configs_tenant_id_channel_key" ON "public"."channel_configs"("tenant_id" ASC, "channel" ASC);

-- CreateIndex
CREATE INDEX "channel_configs_tenant_id_idx" ON "public"."channel_configs"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "conversations_tenant_id_idx" ON "public"."conversations"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "conversion_stats_tenant_id_dimension_idx" ON "public"."conversion_stats"("tenant_id" ASC, "dimension" ASC);

-- CreateIndex
CREATE INDEX "customer_channels_customer_id_idx" ON "public"."customer_channels"("customer_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_channels_tenant_id_channel_external_id_key" ON "public"."customer_channels"("tenant_id" ASC, "channel" ASC, "external_id" ASC);

-- CreateIndex
CREATE INDEX "customer_channels_tenant_id_idx" ON "public"."customer_channels"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "customers_tenant_id_idx" ON "public"."customers"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_mobile_key" ON "public"."customers"("tenant_id" ASC, "mobile" ASC);

-- CreateIndex
CREATE INDEX "dashboard_widgets_tenant_id_idx" ON "public"."dashboard_widgets"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "dashboard_widgets_tenant_id_user_id_idx" ON "public"."dashboard_widgets"("tenant_id" ASC, "user_id" ASC);

-- CreateIndex
CREATE INDEX "departments_tenant_id_idx" ON "public"."departments"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenant_id_slug_key" ON "public"."departments"("tenant_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "escalations_tenant_id_idx" ON "public"."escalations"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "file_uploads_tenant_id_idx" ON "public"."file_uploads"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "follow_up_rules_tenant_id_idx" ON "public"."follow_up_rules"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_idx" ON "public"."follow_ups"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_status_scheduled_at_idx" ON "public"."follow_ups"("tenant_id" ASC, "status" ASC, "scheduled_at" ASC);

-- CreateIndex
CREATE INDEX "invitations_tenant_id_idx" ON "public"."invitations"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "invitations_token_idx" ON "public"."invitations"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "public"."invitations"("token" ASC);

-- CreateIndex
CREATE INDEX "knowledge_bases_tenant_id_department_id_idx" ON "public"."knowledge_bases"("tenant_id" ASC, "department_id" ASC);

-- CreateIndex
CREATE INDEX "knowledge_bases_tenant_id_idx" ON "public"."knowledge_bases"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "lead_activities_lead_id_idx" ON "public"."lead_activities"("lead_id" ASC);

-- CreateIndex
CREATE INDEX "lead_activities_tenant_id_idx" ON "public"."lead_activities"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "lead_scores_lead_id_key" ON "public"."lead_scores"("lead_id" ASC);

-- CreateIndex
CREATE INDEX "lead_scores_tenant_id_idx" ON "public"."lead_scores"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "lead_scores_tenant_id_tier_idx" ON "public"."lead_scores"("tenant_id" ASC, "tier" ASC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_to_idx" ON "public"."leads"("tenant_id" ASC, "assigned_to" ASC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_department_id_idx" ON "public"."leads"("tenant_id" ASC, "department_id" ASC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_idx" ON "public"."leads"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_stage_id_idx" ON "public"."leads"("tenant_id" ASC, "stage_id" ASC);

-- CreateIndex
CREATE INDEX "message_delivery_message_id_idx" ON "public"."message_delivery"("message_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "message_delivery_message_id_key" ON "public"."message_delivery"("message_id" ASC);

-- CreateIndex
CREATE INDEX "message_delivery_tenant_id_idx" ON "public"."message_delivery"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "public"."messages"("conversation_id" ASC);

-- CreateIndex
CREATE INDEX "messages_tenant_id_idx" ON "public"."messages"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_idx" ON "public"."notifications"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "public"."notifications"("user_id" ASC, "read_at" ASC);

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "public"."password_reset_tokens"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "public"."password_reset_tokens"("token" ASC);

-- CreateIndex
CREATE INDEX "pipeline_stages_tenant_id_idx" ON "public"."pipeline_stages"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenant_id_slug_key" ON "public"."pipeline_stages"("tenant_id" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "predictions_lead_id_type_idx" ON "public"."predictions"("lead_id" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "predictions_tenant_id_idx" ON "public"."predictions"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "scoring_weights_tenant_id_feature_name_key" ON "public"."scoring_weights"("tenant_id" ASC, "feature_name" ASC);

-- CreateIndex
CREATE INDEX "scoring_weights_tenant_id_idx" ON "public"."scoring_weights"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "public"."tenants"("domain" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "public"."tenants"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "public"."users"("tenant_id" ASC, "email" ASC);

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "public"."users"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "webhook_logs_created_at_idx" ON "public"."webhook_logs"("created_at" ASC);

-- CreateIndex
CREATE INDEX "webhook_logs_tenant_id_idx" ON "public"."webhook_logs"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "widget_configs_tenant_id_department_id_key" ON "public"."widget_configs"("tenant_id" ASC, "department_id" ASC);

-- CreateIndex
CREATE INDEX "widget_configs_tenant_id_idx" ON "public"."widget_configs"("tenant_id" ASC);

-- CreateIndex
CREATE INDEX "widget_visitors_tenant_id_idx" ON "public"."widget_visitors"("tenant_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "widget_visitors_tenant_id_visitor_id_key" ON "public"."widget_visitors"("tenant_id" ASC, "visitor_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_providers" ADD CONSTRAINT "ai_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_ai_conversation_id_fkey" FOREIGN KEY ("ai_conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcasts" ADD CONSTRAINT "broadcasts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."broadcasts" ADD CONSTRAINT "broadcasts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."callbacks" ADD CONSTRAINT "callbacks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."callbacks" ADD CONSTRAINT "callbacks_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."callbacks" ADD CONSTRAINT "callbacks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."callbacks" ADD CONSTRAINT "callbacks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."canned_responses" ADD CONSTRAINT "canned_responses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."canned_responses" ADD CONSTRAINT "canned_responses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."canned_responses" ADD CONSTRAINT "canned_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."channel_configs" ADD CONSTRAINT "channel_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."conversion_stats" ADD CONSTRAINT "conversion_stats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_channels" ADD CONSTRAINT "customer_channels_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_channels" ADD CONSTRAINT "customer_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."departments" ADD CONSTRAINT "departments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_escalated_from_fkey" FOREIGN KEY ("escalated_from") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_escalated_to_fkey" FOREIGN KEY ("escalated_to") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."escalations" ADD CONSTRAINT "escalations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."file_uploads" ADD CONSTRAINT "file_uploads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."file_uploads" ADD CONSTRAINT "file_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."file_uploads" ADD CONSTRAINT "file_uploads_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follow_up_rules" ADD CONSTRAINT "follow_up_rules_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follow_up_rules" ADD CONSTRAINT "follow_up_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follow_ups" ADD CONSTRAINT "follow_ups_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_bases" ADD CONSTRAINT "knowledge_bases_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."knowledge_bases" ADD CONSTRAINT "knowledge_bases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_activities" ADD CONSTRAINT "lead_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_scores" ADD CONSTRAINT "lead_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."lead_scores" ADD CONSTRAINT "lead_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_delivery" ADD CONSTRAINT "message_delivery_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_delivery" ADD CONSTRAINT "message_delivery_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."predictions" ADD CONSTRAINT "predictions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."predictions" ADD CONSTRAINT "predictions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."scoring_weights" ADD CONSTRAINT "scoring_weights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."webhook_logs" ADD CONSTRAINT "webhook_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."widget_configs" ADD CONSTRAINT "widget_configs_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."widget_configs" ADD CONSTRAINT "widget_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."widget_visitors" ADD CONSTRAINT "widget_visitors_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."widget_visitors" ADD CONSTRAINT "widget_visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

