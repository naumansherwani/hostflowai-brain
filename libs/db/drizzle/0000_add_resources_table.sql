CREATE TABLE "subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"plan" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid,
	"parent_event_id" uuid,
	"idempotency_key" text,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_advisor_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_manifest" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'lovable' NOT NULL,
	"version" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_feature_limits" (
	"plan" text PRIMARY KEY NOT NULL,
	"ai_daily_messages" integer DEFAULT -1 NOT NULL,
	"ai_hourly_fair_use" integer DEFAULT 200 NOT NULL,
	"ai_pricing_uses" integer DEFAULT -1 NOT NULL,
	"ai_followups" integer DEFAULT -1 NOT NULL,
	"ai_calendar_monthly" integer DEFAULT -1 NOT NULL,
	"ai_voice_minutes" integer DEFAULT 0 NOT NULL,
	"ai_demand_forecasting" boolean DEFAULT false NOT NULL,
	"ai_conflict_resolution" boolean DEFAULT false NOT NULL,
	"ai_custom_training" boolean DEFAULT false NOT NULL,
	"crm_contacts" integer DEFAULT -1 NOT NULL,
	"bookings_monthly" integer DEFAULT -1 NOT NULL,
	"industries" integer DEFAULT 1 NOT NULL,
	"deal_pipeline" boolean DEFAULT false NOT NULL,
	"white_label_multi_team" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"industry" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fu_user_feature_period_uniq" UNIQUE("user_id","feature_key","period_start")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_users" (
	"phone" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"industry" text,
	"display_name" text,
	"language" text DEFAULT 'en' NOT NULL,
	"onboarding_step" text DEFAULT 'new' NOT NULL,
	"message_count" text DEFAULT '0' NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_conversations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"advisor" text NOT NULL,
	"industry" text NOT NULL,
	"session_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"importance_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "advisor_memory_vault" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"advisor" text NOT NULL,
	"industry" text NOT NULL,
	"memory_type" text NOT NULL,
	"summary" text NOT NULL,
	"raw_context" text DEFAULT '' NOT NULL,
	"importance_score" integer DEFAULT 50 NOT NULL,
	"revenue_impact_score" integer DEFAULT 0 NOT NULL,
	"confidence_level" text DEFAULT 'medium' NOT NULL,
	"times_accessed" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_360_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"industry" text DEFAULT 'unknown' NOT NULL,
	"advisor" text DEFAULT 'unknown' NOT NULL,
	"business_name" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"business_goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pain_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revenue_trends" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"integrations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"total_interactions" integer DEFAULT 0 NOT NULL,
	"last_interaction_at" timestamp with time zone,
	"sherlock_verdicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revenue_prediction" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"profile_completeness" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph_edges" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"from_entity" text NOT NULL,
	"to_entity" text NOT NULL,
	"relation" text NOT NULL,
	"weight" integer DEFAULT 50 NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_graph_nodes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_name" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"submitted_by" text NOT NULL,
	"submitter_name" text,
	"business_name" text,
	"period_label" text NOT NULL,
	"period_type" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"industry" text NOT NULL,
	"source" text DEFAULT 'email' NOT NULL,
	"email_message_id" text,
	"raw_content" text NOT NULL,
	"parsed_metrics" jsonb,
	"total_revenue" numeric(18, 2),
	"previous_revenue" numeric(18, 2),
	"growth_rate" numeric(7, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"ai_summary" text,
	"ai_insights" jsonb,
	"ai_confidence" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligence_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period_label" text NOT NULL,
	"period_type" text NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"s1_executive_summary" text,
	"s2_revenue_impact" jsonb,
	"s3_cost_savings" jsonb,
	"s4_ai_resolution_metrics" jsonb,
	"s5_recovery_engine" jsonb,
	"s6_industry_advisor_insights" jsonb,
	"s7_sherlock_strategic_notes" text,
	"s8_growth_recommendations" jsonb,
	"s9_forecast_next_month" jsonb,
	"s10_net_business_impact" jsonb,
	"data_snapshot" jsonb,
	"confidence_score" integer,
	"data_quality_note" text,
	"status" text DEFAULT 'generating' NOT NULL,
	"processing_error" text,
	"generated_by" text DEFAULT 'manual' NOT NULL,
	"emailed_to" text,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_resolution_issues" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"industry" text NOT NULL,
	"advisor_name" text NOT NULL,
	"session_id" text,
	"issue_summary" text NOT NULL,
	"issue_type" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revenue_risk_level" text DEFAULT 'low' NOT NULL,
	"stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_ms_target" integer NOT NULL,
	"elapsed_ms" integer,
	"escalated_to_sherlock" boolean DEFAULT false NOT NULL,
	"sherlock_review_at" timestamp with time zone,
	"revenue_at_risk_amount" numeric(12, 2),
	"revenue_at_risk_currency" text DEFAULT 'GBP',
	"revenue_protected" numeric(12, 2),
	"resolved_email_sent" boolean DEFAULT false NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_health_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"industry" text NOT NULL,
	"health_score" integer DEFAULT 100 NOT NULL,
	"churn_risk" text DEFAULT 'low' NOT NULL,
	"engagement_score" integer DEFAULT 100 NOT NULL,
	"issue_score" integer DEFAULT 100 NOT NULL,
	"subscription_score" integer DEFAULT 100 NOT NULL,
	"usage_score" integer DEFAULT 100 NOT NULL,
	"revenue_at_risk" numeric(12, 2),
	"revenue_at_risk_currency" text DEFAULT 'GBP' NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"advisor_action" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_benchmarks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"industry" text NOT NULL,
	"period" text NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avg_daily_messages" numeric(8, 2),
	"avg_health_score" numeric(5, 2),
	"avg_resolution_time_ms" numeric(12, 2),
	"top_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_profiles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"industry" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"profile_summary" text,
	"unlocked_kpis" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"industry" text,
	"signal_type" text NOT NULL,
	"topic" text NOT NULL,
	"description" text NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"affected_users" integer DEFAULT 1 NOT NULL,
	"confidence_score" numeric(4, 2) DEFAULT '0.5' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"revenue_impact" numeric(12, 2),
	"sherlock_insight" text,
	"sample_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"period" text NOT NULL,
	"is_acted_upon" boolean DEFAULT false NOT NULL,
	"acted_upon_note" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"industry" text NOT NULL,
	"business_subtype" text,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"resource_name" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"guest_name" text,
	"guest_email" text,
	"guest_phone" text,
	"party_size" integer DEFAULT 1 NOT NULL,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"metadata" jsonb,
	"conflict_checked_at" timestamp with time zone,
	"source" text DEFAULT 'dashboard' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"industry" text NOT NULL,
	"business_subtype" text,
	"resource_type" text NOT NULL,
	"resource_name" text NOT NULL,
	"external_id" text,
	"total_capacity" integer,
	"current_capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"base_rate" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"metadata" jsonb,
	"location_label" text,
	"location_city" text,
	"location_country" text,
	"maintenance_note" text,
	"maintenance_due" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fah_user_created_idx" ON "founder_advisor_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "aul_user_created_idx" ON "ai_usage_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "aul_user_endpoint_idx" ON "ai_usage_log" USING btree ("user_id","endpoint","created_at");--> statement-breakpoint
CREATE INDEX "fu_user_feature_idx" ON "feature_usage" USING btree ("user_id","feature_key");--> statement-breakpoint
CREATE INDEX "ac_user_advisor_created_idx" ON "advisor_conversations" USING btree ("user_id","advisor","created_at");--> statement-breakpoint
CREATE INDEX "ac_session_idx" ON "advisor_conversations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "amv_user_advisor_importance_idx" ON "advisor_memory_vault" USING btree ("user_id","advisor","importance_score");--> statement-breakpoint
CREATE INDEX "amv_user_type_idx" ON "advisor_memory_vault" USING btree ("user_id","memory_type");--> statement-breakpoint
CREATE UNIQUE INDEX "c360_user_idx" ON "customer_360_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kge_user_from_idx" ON "knowledge_graph_edges" USING btree ("user_id","from_entity");--> statement-breakpoint
CREATE INDEX "kge_user_relation_idx" ON "knowledge_graph_edges" USING btree ("user_id","relation");--> statement-breakpoint
CREATE INDEX "kgn_user_type_name_idx" ON "knowledge_graph_nodes" USING btree ("user_id","entity_type","entity_name");--> statement-breakpoint
CREATE INDEX "rr_submitted_by_idx" ON "revenue_reports" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "rr_industry_period_idx" ON "revenue_reports" USING btree ("industry","period_start");--> statement-breakpoint
CREATE INDEX "rr_status_created_idx" ON "revenue_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rr_email_message_id_idx" ON "revenue_reports" USING btree ("email_message_id") WHERE "revenue_reports"."email_message_id" is not null;--> statement-breakpoint
CREATE INDEX "ir_status_created_idx" ON "intelligence_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ir_period_type_idx" ON "intelligence_reports" USING btree ("period_type","period_start");--> statement-breakpoint
CREATE INDEX "ari_user_status_idx" ON "ai_resolution_issues" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "ari_user_created_idx" ON "ai_resolution_issues" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ari_status_idx" ON "ai_resolution_issues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ari_industry_idx" ON "ai_resolution_issues" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "uhs_user_idx" ON "user_health_scores" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uhs_industry_churn_idx" ON "user_health_scores" USING btree ("industry","churn_risk");--> statement-breakpoint
CREATE INDEX "uhs_score_idx" ON "user_health_scores" USING btree ("health_score");--> statement-breakpoint
CREATE UNIQUE INDEX "ib_industry_period_idx" ON "industry_benchmarks" USING btree ("industry","period");--> statement-breakpoint
CREATE UNIQUE INDEX "op_user_industry_idx" ON "onboarding_profiles" USING btree ("user_id","industry");--> statement-breakpoint
CREATE INDEX "ps_industry_period_idx" ON "product_signals" USING btree ("industry","period");--> statement-breakpoint
CREATE INDEX "ps_priority_idx" ON "product_signals" USING btree ("priority","detected_at");--> statement-breakpoint
CREATE INDEX "ps_type_idx" ON "product_signals" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX "bk_user_industry_idx" ON "bookings" USING btree ("user_id","industry");--> statement-breakpoint
CREATE INDEX "bk_resource_time_idx" ON "bookings" USING btree ("resource_id","start_time","end_time");--> statement-breakpoint
CREATE INDEX "bk_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bk_guest_email_idx" ON "bookings" USING btree ("guest_email") WHERE "bookings"."guest_email" is not null;--> statement-breakpoint
CREATE INDEX "bk_start_time_idx" ON "bookings" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "res_user_industry_idx" ON "resources" USING btree ("user_id","industry");--> statement-breakpoint
CREATE INDEX "res_type_status_idx" ON "resources" USING btree ("resource_type","status");--> statement-breakpoint
CREATE INDEX "res_external_id_idx" ON "resources" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "res_active_idx" ON "resources" USING btree ("is_active");