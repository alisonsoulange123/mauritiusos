CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_id" uuid,
	"actor_role" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"result" text NOT NULL,
	"trace_id" text NOT NULL,
	"ip_address" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"consumer" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"succeeded" boolean DEFAULT true NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"supported_locales" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"currency" text DEFAULT 'MUR' NOT NULL,
	"timezone" text DEFAULT 'Indian/Mauritius' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feature_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" integer,
	"prompt_tokens" integer,
	"completion_tokens" integer
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"primary_intent" text,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_user_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_type" text NOT NULL,
	"memory_key" text NOT NULL,
	"memory_value" text NOT NULL,
	"importance" integer DEFAULT 50 NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "assessment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"locale" text DEFAULT 'en' NOT NULL,
	"acquisition_source" text,
	"status" text DEFAULT 'started' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"primary_intent" text,
	"outcome" jsonb,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"nationality" text,
	"current_country" text,
	"birth_date" date,
	"occupation" text,
	"monthly_income" integer,
	"currency" text,
	"family_status" text,
	"journey_stage" text DEFAULT 'visitor' NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"role" text DEFAULT 'lead' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "immigration_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"permit_type" text NOT NULL,
	"description" text,
	"required_documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_confidence" integer DEFAULT 90 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source_url" text,
	"verified_at" text
);
--> statement-breakpoint
CREATE TABLE "immigration_rule_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rule_id" uuid NOT NULL,
	"field" text NOT NULL,
	"operator" text NOT NULL,
	"value" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"knowledge_id" uuid NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model" text DEFAULT 'text-embedding-3-small' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"confidence_score" integer DEFAULT 80 NOT NULL,
	"source_id" uuid,
	"verified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_entity" text NOT NULL,
	"from_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"to_entity" text NOT NULL,
	"to_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"url" text,
	"authority_level" text DEFAULT 'editorial' NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sample_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_time_idx" ON "audit_log" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_events_key" ON "processed_events" USING btree ("event_id","consumer");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_idx" ON "ai_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_created_idx" ON "ai_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_session_idx" ON "ai_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_sessions_tenant_idx" ON "ai_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_sessions_tenant_created_idx" ON "ai_sessions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_sessions_user_idx" ON "ai_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_user_memory_tenant_idx" ON "ai_user_memory" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ai_user_memory_tenant_created_idx" ON "ai_user_memory" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_user_memory_user_idx" ON "ai_user_memory" USING btree ("user_id","importance");--> statement-breakpoint
CREATE INDEX "assessment_sessions_tenant_idx" ON "assessment_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "assessment_sessions_tenant_created_idx" ON "assessment_sessions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "assessment_sessions_status_idx" ON "assessment_sessions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "assessment_sessions_user_idx" ON "assessment_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_user_profiles_tenant_idx" ON "identity_user_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "identity_user_profiles_tenant_created_idx" ON "identity_user_profiles" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_user_profiles_user_idx" ON "identity_user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "identity_users_tenant_idx" ON "identity_users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "identity_users_tenant_created_idx" ON "identity_users" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_users_tenant_email_key" ON "identity_users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "immigration_rules_tenant_idx" ON "immigration_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "immigration_rules_tenant_created_idx" ON "immigration_rules" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "immigration_rules_permit_idx" ON "immigration_rules" USING btree ("tenant_id","permit_type");--> statement-breakpoint
CREATE INDEX "immigration_rule_conditions_tenant_idx" ON "immigration_rule_conditions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "immigration_rule_conditions_tenant_created_idx" ON "immigration_rule_conditions" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "immigration_rule_conditions_rule_idx" ON "immigration_rule_conditions" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "knowledge_embeddings_knowledge_idx" ON "knowledge_embeddings" USING btree ("knowledge_id");--> statement-breakpoint
CREATE INDEX "knowledge_embeddings_hnsw_idx" ON "knowledge_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_items_tenant_idx" ON "knowledge_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_tenant_created_idx" ON "knowledge_items" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_items_tenant_slug_locale_key" ON "knowledge_items" USING btree ("tenant_id","slug","locale");--> statement-breakpoint
CREATE INDEX "knowledge_items_category_idx" ON "knowledge_items" USING btree ("tenant_id","category","status");--> statement-breakpoint
CREATE INDEX "knowledge_relations_tenant_idx" ON "knowledge_relations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "knowledge_relations_tenant_created_idx" ON "knowledge_relations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_relations_from_idx" ON "knowledge_relations" USING btree ("from_entity","from_id");--> statement-breakpoint
CREATE INDEX "knowledge_relations_to_idx" ON "knowledge_relations" USING btree ("to_entity","to_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_tenant_idx" ON "knowledge_sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "knowledge_sources_tenant_created_idx" ON "knowledge_sources" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "sample_items_tenant_idx" ON "sample_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sample_items_tenant_created_idx" ON "sample_items" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_items_tenant_title_key" ON "sample_items" USING btree ("tenant_id","title");