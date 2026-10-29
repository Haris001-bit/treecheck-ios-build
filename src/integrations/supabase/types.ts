export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_deletion_feedback: {
        Row: {
          created_at: string
          details: string | null
          email: string | null
          id: string
          reason: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: string | null
          email?: string | null
          id?: string
          reason: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: string | null
          email?: string | null
          id?: string
          reason?: string
          user_id?: string | null
        }
        Relationships: []
      }
      applications: {
        Row: {
          city: string
          company_name: string
          created_at: string
          email: string
          full_name: string
          id: string
          message: string | null
          phone: string
          reviewed_at: string | null
          status: string
        }
        Insert: {
          city: string
          company_name: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          message?: string | null
          phone: string
          reviewed_at?: string | null
          status?: string
        }
        Update: {
          city?: string
          company_name?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          message?: string | null
          phone?: string
          reviewed_at?: string | null
          status?: string
        }
        Relationships: []
      }
      bid_request_quotes: {
        Row: {
          bid_request_id: string
          booked_date: string | null
          client_match: string | null
          client_match_ambiguous: boolean
          completion_synced_at: string | null
          created_at: string
          duplicate_job_ids: string[]
          formula_sale: number | null
          hire_requested_at: string | null
          hire_requested_by: string | null
          job_checked_at: string | null
          job_claimed_at: string | null
          job_error: string | null
          job_link_source: string | null
          job_state: string
          jobber_client_id: string | null
          jobber_completed_at: string | null
          jobber_job_id: string | null
          jobber_job_number: string | null
          jobber_property_id: string | null
          jobber_quote_deposit: number | null
          jobber_quote_discount: number | null
          jobber_quote_status: string | null
          jobber_quote_subtotal: number | null
          jobber_quote_tax: number | null
          jobber_quote_total: number | null
          line_items: Json | null
          office_alerts: Json
          owner_contractor_id: string
          pick_option: string | null
          previous_quote_ids: string[]
          price_source: string | null
          quote_approved_at: string | null
          quote_attempts: number
          quote_checked_at: string | null
          quote_claimed_at: string | null
          quote_created_at: string | null
          quote_error: string | null
          quote_state: string
          quote_trigger: string | null
          quote_uncertain: boolean
          sale_price: number | null
          updated_at: string
        }
        Insert: {
          bid_request_id: string
          booked_date?: string | null
          client_match?: string | null
          client_match_ambiguous?: boolean
          completion_synced_at?: string | null
          created_at?: string
          duplicate_job_ids?: string[]
          formula_sale?: number | null
          hire_requested_at?: string | null
          hire_requested_by?: string | null
          job_checked_at?: string | null
          job_claimed_at?: string | null
          job_error?: string | null
          job_link_source?: string | null
          job_state?: string
          jobber_client_id?: string | null
          jobber_completed_at?: string | null
          jobber_job_id?: string | null
          jobber_job_number?: string | null
          jobber_property_id?: string | null
          jobber_quote_deposit?: number | null
          jobber_quote_discount?: number | null
          jobber_quote_status?: string | null
          jobber_quote_subtotal?: number | null
          jobber_quote_tax?: number | null
          jobber_quote_total?: number | null
          line_items?: Json | null
          office_alerts?: Json
          owner_contractor_id: string
          pick_option?: string | null
          previous_quote_ids?: string[]
          price_source?: string | null
          quote_approved_at?: string | null
          quote_attempts?: number
          quote_checked_at?: string | null
          quote_claimed_at?: string | null
          quote_created_at?: string | null
          quote_error?: string | null
          quote_state?: string
          quote_trigger?: string | null
          quote_uncertain?: boolean
          sale_price?: number | null
          updated_at?: string
        }
        Update: {
          bid_request_id?: string
          booked_date?: string | null
          client_match?: string | null
          client_match_ambiguous?: boolean
          completion_synced_at?: string | null
          created_at?: string
          duplicate_job_ids?: string[]
          formula_sale?: number | null
          hire_requested_at?: string | null
          hire_requested_by?: string | null
          job_checked_at?: string | null
          job_claimed_at?: string | null
          job_error?: string | null
          job_link_source?: string | null
          job_state?: string
          jobber_client_id?: string | null
          jobber_completed_at?: string | null
          jobber_job_id?: string | null
          jobber_job_number?: string | null
          jobber_property_id?: string | null
          jobber_quote_deposit?: number | null
          jobber_quote_discount?: number | null
          jobber_quote_status?: string | null
          jobber_quote_subtotal?: number | null
          jobber_quote_tax?: number | null
          jobber_quote_total?: number | null
          line_items?: Json | null
          office_alerts?: Json
          owner_contractor_id?: string
          pick_option?: string | null
          previous_quote_ids?: string[]
          price_source?: string | null
          quote_approved_at?: string | null
          quote_attempts?: number
          quote_checked_at?: string | null
          quote_claimed_at?: string | null
          quote_created_at?: string | null
          quote_error?: string | null
          quote_state?: string
          quote_trigger?: string | null
          quote_uncertain?: boolean
          sale_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_request_quotes_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: true
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_request_recipients: {
        Row: {
          bid_request_id: string
          created_at: string
          crew_member_id: string
          id: string
          notified_at: string | null
        }
        Insert: {
          bid_request_id: string
          created_at?: string
          crew_member_id: string
          id?: string
          notified_at?: string | null
        }
        Update: {
          bid_request_id?: string
          created_at?: string
          crew_member_id?: string
          id?: string
          notified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bid_request_recipients_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_request_recipients_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      bid_requests: {
        Row: {
          audience: string
          awarded_bid_id: string | null
          awarded_date: string | null
          awarded_ground_bid_id: string | null
          awarded_ground_date: string | null
          awarded_stump_bid_id: string | null
          capture_id: string | null
          city: string | null
          climber_dates_reminded_at: string | null
          climber_dates_requested_at: string | null
          climber_dates_status: string | null
          completed_at: string | null
          confirmed_dates: Json
          created_at: string
          created_by: string | null
          crew_counts: Json
          customer_address: string | null
          customer_name: string | null
          customer_phone: string | null
          deadline_at: string | null
          description: string | null
          discount_quote_sent_at: string | null
          equipment_needed: string[]
          first_refusal_released_at: string | null
          first_refusal_until: string | null
          fixed_pay: number | null
          fixed_pay_type: string | null
          ground_pay_per_worker: number | null
          hired_at: string | null
          id: string
          jobber_quote_id: string | null
          jobber_quote_number: string | null
          lead_id: string | null
          needs_site_visit: boolean
          needs_stump_grinding: boolean
          offered_dates: Json
          owner_contractor_id: string
          owner_cost: number
          owner_notes: string | null
          paid_at: string | null
          paid_by: string | null
          pay_mode: string
          photo_path: string | null
          photo_paths: string[] | null
          pricing_inputs: Json
          quote_followup_alerted_at: string | null
          quote_pick: Json | null
          quote_sent_at: string | null
          quote_status: string | null
          role_needed: string
          site_visit_done_at: string | null
          status: string
          stump_diameter_inches: number | null
          target_margin_pct: number
          title: string
          trees: Json | null
          updated_at: string
          visit_text_body: string | null
          visit_text_estimate_view: string | null
          visit_text_sent_at: string | null
          workflow_notes: string | null
          workflow_status: string
        }
        Insert: {
          audience?: string
          awarded_bid_id?: string | null
          awarded_date?: string | null
          awarded_ground_bid_id?: string | null
          awarded_ground_date?: string | null
          awarded_stump_bid_id?: string | null
          capture_id?: string | null
          city?: string | null
          climber_dates_reminded_at?: string | null
          climber_dates_requested_at?: string | null
          climber_dates_status?: string | null
          completed_at?: string | null
          confirmed_dates?: Json
          created_at?: string
          created_by?: string | null
          crew_counts?: Json
          customer_address?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deadline_at?: string | null
          description?: string | null
          discount_quote_sent_at?: string | null
          equipment_needed?: string[]
          first_refusal_released_at?: string | null
          first_refusal_until?: string | null
          fixed_pay?: number | null
          fixed_pay_type?: string | null
          ground_pay_per_worker?: number | null
          hired_at?: string | null
          id?: string
          jobber_quote_id?: string | null
          jobber_quote_number?: string | null
          lead_id?: string | null
          needs_site_visit?: boolean
          needs_stump_grinding?: boolean
          offered_dates?: Json
          owner_contractor_id: string
          owner_cost?: number
          owner_notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          pay_mode?: string
          photo_path?: string | null
          photo_paths?: string[] | null
          pricing_inputs?: Json
          quote_followup_alerted_at?: string | null
          quote_pick?: Json | null
          quote_sent_at?: string | null
          quote_status?: string | null
          role_needed?: string
          site_visit_done_at?: string | null
          status?: string
          stump_diameter_inches?: number | null
          target_margin_pct?: number
          title: string
          trees?: Json | null
          updated_at?: string
          visit_text_body?: string | null
          visit_text_estimate_view?: string | null
          visit_text_sent_at?: string | null
          workflow_notes?: string | null
          workflow_status?: string
        }
        Update: {
          audience?: string
          awarded_bid_id?: string | null
          awarded_date?: string | null
          awarded_ground_bid_id?: string | null
          awarded_ground_date?: string | null
          awarded_stump_bid_id?: string | null
          capture_id?: string | null
          city?: string | null
          climber_dates_reminded_at?: string | null
          climber_dates_requested_at?: string | null
          climber_dates_status?: string | null
          completed_at?: string | null
          confirmed_dates?: Json
          created_at?: string
          created_by?: string | null
          crew_counts?: Json
          customer_address?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deadline_at?: string | null
          description?: string | null
          discount_quote_sent_at?: string | null
          equipment_needed?: string[]
          first_refusal_released_at?: string | null
          first_refusal_until?: string | null
          fixed_pay?: number | null
          fixed_pay_type?: string | null
          ground_pay_per_worker?: number | null
          hired_at?: string | null
          id?: string
          jobber_quote_id?: string | null
          jobber_quote_number?: string | null
          lead_id?: string | null
          needs_site_visit?: boolean
          needs_stump_grinding?: boolean
          offered_dates?: Json
          owner_contractor_id?: string
          owner_cost?: number
          owner_notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          pay_mode?: string
          photo_path?: string | null
          photo_paths?: string[] | null
          pricing_inputs?: Json
          quote_followup_alerted_at?: string | null
          quote_pick?: Json | null
          quote_sent_at?: string | null
          quote_status?: string | null
          role_needed?: string
          site_visit_done_at?: string | null
          status?: string
          stump_diameter_inches?: number | null
          target_margin_pct?: number
          title?: string
          trees?: Json | null
          updated_at?: string
          visit_text_body?: string | null
          visit_text_estimate_view?: string | null
          visit_text_sent_at?: string | null
          workflow_notes?: string | null
          workflow_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bid_requests_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "scout_captures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bid_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_secure"
            referencedColumns: ["id"]
          },
        ]
      }
      bids: {
        Row: {
          agreed_pay: number | null
          available_dates: Json
          bid_request_id: string
          bid_role: string
          created_at: string
          crew_member_id: string
          crew_size: number | null
          equipment: string | null
          est_disposal_loads: number | null
          est_hours: number | null
          ground_crew_size: number | null
          id: string
          ideal_pay: number
          min_pay: number
          mini_skid_hours: number | null
          needs_mini_skid: boolean | null
          notes: string | null
          people_count: number | null
          rate_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agreed_pay?: number | null
          available_dates?: Json
          bid_request_id: string
          bid_role?: string
          created_at?: string
          crew_member_id: string
          crew_size?: number | null
          equipment?: string | null
          est_disposal_loads?: number | null
          est_hours?: number | null
          ground_crew_size?: number | null
          id?: string
          ideal_pay: number
          min_pay: number
          mini_skid_hours?: number | null
          needs_mini_skid?: boolean | null
          notes?: string | null
          people_count?: number | null
          rate_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agreed_pay?: number | null
          available_dates?: Json
          bid_request_id?: string
          bid_role?: string
          created_at?: string
          crew_member_id?: string
          crew_size?: number | null
          equipment?: string | null
          est_disposal_loads?: number | null
          est_hours?: number | null
          ground_crew_size?: number | null
          id?: string
          ideal_pay?: number
          min_pay?: number
          mini_skid_hours?: number | null
          needs_mini_skid?: boolean | null
          notes?: string | null
          people_count?: number | null
          rate_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_reminders: {
        Row: {
          kind: string
          owner_id: string
          sent_at: string
        }
        Insert: {
          kind: string
          owner_id: string
          sent_at?: string
        }
        Update: {
          kind?: string
          owner_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_reminders_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_rollout: {
        Row: {
          id: number
          store_sandbox_owner_ids: string[]
          test_owner_ids: string[]
          updated_at: string
          web_live: boolean
        }
        Insert: {
          id?: number
          store_sandbox_owner_ids?: string[]
          test_owner_ids?: string[]
          updated_at?: string
          web_live?: boolean
        }
        Update: {
          id?: number
          store_sandbox_owner_ids?: string[]
          test_owner_ids?: string[]
          updated_at?: string
          web_live?: boolean
        }
        Relationships: []
      }
      communication_consents: {
        Row: {
          channels: string[]
          consent_text: string
          consent_version: string
          created_at: string
          email: string | null
          granted: boolean
          id: string
          ip: string | null
          kind: string
          phone: string | null
          source: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          channels?: string[]
          consent_text: string
          consent_version: string
          created_at?: string
          email?: string | null
          granted: boolean
          id?: string
          ip?: string | null
          kind: string
          phone?: string | null
          source: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          channels?: string[]
          consent_text?: string
          consent_version?: string
          created_at?: string
          email?: string | null
          granted?: boolean
          id?: string
          ip?: string | null
          kind?: string
          phone?: string | null
          source?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      company_access_audit: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          details: Json
          id: number
          owner_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          details?: Json
          id?: never
          owner_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          details?: Json
          id?: never
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_access_audit_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_billing: {
        Row: {
          billing_interval: string
          capacity: Json
          complimentary: boolean
          current_period_end: string | null
          dma_source: string
          environment: string
          owner_id: string
          pending_renewal: Json | null
          pricing_version: string
          provider: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_interval?: string
          capacity?: Json
          complimentary?: boolean
          current_period_end?: string | null
          dma_source?: string
          environment?: string
          owner_id: string
          pending_renewal?: Json | null
          pricing_version?: string
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_interval?: string
          capacity?: Json
          complimentary?: boolean
          current_period_end?: string | null
          dma_source?: string
          environment?: string
          owner_id?: string
          pending_renewal?: Json | null
          pricing_version?: string
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_billing_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_billing_changes: {
        Row: {
          action: string
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          payload: Json
          preview: Json | null
          request_key: string
          status: string
        }
        Insert: {
          action: string
          created_at?: string
          expires_at?: string
          id?: string
          owner_id: string
          payload?: Json
          preview?: Json | null
          request_key: string
          status?: string
        }
        Update: {
          action?: string
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          payload?: Json
          preview?: Json | null
          request_key?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_billing_changes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_billing_locks: {
        Row: {
          expires_at: string
          owner_id: string
          token: string
        }
        Insert: {
          expires_at: string
          owner_id: string
          token: string
        }
        Update: {
          expires_at?: string
          owner_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_billing_locks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_jobber_settings: {
        Row: {
          auto_hire: boolean
          book_jobs: boolean
          busy_visits_per_day: number
          change_note: string | null
          closeout_invoices: boolean
          completion_sync: boolean
          contractor_id: string
          created_at: string
          default_province: string | null
          free_days: boolean
          jobber_import: boolean
          quote_template: Json
          quotes_on_award: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          auto_hire?: boolean
          book_jobs?: boolean
          busy_visits_per_day?: number
          change_note?: string | null
          closeout_invoices?: boolean
          completion_sync?: boolean
          contractor_id: string
          created_at?: string
          default_province?: string | null
          free_days?: boolean
          jobber_import?: boolean
          quote_template?: Json
          quotes_on_award?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          auto_hire?: boolean
          book_jobs?: boolean
          busy_visits_per_day?: number
          change_note?: string | null
          closeout_invoices?: boolean
          completion_sync?: boolean
          contractor_id?: string
          created_at?: string
          default_province?: string | null
          free_days?: boolean
          jobber_import?: boolean
          quote_template?: Json
          quotes_on_award?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_jobber_state: {
        Row: {
          busy_counts: Json | null
          busy_coverage_end: string | null
          busy_fetch_started_at: string | null
          busy_fetched_at: string | null
          busy_window_end: string | null
          busy_window_start: string | null
          contractor_id: string
          digest_sent_on: string | null
          disconnected_alerted_on: string | null
          reconcile_started_at: string | null
          reconciled_at: string | null
          throttle_available: number | null
          throttle_checked_at: string | null
          updated_at: string
          visit_days_started_at: string | null
          visit_days_synced_at: string | null
        }
        Insert: {
          busy_counts?: Json | null
          busy_coverage_end?: string | null
          busy_fetch_started_at?: string | null
          busy_fetched_at?: string | null
          busy_window_end?: string | null
          busy_window_start?: string | null
          contractor_id: string
          digest_sent_on?: string | null
          disconnected_alerted_on?: string | null
          reconcile_started_at?: string | null
          reconciled_at?: string | null
          throttle_available?: number | null
          throttle_checked_at?: string | null
          updated_at?: string
          visit_days_started_at?: string | null
          visit_days_synced_at?: string | null
        }
        Update: {
          busy_counts?: Json | null
          busy_coverage_end?: string | null
          busy_fetch_started_at?: string | null
          busy_fetched_at?: string | null
          busy_window_end?: string | null
          busy_window_start?: string | null
          contractor_id?: string
          digest_sent_on?: string | null
          disconnected_alerted_on?: string | null
          reconcile_started_at?: string | null
          reconciled_at?: string | null
          throttle_available?: number | null
          throttle_checked_at?: string | null
          updated_at?: string
          visit_days_started_at?: string | null
          visit_days_synced_at?: string | null
        }
        Relationships: []
      }
      company_locations: {
        Row: {
          city: string
          free_grace_until: string | null
          free_override: boolean | null
          label: string | null
          latitude: number | null
          longitude: number | null
          owner_id: string
          state: string
          updated_at: string
        }
        Insert: {
          city: string
          free_grace_until?: string | null
          free_override?: boolean | null
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          owner_id: string
          state: string
          updated_at?: string
        }
        Update: {
          city?: string
          free_grace_until?: string | null
          free_override?: boolean | null
          label?: string | null
          latitude?: number | null
          longitude?: number | null
          owner_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_locations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          ai_estimate_visibility: string
          auto_broadcast: boolean
          closed_weekdays: number[]
          contractor_id: string
          created_at: string
          crm: string
          crm_other: string | null
          in_house_roles: string[]
          lead_sources: string[]
          onboarding_completed_at: string | null
          operating_model: string
          scout_learning_enabled: boolean
          scout_learning_website: boolean
          sub_roles: string[]
          sub_usage: string
          updated_at: string
          visit_calendly_url: string | null
          visit_callback_phone: string | null
          visit_signature: string | null
        }
        Insert: {
          ai_estimate_visibility?: string
          auto_broadcast?: boolean
          closed_weekdays?: number[]
          contractor_id: string
          created_at?: string
          crm?: string
          crm_other?: string | null
          in_house_roles?: string[]
          lead_sources?: string[]
          onboarding_completed_at?: string | null
          operating_model?: string
          scout_learning_enabled?: boolean
          scout_learning_website?: boolean
          sub_roles?: string[]
          sub_usage?: string
          updated_at?: string
          visit_calendly_url?: string | null
          visit_callback_phone?: string | null
          visit_signature?: string | null
        }
        Update: {
          ai_estimate_visibility?: string
          auto_broadcast?: boolean
          closed_weekdays?: number[]
          contractor_id?: string
          created_at?: string
          crm?: string
          crm_other?: string | null
          in_house_roles?: string[]
          lead_sources?: string[]
          onboarding_completed_at?: string | null
          operating_model?: string
          scout_learning_enabled?: boolean
          scout_learning_website?: boolean
          sub_roles?: string[]
          sub_usage?: string
          updated_at?: string
          visit_calendly_url?: string | null
          visit_callback_phone?: string | null
          visit_signature?: string | null
        }
        Relationships: []
      }
      contractor_engagement: {
        Row: {
          contractor_id: string
          created_at: string
          current_streak: number
          cycle_count: number
          flagged_for_outreach: boolean
          last_purchase_at: string | null
          last_streak_lead_at: string | null
          updated_at: string
          winback_14d_sent_at: string | null
          winback_30d_sent_at: string | null
          winback_60d_sent_at: string | null
          winback_7d_sent_at: string | null
        }
        Insert: {
          contractor_id: string
          created_at?: string
          current_streak?: number
          cycle_count?: number
          flagged_for_outreach?: boolean
          last_purchase_at?: string | null
          last_streak_lead_at?: string | null
          updated_at?: string
          winback_14d_sent_at?: string | null
          winback_30d_sent_at?: string | null
          winback_60d_sent_at?: string | null
          winback_7d_sent_at?: string | null
        }
        Update: {
          contractor_id?: string
          created_at?: string
          current_streak?: number
          cycle_count?: number
          flagged_for_outreach?: boolean
          last_purchase_at?: string | null
          last_streak_lead_at?: string | null
          updated_at?: string
          winback_14d_sent_at?: string | null
          winback_30d_sent_at?: string | null
          winback_60d_sent_at?: string | null
          winback_7d_sent_at?: string | null
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          contractor_id: string
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          lead_id: string | null
          payment_provider: string | null
          purchase_origin: string | null
          reason_code: string | null
          source_platform: string | null
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_event_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          type: string
        }
        Insert: {
          amount: number
          contractor_id: string
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          lead_id?: string | null
          payment_provider?: string | null
          purchase_origin?: string | null
          reason_code?: string | null
          source_platform?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_event_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          contractor_id?: string
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          lead_id?: string | null
          payment_provider?: string | null
          purchase_origin?: string | null
          reason_code?: string | null
          source_platform?: string | null
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_event_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          type?: string
        }
        Relationships: []
      }
      crew_availability: {
        Row: {
          available_dates: Json
          created_at: string
          crew_member_id: string
          id: string
          notes: string | null
          taking_work: boolean
          unavailable_dates: Json
          updated_at: string
          weekly_days: Json
        }
        Insert: {
          available_dates?: Json
          created_at?: string
          crew_member_id: string
          id?: string
          notes?: string | null
          taking_work?: boolean
          unavailable_dates?: Json
          updated_at?: string
          weekly_days?: Json
        }
        Update: {
          available_dates?: Json
          created_at?: string
          crew_member_id?: string
          id?: string
          notes?: string | null
          taking_work?: boolean
          unavailable_dates?: Json
          updated_at?: string
          weekly_days?: Json
        }
        Relationships: [
          {
            foreignKeyName: "crew_availability_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: true
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_members: {
        Row: {
          can_chipper: boolean
          can_skid_steer: boolean
          certifications: string | null
          crane_certified: boolean
          created_at: string
          disposal_runs_ok: boolean
          email: string | null
          equipment: string | null
          first_refusal: boolean
          full_name: string | null
          has_drivers_license: boolean
          hourly_rate: number | null
          id: string
          insured: string | null
          is_favorite: boolean
          jobs_completed: number
          mini_skid_experience: boolean
          notes: string | null
          owner_contractor_id: string
          owns_saws: boolean
          phone: string | null
          rating_avg: number | null
          rating_count: number
          source: string
          status: string
          trade: string
          tree_experience_level: string | null
          truck_trailer_experience: boolean
          updated_at: string
          user_id: string | null
          wants_ground_work: boolean
          worked_together_before: boolean
          years_climbing: number | null
        }
        Insert: {
          can_chipper?: boolean
          can_skid_steer?: boolean
          certifications?: string | null
          crane_certified?: boolean
          created_at?: string
          disposal_runs_ok?: boolean
          email?: string | null
          equipment?: string | null
          first_refusal?: boolean
          full_name?: string | null
          has_drivers_license?: boolean
          hourly_rate?: number | null
          id?: string
          insured?: string | null
          is_favorite?: boolean
          jobs_completed?: number
          mini_skid_experience?: boolean
          notes?: string | null
          owner_contractor_id: string
          owns_saws?: boolean
          phone?: string | null
          rating_avg?: number | null
          rating_count?: number
          source?: string
          status?: string
          trade?: string
          tree_experience_level?: string | null
          truck_trailer_experience?: boolean
          updated_at?: string
          user_id?: string | null
          wants_ground_work?: boolean
          worked_together_before?: boolean
          years_climbing?: number | null
        }
        Update: {
          can_chipper?: boolean
          can_skid_steer?: boolean
          certifications?: string | null
          crane_certified?: boolean
          created_at?: string
          disposal_runs_ok?: boolean
          email?: string | null
          equipment?: string | null
          first_refusal?: boolean
          full_name?: string | null
          has_drivers_license?: boolean
          hourly_rate?: number | null
          id?: string
          insured?: string | null
          is_favorite?: boolean
          jobs_completed?: number
          mini_skid_experience?: boolean
          notes?: string | null
          owner_contractor_id?: string
          owns_saws?: boolean
          phone?: string | null
          rating_avg?: number | null
          rating_count?: number
          source?: string
          status?: string
          trade?: string
          tree_experience_level?: string | null
          truck_trailer_experience?: boolean
          updated_at?: string
          user_id?: string | null
          wants_ground_work?: boolean
          worked_together_before?: boolean
          years_climbing?: number | null
        }
        Relationships: []
      }
      crew_profiles: {
        Row: {
          created_at: string
          hidden_owner_ids: string[]
          home_city: string | null
          hourly_rate: number | null
          latitude: number | null
          location_label: string | null
          longitude: number | null
          network_visible: boolean
          travel_radius_miles: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hidden_owner_ids?: string[]
          home_city?: string | null
          hourly_rate?: number | null
          latitude?: number | null
          location_label?: string | null
          longitude?: number | null
          network_visible?: boolean
          travel_radius_miles?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hidden_owner_ids?: string[]
          home_city?: string | null
          hourly_rate?: number | null
          latitude?: number | null
          location_label?: string | null
          longitude?: number | null
          network_visible?: boolean
          travel_radius_miles?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crew_ratings: {
        Row: {
          bid_request_id: string | null
          created_at: string
          crew_member_id: string
          id: string
          notes: string | null
          owner_contractor_id: string
          rating: number
          updated_at: string
        }
        Insert: {
          bid_request_id?: string | null
          created_at?: string
          crew_member_id: string
          id?: string
          notes?: string | null
          owner_contractor_id: string
          rating: number
          updated_at?: string
        }
        Update: {
          bid_request_id?: string | null
          created_at?: string
          crew_member_id?: string
          id?: string
          notes?: string | null
          owner_contractor_id?: string
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_ratings_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_ratings_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_interest_alerts: {
        Row: {
          contractor_id: string
          created_at: string
          crm_key: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          crm_key: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          crm_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_interest_alerts_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      device_tokens: {
        Row: {
          account_alerts_enabled: boolean
          app_version: string | null
          contractor_id: string
          created_at: string
          device_id: string | null
          id: string
          last_seen_at: string
          lead_alerts_enabled: boolean
          marketing_alerts_enabled: boolean
          platform: string
          provider: string
          revoked_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          account_alerts_enabled?: boolean
          app_version?: string | null
          contractor_id: string
          created_at?: string
          device_id?: string | null
          id?: string
          last_seen_at?: string
          lead_alerts_enabled?: boolean
          marketing_alerts_enabled?: boolean
          platform?: string
          provider?: string
          revoked_at?: string | null
          token: string
          updated_at?: string
        }
        Update: {
          account_alerts_enabled?: boolean
          app_version?: string | null
          contractor_id?: string
          created_at?: string
          device_id?: string | null
          id?: string
          last_seen_at?: string
          lead_alerts_enabled?: boolean
          marketing_alerts_enabled?: boolean
          platform?: string
          provider?: string
          revoked_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      dma_company_setup: {
        Row: {
          brand_voice: string
          company_name: string
          completed_at: string | null
          contact_name: string
          contractor_id: string
          delivery_email: string
          service_area: string
          updated_at: string
          voice_answers: Json
          voice_preview: string
          website_url: string
        }
        Insert: {
          brand_voice?: string
          company_name?: string
          completed_at?: string | null
          contact_name?: string
          contractor_id: string
          delivery_email: string
          service_area?: string
          updated_at?: string
          voice_answers?: Json
          voice_preview?: string
          website_url?: string
        }
        Update: {
          brand_voice?: string
          company_name?: string
          completed_at?: string | null
          contact_name?: string
          contractor_id?: string
          delivery_email?: string
          service_area?: string
          updated_at?: string
          voice_answers?: Json
          voice_preview?: string
          website_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "dma_company_setup_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dma_email_posts: {
        Row: {
          article: string
          contractor_id: string
          created_at: string
          created_by: string
          delivery_email: string | null
          facebook_caption: string
          free_preview_locked: boolean
          google_caption: string
          id: string
          instagram_caption: string
          notes: string
          photo_paths: string[]
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          article?: string
          contractor_id: string
          created_at?: string
          created_by: string
          delivery_email?: string | null
          facebook_caption?: string
          free_preview_locked?: boolean
          google_caption?: string
          id?: string
          instagram_caption?: string
          notes: string
          photo_paths?: string[]
          status?: string
          title?: string
          updated_at?: string
        }
        Update: {
          article?: string
          contractor_id?: string
          created_at?: string
          created_by?: string
          delivery_email?: string | null
          facebook_caption?: string
          free_preview_locked?: boolean
          google_caption?: string
          id?: string
          instagram_caption?: string
          notes?: string
          photo_paths?: string[]
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dma_email_posts_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dma_email_posts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dma_integrations: {
        Row: {
          brand_voice: string | null
          contractor_id: string
          created_at: string
          facebook_page_access_token: string | null
          facebook_page_id: string | null
          facebook_page_name: string | null
          google_access_token: string | null
          google_account_id: string | null
          google_business_name: string | null
          google_location_id: string | null
          google_refresh_token: string | null
          google_review_link: string | null
          google_token_expires_at: string | null
          has_first_impression: boolean
          id: string
          instagram_business_account_id: string | null
          instagram_handle: string | null
          public_site_url: string | null
          publish_endpoint_url: string | null
          site_provider: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          brand_voice?: string | null
          contractor_id: string
          created_at?: string
          facebook_page_access_token?: string | null
          facebook_page_id?: string | null
          facebook_page_name?: string | null
          google_access_token?: string | null
          google_account_id?: string | null
          google_business_name?: string | null
          google_location_id?: string | null
          google_refresh_token?: string | null
          google_review_link?: string | null
          google_token_expires_at?: string | null
          has_first_impression?: boolean
          id?: string
          instagram_business_account_id?: string | null
          instagram_handle?: string | null
          public_site_url?: string | null
          publish_endpoint_url?: string | null
          site_provider?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          brand_voice?: string | null
          contractor_id?: string
          created_at?: string
          facebook_page_access_token?: string | null
          facebook_page_id?: string | null
          facebook_page_name?: string | null
          google_access_token?: string | null
          google_account_id?: string | null
          google_business_name?: string | null
          google_location_id?: string | null
          google_refresh_token?: string | null
          google_review_link?: string | null
          google_token_expires_at?: string | null
          has_first_impression?: boolean
          id?: string
          instagram_business_account_id?: string | null
          instagram_handle?: string | null
          public_site_url?: string | null
          publish_endpoint_url?: string | null
          site_provider?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      dma_project_revisions: {
        Row: {
          contractor_id: string
          copy_after: Json | null
          copy_before: Json | null
          created_at: string
          error: string | null
          id: string
          project_id: string
          requested_by: string | null
          status: string
          transcript: string | null
          updated_at: string
          voice_memo_path: string | null
        }
        Insert: {
          contractor_id: string
          copy_after?: Json | null
          copy_before?: Json | null
          created_at?: string
          error?: string | null
          id?: string
          project_id: string
          requested_by?: string | null
          status?: string
          transcript?: string | null
          updated_at?: string
          voice_memo_path?: string | null
        }
        Update: {
          contractor_id?: string
          copy_after?: Json | null
          copy_before?: Json | null
          created_at?: string
          error?: string | null
          id?: string
          project_id?: string
          requested_by?: string | null
          status?: string
          transcript?: string | null
          updated_at?: string
          voice_memo_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dma_project_revisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "dma_published_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dma_published_projects: {
        Row: {
          contractor_id: string
          copy: Json
          created_at: string
          id: string
          last_error: string | null
          location: string | null
          photo_paths: string[]
          public_url: string | null
          publish_endpoint_url: string | null
          published_at: string
          revision_count: number
          service_category: string | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          copy?: Json
          created_at?: string
          id?: string
          last_error?: string | null
          location?: string | null
          photo_paths?: string[]
          public_url?: string | null
          publish_endpoint_url?: string | null
          published_at?: string
          revision_count?: number
          service_category?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          copy?: Json
          created_at?: string
          id?: string
          last_error?: string | null
          location?: string | null
          photo_paths?: string[]
          public_url?: string | null
          publish_endpoint_url?: string | null
          published_at?: string
          revision_count?: number
          service_category?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      dma_review_templates: {
        Row: {
          contractor_id: string
          created_at: string
          id: string
          template_text: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          template_text?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          template_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      dma_subscriptions: {
        Row: {
          canceled_at: string | null
          contractor_id: string
          created_at: string
          id: string
          started_at: string
          status: string
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          canceled_at?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          started_at?: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          canceled_at?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          started_at?: string
          status?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      estimate_feedback: {
        Row: {
          ai_estimate_high: number
          ai_estimate_low: number
          contractor_id: string
          created_at: string
          feedback: string
          id: string
          job_type: string
          lead_id: string
          location: string
          updated_at: string
        }
        Insert: {
          ai_estimate_high: number
          ai_estimate_low: number
          contractor_id: string
          created_at?: string
          feedback: string
          id?: string
          job_type: string
          lead_id: string
          location: string
          updated_at?: string
        }
        Update: {
          ai_estimate_high?: number
          ai_estimate_low?: number
          contractor_id?: string
          created_at?: string
          feedback?: string
          id?: string
          job_type?: string
          lead_id?: string
          location?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_feedback_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_feedback_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_secure"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_snapshots: {
        Row: {
          company_id: string
          difficulty: string | null
          inputs: Json
          notes: string | null
          price_max: number | null
          price_min: number | null
          ref_id: string
          result_at: string | null
          risk: string | null
          sent_at: string
          service: string | null
          surface: string
          version_id: string | null
        }
        Insert: {
          company_id: string
          difficulty?: string | null
          inputs?: Json
          notes?: string | null
          price_max?: number | null
          price_min?: number | null
          ref_id: string
          result_at?: string | null
          risk?: string | null
          sent_at?: string
          service?: string | null
          surface: string
          version_id?: string | null
        }
        Update: {
          company_id?: string
          difficulty?: string | null
          inputs?: Json
          notes?: string | null
          price_max?: number | null
          price_min?: number | null
          ref_id?: string
          result_at?: string | null
          risk?: string | null
          sent_at?: string
          service?: string | null
          surface?: string
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estimator_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      free_plan_usage: {
        Row: {
          created_at: string
          id: string
          kind: string
          month: string
          owner_id: string
          ref_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          month: string
          owner_id: string
          ref_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          month?: string
          owner_id?: string
          ref_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_plan_usage_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      free_preview_vault: {
        Row: {
          content: Json
          created_at: string
          kind: string
          owner_id: string
          ref_id: string
        }
        Insert: {
          content: Json
          created_at?: string
          kind: string
          owner_id: string
          ref_id: string
        }
        Update: {
          content?: Json
          created_at?: string
          kind?: string
          owner_id?: string
          ref_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_preview_vault_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      giveaway_entries: {
        Row: {
          company_name: string | null
          consent_text: string | null
          consent_version: string | null
          country: string | null
          created_at: string
          drawn_at: string | null
          email: string
          full_name: string
          giveaway: string
          id: string
          ip: string | null
          phone: string | null
          region: string | null
          rules_version: string
          source: string
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          company_name?: string | null
          consent_text?: string | null
          consent_version?: string | null
          country?: string | null
          created_at?: string
          drawn_at?: string | null
          email: string
          full_name: string
          giveaway: string
          id?: string
          ip?: string | null
          phone?: string | null
          region?: string | null
          rules_version: string
          source: string
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          company_name?: string | null
          consent_text?: string | null
          consent_version?: string | null
          country?: string | null
          created_at?: string
          drawn_at?: string | null
          email?: string
          full_name?: string
          giveaway?: string
          id?: string
          ip?: string | null
          phone?: string | null
          region?: string | null
          rules_version?: string
          source?: string
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      home_ai_summaries: {
        Row: {
          contractor_id: string
          created_at: string
          stats_key: string
          summary: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          stats_key: string
          summary: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          stats_key?: string
          summary?: string
        }
        Relationships: []
      }
      iap_events: {
        Row: {
          contractor_id: string | null
          created_at: string
          event_id: string
          event_type: string | null
          id: string
          payload: Json | null
          product_id: string | null
          transaction_id: string | null
        }
        Insert: {
          contractor_id?: string | null
          created_at?: string
          event_id: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          product_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          contractor_id?: string | null
          created_at?: string
          event_id?: string
          event_type?: string | null
          id?: string
          payload?: Json | null
          product_id?: string | null
          transaction_id?: string | null
        }
        Relationships: []
      }
      iap_lead_unlock_credits: {
        Row: {
          consumed: boolean
          consumed_at: string | null
          contractor_id: string
          created_at: string
          id: string
          lead_id: string | null
          product_id: string
          transaction_id: string
        }
        Insert: {
          consumed?: boolean
          consumed_at?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          lead_id?: string | null
          product_id: string
          transaction_id: string
        }
        Update: {
          consumed?: boolean
          consumed_at?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          lead_id?: string | null
          product_id?: string
          transaction_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invite_token: string
          market: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invite_token?: string
          market?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invite_token?: string
          market?: string
          used_at?: string | null
        }
        Relationships: []
      }
      job_activity: {
        Row: {
          actor_user_id: string | null
          bid_request_id: string
          created_at: string
          id: string
          kind: string
          summary: string
        }
        Insert: {
          actor_user_id?: string | null
          bid_request_id: string
          created_at?: string
          id?: string
          kind: string
          summary: string
        }
        Update: {
          actor_user_id?: string | null
          bid_request_id?: string
          created_at?: string
          id?: string
          kind?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_activity_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_activity_reads: {
        Row: {
          bid_request_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          bid_request_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          bid_request_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_activity_reads_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dispatch_recipients: {
        Row: {
          created_at: string
          crew_member_id: string
          dispatch_id: string
          id: string
          notified_at: string | null
        }
        Insert: {
          created_at?: string
          crew_member_id: string
          dispatch_id: string
          id?: string
          notified_at?: string | null
        }
        Update: {
          created_at?: string
          crew_member_id?: string
          dispatch_id?: string
          id?: string
          notified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_dispatch_recipients_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dispatch_recipients_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "job_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dispatch_responses: {
        Row: {
          available_dates: Json
          created_at: string
          crew_member_id: string
          dispatch_id: string
          id: string
          notes: string | null
          response: string
          status: string
          updated_at: string
        }
        Insert: {
          available_dates?: Json
          created_at?: string
          crew_member_id: string
          dispatch_id: string
          id?: string
          notes?: string | null
          response?: string
          status?: string
          updated_at?: string
        }
        Update: {
          available_dates?: Json
          created_at?: string
          crew_member_id?: string
          dispatch_id?: string
          id?: string
          notes?: string | null
          response?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_dispatch_responses_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_dispatch_responses_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "job_dispatches"
            referencedColumns: ["id"]
          },
        ]
      }
      job_dispatches: {
        Row: {
          address: string | null
          awarded_date: string | null
          bid_request_id: string
          created_at: string
          first_refusal_until: string | null
          hired_crew_member_ids: string[]
          id: string
          jobber_error: string | null
          jobber_job_id: string | null
          jobber_status: string | null
          jobber_visit_id: string | null
          last_daily_reminder_at: string | null
          last_nudged_at: string | null
          more_dates_requested_at: string | null
          more_dates_requested_for: string | null
          offered_dates: Json
          owner_contractor_id: string
          pay_per_worker: number | null
          pay_rate_type: string
          released_at: string | null
          rescheduled_at: string | null
          role: string
          scheduled_date: string | null
          slots: number
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          awarded_date?: string | null
          bid_request_id: string
          created_at?: string
          first_refusal_until?: string | null
          hired_crew_member_ids?: string[]
          id?: string
          jobber_error?: string | null
          jobber_job_id?: string | null
          jobber_status?: string | null
          jobber_visit_id?: string | null
          last_daily_reminder_at?: string | null
          last_nudged_at?: string | null
          more_dates_requested_at?: string | null
          more_dates_requested_for?: string | null
          offered_dates?: Json
          owner_contractor_id: string
          pay_per_worker?: number | null
          pay_rate_type?: string
          released_at?: string | null
          rescheduled_at?: string | null
          role?: string
          scheduled_date?: string | null
          slots?: number
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          awarded_date?: string | null
          bid_request_id?: string
          created_at?: string
          first_refusal_until?: string | null
          hired_crew_member_ids?: string[]
          id?: string
          jobber_error?: string | null
          jobber_job_id?: string | null
          jobber_status?: string | null
          jobber_visit_id?: string | null
          last_daily_reminder_at?: string | null
          last_nudged_at?: string | null
          more_dates_requested_at?: string | null
          more_dates_requested_for?: string | null
          offered_dates?: Json
          owner_contractor_id?: string
          pay_per_worker?: number | null
          pay_rate_type?: string
          released_at?: string | null
          rescheduled_at?: string | null
          role?: string
          scheduled_date?: string | null
          slots?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_dispatches_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_ground_hours: {
        Row: {
          asked_at: string | null
          bid_request_id: string
          created_at: string
          crew_member_id: string
          entered_at: string | null
          entered_by: string | null
          hours: number | null
          id: string
          owner_contractor_id: string
          pay: number | null
          reminded_at: string | null
          updated_at: string
        }
        Insert: {
          asked_at?: string | null
          bid_request_id: string
          created_at?: string
          crew_member_id: string
          entered_at?: string | null
          entered_by?: string | null
          hours?: number | null
          id?: string
          owner_contractor_id: string
          pay?: number | null
          reminded_at?: string | null
          updated_at?: string
        }
        Update: {
          asked_at?: string | null
          bid_request_id?: string
          created_at?: string
          crew_member_id?: string
          entered_at?: string | null
          entered_by?: string | null
          hours?: number | null
          id?: string
          owner_contractor_id?: string
          pay?: number | null
          reminded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_ground_hours_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_ground_hours_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      job_jobber_days: {
        Row: {
          bid_request_id: string
          day: string
          synced_at: string
        }
        Insert: {
          bid_request_id: string
          day: string
          synced_at?: string
        }
        Update: {
          bid_request_id?: string
          day?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_jobber_days_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      job_message_reads: {
        Row: {
          bid_request_id: string
          crew_member_id: string
          last_alert_at: string | null
          last_read_at: string
          user_id: string
        }
        Insert: {
          bid_request_id: string
          crew_member_id: string
          last_alert_at?: string | null
          last_read_at?: string
          user_id: string
        }
        Update: {
          bid_request_id?: string
          crew_member_id?: string
          last_alert_at?: string | null
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_message_reads_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_message_reads_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      job_messages: {
        Row: {
          bid_request_id: string
          body: string
          created_at: string
          crew_member_id: string
          id: string
          sender_name: string | null
          sender_side: string
          sender_user_id: string
        }
        Insert: {
          bid_request_id: string
          body: string
          created_at?: string
          crew_member_id: string
          id?: string
          sender_name?: string | null
          sender_side: string
          sender_user_id: string
        }
        Update: {
          bid_request_id?: string
          body?: string
          created_at?: string
          crew_member_id?: string
          id?: string
          sender_name?: string | null
          sender_side?: string
          sender_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_messages_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_messages_crew_member_id_fkey"
            columns: ["crew_member_id"]
            isOneToOne: false
            referencedRelation: "crew_members"
            referencedColumns: ["id"]
          },
        ]
      }
      job_views: {
        Row: {
          bid_request_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          bid_request_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          bid_request_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_views_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_connect_attempts: {
        Row: {
          owner_id: string
          started_at: string
        }
        Insert: {
          owner_id: string
          started_at?: string
        }
        Update: {
          owner_id?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_connect_attempts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_connect_limit: {
        Row: {
          chosen_owner_ids: string[]
          id: boolean
          max_accounts: number | null
          open_to_all: boolean
          test_owner_ids: string[]
        }
        Insert: {
          chosen_owner_ids?: string[]
          id?: boolean
          max_accounts?: number | null
          open_to_all?: boolean
          test_owner_ids?: string[]
        }
        Update: {
          chosen_owner_ids?: string[]
          id?: boolean
          max_accounts?: number | null
          open_to_all?: boolean
          test_owner_ids?: string[]
        }
        Relationships: []
      }
      jobber_jobs: {
        Row: {
          billing_type: string | null
          completed_at: string | null
          completed_source: string | null
          created_at: string
          deleted_at: string | null
          id: string
          invoice_count: number
          invoiced_total: number | null
          invoices_nonvoid_subtotal: number | null
          invoices_nonvoid_total: number | null
          job_number: number | null
          job_status: string | null
          job_type: string | null
          jobber_account_id: string
          jobber_created_at: string | null
          jobber_job_id: string
          jobber_updated_at: string | null
          owner_id: string
          per_visit_amount: number | null
          synced_at: string | null
          title: string | null
          total: number | null
          updated_at: string
        }
        Insert: {
          billing_type?: string | null
          completed_at?: string | null
          completed_source?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          invoice_count?: number
          invoiced_total?: number | null
          invoices_nonvoid_subtotal?: number | null
          invoices_nonvoid_total?: number | null
          job_number?: number | null
          job_status?: string | null
          job_type?: string | null
          jobber_account_id: string
          jobber_created_at?: string | null
          jobber_job_id: string
          jobber_updated_at?: string | null
          owner_id: string
          per_visit_amount?: number | null
          synced_at?: string | null
          title?: string | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          billing_type?: string | null
          completed_at?: string | null
          completed_source?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          invoice_count?: number
          invoiced_total?: number | null
          invoices_nonvoid_subtotal?: number | null
          invoices_nonvoid_total?: number | null
          job_number?: number | null
          job_status?: string | null
          job_type?: string | null
          jobber_account_id?: string
          jobber_created_at?: string | null
          jobber_job_id?: string
          jobber_updated_at?: string | null
          owner_id?: string
          per_visit_amount?: number | null
          synced_at?: string | null
          title?: string | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_jobs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_oauth_states: {
        Row: {
          contractor_id: string
          created_at: string
          return_to: string | null
          state: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          return_to?: string | null
          state: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          return_to?: string | null
          state?: string
        }
        Relationships: []
      }
      jobber_payments: {
        Row: {
          amount: number
          amount_pre_tax: number
          created_at: string
          deleted_at: string | null
          id: string
          invoice_number: string | null
          job_number: number | null
          jobber_account_id: string
          jobber_invoice_id: string | null
          jobber_job_id: string | null
          jobber_payment_id: string
          jobber_quote_id: string | null
          kind: string
          owner_id: string
          received_at: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          amount_pre_tax: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          invoice_number?: string | null
          job_number?: number | null
          jobber_account_id: string
          jobber_invoice_id?: string | null
          jobber_job_id?: string | null
          jobber_payment_id: string
          jobber_quote_id?: string | null
          kind: string
          owner_id: string
          received_at: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          amount_pre_tax?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          invoice_number?: string | null
          job_number?: number | null
          jobber_account_id?: string
          jobber_invoice_id?: string | null
          jobber_job_id?: string | null
          jobber_payment_id?: string
          jobber_quote_id?: string | null
          kind?: string
          owner_id?: string
          received_at?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_payments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_sync_state: {
        Row: {
          backfill_completed_at: string | null
          backfill_cursor: string | null
          backfill_started_at: string | null
          created_at: string
          granted_scopes: string | null
          incremental_watermark: string | null
          jobs_seen: number
          last_error: string | null
          owner_id: string
          payments_backfill_completed_at: string | null
          payments_backfill_next: number | null
          payments_error: string | null
          payments_lock_until: string | null
          payments_refreshed_at: string | null
          payments_requested: boolean
          scheduled_by_day: Json | null
          scheduled_fetched_at: string | null
          scheduled_status: string | null
          updated_at: string
        }
        Insert: {
          backfill_completed_at?: string | null
          backfill_cursor?: string | null
          backfill_started_at?: string | null
          created_at?: string
          granted_scopes?: string | null
          incremental_watermark?: string | null
          jobs_seen?: number
          last_error?: string | null
          owner_id: string
          payments_backfill_completed_at?: string | null
          payments_backfill_next?: number | null
          payments_error?: string | null
          payments_lock_until?: string | null
          payments_refreshed_at?: string | null
          payments_requested?: boolean
          scheduled_by_day?: Json | null
          scheduled_fetched_at?: string | null
          scheduled_status?: string | null
          updated_at?: string
        }
        Update: {
          backfill_completed_at?: string | null
          backfill_cursor?: string | null
          backfill_started_at?: string | null
          created_at?: string
          granted_scopes?: string | null
          incremental_watermark?: string | null
          jobs_seen?: number
          last_error?: string | null
          owner_id?: string
          payments_backfill_completed_at?: string | null
          payments_backfill_next?: number | null
          payments_error?: string | null
          payments_lock_until?: string | null
          payments_refreshed_at?: string | null
          payments_requested?: boolean
          scheduled_by_day?: Json | null
          scheduled_fetched_at?: string | null
          scheduled_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_sync_state_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_tokens: {
        Row: {
          access_token: string
          account_name: string | null
          contractor_id: string
          created_at: string
          disconnected_at: string | null
          expires_at: string
          id: string
          jobber_account_id: string | null
          refresh_lock_until: string | null
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          account_name?: string | null
          contractor_id: string
          created_at?: string
          disconnected_at?: string | null
          expires_at: string
          id?: string
          jobber_account_id?: string | null
          refresh_lock_until?: string | null
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_name?: string | null
          contractor_id?: string
          created_at?: string
          disconnected_at?: string | null
          expires_at?: string
          id?: string
          jobber_account_id?: string | null
          refresh_lock_until?: string | null
          refresh_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      jobber_visit_revenue: {
        Row: {
          amount: number
          completed_at: string
          created_at: string
          deleted_at: string | null
          id: string
          jobber_account_id: string
          jobber_job_id: string
          jobber_visit_id: string
          owner_id: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          completed_at: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          jobber_account_id: string
          jobber_job_id: string
          jobber_visit_id: string
          owner_id: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          completed_at?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          jobber_account_id?: string
          jobber_job_id?: string
          jobber_visit_id?: string
          owner_id?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_visit_revenue_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_waitlist: {
        Row: {
          alerted_at: string | null
          created_at: string
          last_tried_at: string
          owner_id: string
        }
        Insert: {
          alerted_at?: string | null
          created_at?: string
          last_tried_at?: string
          owner_id: string
        }
        Update: {
          alerted_at?: string | null
          created_at?: string
          last_tried_at?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobber_waitlist_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobber_webhook_events: {
        Row: {
          account_id: string | null
          closeout_id: string | null
          created_at: string
          id: string
          item_id: string | null
          lead_id: string | null
          payload: Json
          process_error: string | null
          processed: boolean
          processed_at: string | null
          signature_valid: boolean
          topic: string
        }
        Insert: {
          account_id?: string | null
          closeout_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          lead_id?: string | null
          payload: Json
          process_error?: string | null
          processed?: boolean
          processed_at?: string | null
          signature_valid?: boolean
          topic: string
        }
        Update: {
          account_id?: string | null
          closeout_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          lead_id?: string | null
          payload?: Json
          process_error?: string | null
          processed?: boolean
          processed_at?: string | null
          signature_valid?: boolean
          topic?: string
        }
        Relationships: []
      }
      lead_closeouts: {
        Row: {
          contractor_id: string
          created_at: string
          id: string
          jobber_client_id: string | null
          jobber_invoice_id: string | null
          jobber_invoice_number: string | null
          jobber_job_id: string | null
          jobber_sync_error: string | null
          jobber_sync_status: string
          jobber_synced_at: string | null
          lead_id: string
          notes: string | null
          purchase_id: string
          review_requested: boolean
          review_requested_at: string | null
          sale_amount: number
          source_origin: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          jobber_client_id?: string | null
          jobber_invoice_id?: string | null
          jobber_invoice_number?: string | null
          jobber_job_id?: string | null
          jobber_sync_error?: string | null
          jobber_sync_status?: string
          jobber_synced_at?: string | null
          lead_id: string
          notes?: string | null
          purchase_id: string
          review_requested?: boolean
          review_requested_at?: string | null
          sale_amount: number
          source_origin?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          jobber_client_id?: string | null
          jobber_invoice_id?: string | null
          jobber_invoice_number?: string | null
          jobber_job_id?: string | null
          jobber_sync_error?: string | null
          jobber_sync_status?: string
          jobber_synced_at?: string | null
          lead_id?: string
          notes?: string | null
          purchase_id?: string
          review_requested?: boolean
          review_requested_at?: string | null
          sale_amount?: number
          source_origin?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_purchases: {
        Row: {
          contractor_id: string
          id: string
          lead_id: string
          purchase_amount: number
          purchased_at: string
        }
        Insert: {
          contractor_id: string
          id?: string
          lead_id: string
          purchase_amount: number
          purchased_at?: string
        }
        Update: {
          contractor_id?: string
          id?: string
          lead_id?: string
          purchase_amount?: number
          purchased_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_purchases_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_purchases_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_purchases_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_secure"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          city: string | null
          created_at: string
          customer_address: string | null
          customer_email: string | null
          customer_name: string
          customer_notes: string | null
          customer_phone: string | null
          estimated_cost_max: number | null
          estimated_cost_min: number | null
          id: string
          is_sample: boolean
          job_type: string
          jobber_client_id: string | null
          jobber_invoice_id: string | null
          jobber_job_id: string | null
          last_purchased_at: string | null
          owner_contractor_id: string | null
          photo_url: string | null
          purchase_count: number
          source: string
          status: string
          urgency: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_name: string
          customer_notes?: string | null
          customer_phone?: string | null
          estimated_cost_max?: number | null
          estimated_cost_min?: number | null
          id?: string
          is_sample?: boolean
          job_type?: string
          jobber_client_id?: string | null
          jobber_invoice_id?: string | null
          jobber_job_id?: string | null
          last_purchased_at?: string | null
          owner_contractor_id?: string | null
          photo_url?: string | null
          purchase_count?: number
          source?: string
          status?: string
          urgency?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_notes?: string | null
          customer_phone?: string | null
          estimated_cost_max?: number | null
          estimated_cost_min?: number | null
          id?: string
          is_sample?: boolean
          job_type?: string
          jobber_client_id?: string | null
          jobber_invoice_id?: string | null
          jobber_job_id?: string | null
          last_purchased_at?: string | null
          owner_contractor_id?: string | null
          photo_url?: string | null
          purchase_count?: number
          source?: string
          status?: string
          urgency?: string | null
        }
        Relationships: []
      }
      lsa_leads: {
        Row: {
          contractor_id: string
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          first_response_at: string | null
          id: string
          job_type: string | null
          lead_type: string
          message: string | null
          notes: string | null
          outcome: string
          raw_payload: Json | null
          received_at: string
          response_channel: string | null
          retell_call_id: string | null
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          first_response_at?: string | null
          id?: string
          job_type?: string | null
          lead_type: string
          message?: string | null
          notes?: string | null
          outcome?: string
          raw_payload?: Json | null
          received_at?: string
          response_channel?: string | null
          retell_call_id?: string | null
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          first_response_at?: string | null
          id?: string
          job_type?: string | null
          lead_type?: string
          message?: string | null
          notes?: string | null
          outcome?: string
          raw_payload?: Json | null
          received_at?: string
          response_channel?: string | null
          retell_call_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      lsa_settings: {
        Row: {
          after_hours_behavior: string
          callback_number: string | null
          contractor_id: string
          created_at: string
          enabled: boolean
          office_hours_end: string
          office_hours_start: string
          retell_agent_id: string | null
          sms_template: string
          updated_at: string
        }
        Insert: {
          after_hours_behavior?: string
          callback_number?: string | null
          contractor_id: string
          created_at?: string
          enabled?: boolean
          office_hours_end?: string
          office_hours_start?: string
          retell_agent_id?: string | null
          sms_template?: string
          updated_at?: string
        }
        Update: {
          after_hours_behavior?: string
          callback_number?: string | null
          contractor_id?: string
          created_at?: string
          enabled?: boolean
          office_hours_end?: string
          office_hours_start?: string
          retell_agent_id?: string | null
          sms_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketing_profiles: {
        Row: {
          bio: string | null
          contractor_id: string
          created_at: string
          id: string
          is_active: boolean | null
          isa_certified: boolean | null
          isa_credentials: string | null
          photo_url: string | null
          stripe_subscription_id: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          bio?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          isa_certified?: boolean | null
          isa_credentials?: string | null
          photo_url?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          bio?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          isa_certified?: boolean | null
          isa_credentials?: string | null
          photo_url?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      mobile_unlock_intents: {
        Row: {
          consumed_at: string | null
          contractor_id: string
          created_at: string
          currency: string
          expires_at: string
          id: string
          lead_id: string
          quoted_unlock_fee: number
          source_platform: string
          status: string
          token_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          contractor_id: string
          created_at?: string
          currency?: string
          expires_at: string
          id?: string
          lead_id: string
          quoted_unlock_fee: number
          source_platform?: string
          status?: string
          token_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          contractor_id?: string
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          lead_id?: string
          quoted_unlock_fee?: number
          source_platform?: string
          status?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          blocked_reason: string | null
          contractor_id: string
          created_at: string
          delivered: boolean
          id: string
          lead_id: string | null
          notification_type: string
          payload: Json | null
          platform: string | null
        }
        Insert: {
          blocked_reason?: string | null
          contractor_id: string
          created_at?: string
          delivered?: boolean
          id?: string
          lead_id?: string | null
          notification_type: string
          payload?: Json | null
          platform?: string | null
        }
        Update: {
          blocked_reason?: string | null
          contractor_id?: string
          created_at?: string
          delivered?: boolean
          id?: string
          lead_id?: string | null
          notification_type?: string
          payload?: Json | null
          platform?: string | null
        }
        Relationships: []
      }
      pay_week_notices: {
        Row: {
          owner_contractor_id: string
          sent_at: string
          week_start: string
        }
        Insert: {
          owner_contractor_id: string
          sent_at?: string
          week_start: string
        }
        Update: {
          owner_contractor_id?: string
          sent_at?: string
          week_start?: string
        }
        Relationships: []
      }
      pending_entitlements: {
        Row: {
          created_at: string
          current_period_end: string | null
          email: string
          id: string
          product: string
          seat_count: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          email: string
          id?: string
          product: string
          seat_count?: number
          status: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          email?: string
          id?: string
          product?: string
          seat_count?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      plaid_accounts: {
        Row: {
          account_id: string
          balance_as_of: string | null
          balance_available: number | null
          balance_current: number | null
          balance_limit: number | null
          count_from_confirmed_at: string | null
          created_at: string
          holder_category: string | null
          id: string
          include_from: string | null
          is_business: boolean
          iso_currency_code: string | null
          item_row_id: string
          mask: string | null
          name: string | null
          official_name: string | null
          owner_id: string
          persistent_account_id: string | null
          status: string
          subtype: string | null
          type: string | null
          updated_at: string
          use_for_payroll: boolean
        }
        Insert: {
          account_id: string
          balance_as_of?: string | null
          balance_available?: number | null
          balance_current?: number | null
          balance_limit?: number | null
          count_from_confirmed_at?: string | null
          created_at?: string
          holder_category?: string | null
          id?: string
          include_from?: string | null
          is_business?: boolean
          iso_currency_code?: string | null
          item_row_id: string
          mask?: string | null
          name?: string | null
          official_name?: string | null
          owner_id: string
          persistent_account_id?: string | null
          status?: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
          use_for_payroll?: boolean
        }
        Update: {
          account_id?: string
          balance_as_of?: string | null
          balance_available?: number | null
          balance_current?: number | null
          balance_limit?: number | null
          count_from_confirmed_at?: string | null
          created_at?: string
          holder_category?: string | null
          id?: string
          include_from?: string | null
          is_business?: boolean
          iso_currency_code?: string | null
          item_row_id?: string
          mask?: string | null
          name?: string | null
          official_name?: string | null
          owner_id?: string
          persistent_account_id?: string | null
          status?: string
          subtype?: string | null
          type?: string | null
          updated_at?: string
          use_for_payroll?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "plaid_accounts_item_row_id_fkey"
            columns: ["item_row_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_item_secrets: {
        Row: {
          access_token_ct: string
          access_token_iv: string
          balance_checked_at: string | null
          item_row_id: string
          key_version: number
          sync_cursor: string | null
          sync_lock_until: string | null
          updated_at: string
        }
        Insert: {
          access_token_ct: string
          access_token_iv: string
          balance_checked_at?: string | null
          item_row_id: string
          key_version?: number
          sync_cursor?: string | null
          sync_lock_until?: string | null
          updated_at?: string
        }
        Update: {
          access_token_ct?: string
          access_token_iv?: string
          balance_checked_at?: string | null
          item_row_id?: string
          key_version?: number
          sync_cursor?: string | null
          sync_lock_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_item_secrets_item_row_id_fkey"
            columns: ["item_row_id"]
            isOneToOne: true
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          consent_expiration_time: string | null
          created_at: string
          error_at: string | null
          error_code: string | null
          historical_update_complete: boolean
          id: string
          initial_update_complete: boolean
          institution_id: string | null
          institution_name: string | null
          item_id: string
          last_successful_update: string | null
          last_synced_at: string | null
          last_webhook_at: string | null
          linked_at: string
          linked_by: string | null
          new_accounts_available: boolean
          owner_id: string
          plaid_env: string
          removed_at: string | null
          resync_requested: boolean
          status: string
          updated_at: string
        }
        Insert: {
          consent_expiration_time?: string | null
          created_at?: string
          error_at?: string | null
          error_code?: string | null
          historical_update_complete?: boolean
          id?: string
          initial_update_complete?: boolean
          institution_id?: string | null
          institution_name?: string | null
          item_id: string
          last_successful_update?: string | null
          last_synced_at?: string | null
          last_webhook_at?: string | null
          linked_at?: string
          linked_by?: string | null
          new_accounts_available?: boolean
          owner_id: string
          plaid_env: string
          removed_at?: string | null
          resync_requested?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          consent_expiration_time?: string | null
          created_at?: string
          error_at?: string | null
          error_code?: string | null
          historical_update_complete?: boolean
          id?: string
          initial_update_complete?: boolean
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string
          last_successful_update?: string | null
          last_synced_at?: string | null
          last_webhook_at?: string | null
          linked_at?: string
          linked_by?: string | null
          new_accounts_available?: boolean
          owner_id?: string
          plaid_env?: string
          removed_at?: string | null
          resync_requested?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_link_consents: {
        Row: {
          consent_version: string
          consented_at: string
          id: string
          institution_id: string | null
          link_session_id: string | null
          owner_id: string
          user_id: string
        }
        Insert: {
          consent_version: string
          consented_at?: string
          id?: string
          institution_id?: string | null
          link_session_id?: string | null
          owner_id: string
          user_id: string
        }
        Update: {
          consent_version?: string
          consented_at?: string
          id?: string
          institution_id?: string | null
          link_session_id?: string | null
          owner_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_link_consents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_slot_ledger: {
        Row: {
          created_at: string
          expires_at: string | null
          id: number
          institution_id: string | null
          item_id: string | null
          link_session_id: string | null
          owner_id: string
          plaid_env: string
          recovery_ct: string | null
          recovery_iv: string | null
          removed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: number
          institution_id?: string | null
          item_id?: string | null
          link_session_id?: string | null
          owner_id: string
          plaid_env: string
          recovery_ct?: string | null
          recovery_iv?: string | null
          removed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: number
          institution_id?: string | null
          item_id?: string | null
          link_session_id?: string | null
          owner_id?: string
          plaid_env?: string
          recovery_ct?: string | null
          recovery_iv?: string | null
          removed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      plaid_transactions: {
        Row: {
          account_row_id: string
          amount: number
          authorized_date: string | null
          category_key: string | null
          classified_at: string | null
          classified_by: string | null
          counterparty_name: string | null
          counterparty_type: string | null
          created_at: string
          exclude_reason: string | null
          id: string
          iso_currency_code: string | null
          matched_transaction_id: string | null
          merchant_entity_id: string | null
          merchant_name: string | null
          name: string | null
          owner_id: string
          payee: string | null
          payment_channel: string | null
          pending: boolean
          pending_transaction_id: string | null
          pfc_confidence: string | null
          pfc_detailed: string | null
          pfc_primary: string | null
          plaid_seen_at: string | null
          review: boolean
          rule_id: string | null
          sorter_version: string | null
          transaction_id: string
          treatment: string
          txn_date: string
          updated_at: string
        }
        Insert: {
          account_row_id: string
          amount: number
          authorized_date?: string | null
          category_key?: string | null
          classified_at?: string | null
          classified_by?: string | null
          counterparty_name?: string | null
          counterparty_type?: string | null
          created_at?: string
          exclude_reason?: string | null
          id?: string
          iso_currency_code?: string | null
          matched_transaction_id?: string | null
          merchant_entity_id?: string | null
          merchant_name?: string | null
          name?: string | null
          owner_id: string
          payee?: string | null
          payment_channel?: string | null
          pending: boolean
          pending_transaction_id?: string | null
          pfc_confidence?: string | null
          pfc_detailed?: string | null
          pfc_primary?: string | null
          plaid_seen_at?: string | null
          review?: boolean
          rule_id?: string | null
          sorter_version?: string | null
          transaction_id: string
          treatment?: string
          txn_date: string
          updated_at?: string
        }
        Update: {
          account_row_id?: string
          amount?: number
          authorized_date?: string | null
          category_key?: string | null
          classified_at?: string | null
          classified_by?: string | null
          counterparty_name?: string | null
          counterparty_type?: string | null
          created_at?: string
          exclude_reason?: string | null
          id?: string
          iso_currency_code?: string | null
          matched_transaction_id?: string | null
          merchant_entity_id?: string | null
          merchant_name?: string | null
          name?: string | null
          owner_id?: string
          payee?: string | null
          payment_channel?: string | null
          pending?: boolean
          pending_transaction_id?: string | null
          pfc_confidence?: string | null
          pfc_detailed?: string | null
          pfc_primary?: string | null
          plaid_seen_at?: string | null
          review?: boolean
          rule_id?: string | null
          sorter_version?: string | null
          transaction_id?: string
          treatment?: string
          txn_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_transactions_account_row_id_fkey"
            columns: ["account_row_id"]
            isOneToOne: false
            referencedRelation: "plaid_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_transactions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_transactions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "pulse_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      postcard_sends: {
        Row: {
          contractor_id: string
          cost_cents: number | null
          created_at: string
          delivered_at: string | null
          error_message: string | null
          id: string
          is_test: boolean
          merge_variables: Json | null
          postgrid_id: string | null
          postgrid_template_id: string | null
          recipient_address: Json
          recipient_name: string | null
          return_address: Json
          scout_capture_id: string
          send_to_postgrid_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          cost_cents?: number | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          is_test?: boolean
          merge_variables?: Json | null
          postgrid_id?: string | null
          postgrid_template_id?: string | null
          recipient_address: Json
          recipient_name?: string | null
          return_address: Json
          scout_capture_id: string
          send_to_postgrid_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          cost_cents?: number | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          is_test?: boolean
          merge_variables?: Json | null
          postgrid_id?: string | null
          postgrid_template_id?: string | null
          recipient_address?: Json
          recipient_name?: string | null
          return_address?: Json
          scout_capture_id?: string
          send_to_postgrid_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "postcard_sends_scout_capture_id_fkey"
            columns: ["scout_capture_id"]
            isOneToOne: false
            referencedRelation: "scout_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_rotation: {
        Row: {
          assigned_at: string
          contractor_id: string
          expires_at: string
          id: string
          lead_id: string
          position: number
        }
        Insert: {
          assigned_at?: string
          contractor_id: string
          expires_at?: string
          id?: string
          lead_id: string
          position: number
        }
        Update: {
          assigned_at?: string
          contractor_id?: string
          expires_at?: string
          id?: string
          lead_id?: string
          position?: number
        }
        Relationships: []
      }
      premium_rotation_state: {
        Row: {
          id: number
          next_index: number
          updated_at: string
        }
        Insert: {
          id?: number
          next_index?: number
          updated_at?: string
        }
        Update: {
          id?: number
          next_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      pricing_defaults: {
        Row: {
          contractor_id: string
          created_at: string
          crew_share: number
          disposal_rate: number
          estimator_dollar: number
          estimator_percent: number
          fixed_dollar: number
          fixed_percent: number
          ground_pay_per_worker: number
          labor_rate: number
          owner_minimum: number
          owner_minimum_enabled: boolean
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          crew_share?: number
          disposal_rate?: number
          estimator_dollar?: number
          estimator_percent?: number
          fixed_dollar?: number
          fixed_percent?: number
          ground_pay_per_worker?: number
          labor_rate?: number
          owner_minimum?: number
          owner_minimum_enabled?: boolean
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          crew_share?: number
          disposal_rate?: number
          estimator_dollar?: number
          estimator_percent?: number
          fixed_dollar?: number
          fixed_percent?: number
          ground_pay_per_worker?: number
          labor_rate?: number
          owner_minimum?: number
          owner_minimum_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      product_entitlements: {
        Row: {
          contractor_id: string
          created_at: string
          current_period_end: string | null
          id: string
          metadata: Json
          product: string
          seat_count: number
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          metadata?: Json
          product: string
          seat_count?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          metadata?: Json
          product?: string
          seat_count?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_entitlements_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_calibrations: {
        Row: {
          actual_crew: Json | null
          actual_duration_hours: number | null
          actual_equipment: string[] | null
          actual_loads: number | null
          actual_method: string | null
          actual_person_hours: number | null
          ai_characteristics: Json | null
          ai_model: string | null
          completed_at: string | null
          confirmed_characteristics: Json | null
          contractor_id: string
          created_at: string
          engine_version: string | null
          id: string
          inputs: Json | null
          notes: string | null
          owner_hints: Json | null
          photo_paths: string[]
          predicted_at: string | null
          predicted_plan: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          actual_crew?: Json | null
          actual_duration_hours?: number | null
          actual_equipment?: string[] | null
          actual_loads?: number | null
          actual_method?: string | null
          actual_person_hours?: number | null
          ai_characteristics?: Json | null
          ai_model?: string | null
          completed_at?: string | null
          confirmed_characteristics?: Json | null
          contractor_id: string
          created_at?: string
          engine_version?: string | null
          id?: string
          inputs?: Json | null
          notes?: string | null
          owner_hints?: Json | null
          photo_paths?: string[]
          predicted_at?: string | null
          predicted_plan?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          actual_crew?: Json | null
          actual_duration_hours?: number | null
          actual_equipment?: string[] | null
          actual_loads?: number | null
          actual_method?: string | null
          actual_person_hours?: number | null
          ai_characteristics?: Json | null
          ai_model?: string | null
          completed_at?: string | null
          confirmed_characteristics?: Json | null
          contractor_id?: string
          created_at?: string
          engine_version?: string | null
          id?: string
          inputs?: Json | null
          notes?: string | null
          owner_hints?: Json | null
          photo_paths?: string[]
          predicted_at?: string | null
          predicted_plan?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_equipment: {
        Row: {
          contractor_id: string
          created_at: string
          equipment_key: string
          hourly_cost: number
          id: string
          name: string
          sort_order: number
          unit: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          equipment_key: string
          hourly_cost?: number
          id?: string
          name: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          equipment_key?: string
          hourly_cost?: number
          id?: string
          name?: string
          sort_order?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_estimate_costs: {
        Row: {
          computed_at: string
          contractor_id: string
          created_at: string
          estimate_id: string
          items: Json
          rates: Json
          totals: Json
          updated_at: string
        }
        Insert: {
          computed_at?: string
          contractor_id: string
          created_at?: string
          estimate_id: string
          items?: Json
          rates?: Json
          totals?: Json
          updated_at?: string
        }
        Update: {
          computed_at?: string
          contractor_id?: string
          created_at?: string
          estimate_id?: string
          items?: Json
          rates?: Json
          totals?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_estimate_costs_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_estimate_costs_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: true
            referencedRelation: "production_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      production_estimates: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_via: string | null
          backlog_weeks_at_sale: number | null
          backlog_weeks_at_send: number | null
          branch_key: string | null
          completed_at: string | null
          consultation: Json | null
          contractor_id: string
          created_at: string
          created_by: string | null
          customer: Json
          id: string
          jobber_client_id: string | null
          jobber_property_id: string | null
          jobber_quote_id: string | null
          jobber_quote_number: string | null
          lost_at: string | null
          lost_reason: string | null
          number: number
          payment_plan: Json | null
          pricing_engine_version: string
          production_engine_version: string
          profile: string
          promised_window: Json | null
          quote_claimed_at: string | null
          quote_error: string | null
          quote_state: string | null
          rate_card_id: string
          rate_card_version: number | null
          revision_of: string | null
          salesperson_id: string | null
          sent_at: string | null
          sent_snapshot: Json | null
          status: string
          totals: Json
          trees: Json
          updated_at: string
          work_items: Json
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_via?: string | null
          backlog_weeks_at_sale?: number | null
          backlog_weeks_at_send?: number | null
          branch_key?: string | null
          completed_at?: string | null
          consultation?: Json | null
          contractor_id: string
          created_at?: string
          created_by?: string | null
          customer?: Json
          id?: string
          jobber_client_id?: string | null
          jobber_property_id?: string | null
          jobber_quote_id?: string | null
          jobber_quote_number?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          number: number
          payment_plan?: Json | null
          pricing_engine_version: string
          production_engine_version: string
          profile?: string
          promised_window?: Json | null
          quote_claimed_at?: string | null
          quote_error?: string | null
          quote_state?: string | null
          rate_card_id: string
          rate_card_version?: number | null
          revision_of?: string | null
          salesperson_id?: string | null
          sent_at?: string | null
          sent_snapshot?: Json | null
          status?: string
          totals?: Json
          trees?: Json
          updated_at?: string
          work_items?: Json
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_via?: string | null
          backlog_weeks_at_sale?: number | null
          backlog_weeks_at_send?: number | null
          branch_key?: string | null
          completed_at?: string | null
          consultation?: Json | null
          contractor_id?: string
          created_at?: string
          created_by?: string | null
          customer?: Json
          id?: string
          jobber_client_id?: string | null
          jobber_property_id?: string | null
          jobber_quote_id?: string | null
          jobber_quote_number?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          number?: number
          payment_plan?: Json | null
          pricing_engine_version?: string
          production_engine_version?: string
          profile?: string
          promised_window?: Json | null
          quote_claimed_at?: string | null
          quote_error?: string | null
          quote_state?: string | null
          rate_card_id?: string
          rate_card_version?: number | null
          revision_of?: string | null
          salesperson_id?: string | null
          sent_at?: string | null
          sent_snapshot?: Json | null
          status?: string
          totals?: Json
          trees?: Json
          updated_at?: string
          work_items?: Json
        }
        Relationships: [
          {
            foreignKeyName: "production_estimates_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_estimates_rate_card_id_fkey"
            columns: ["rate_card_id"]
            isOneToOne: false
            referencedRelation: "production_rate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_estimates_revision_of_fkey"
            columns: ["revision_of"]
            isOneToOne: false
            referencedRelation: "production_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_estimates_salesperson_id_fkey"
            columns: ["salesperson_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_labor_roles: {
        Row: {
          contractor_id: string
          created_at: string
          id: string
          loaded_hourly_cost: number
          name: string
          role_key: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          loaded_hourly_cost?: number
          name: string
          role_key: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          loaded_hourly_cost?: number
          name?: string
          role_key?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      production_packets: {
        Row: {
          actuals: Json | null
          bid_request_id: string | null
          completed_at: string | null
          contractor_id: string
          created_at: string
          crew: Json
          crew_leader_id: string | null
          customer: Json
          depends_on: string[]
          est_crew_hours: number | null
          est_hours: number | null
          est_man_hours: number | null
          estimate_id: string
          estimate_number: number | null
          fulfillment: string
          id: string
          jobber_job_id: string | null
          jobber_job_number: string | null
          package_key: string
          planned_date: string | null
          promised_window: Json | null
          rate_card_version: number | null
          resources: Json
          salesperson_name: string | null
          scheduled_date: string | null
          scheduling_class: string
          scope: Json
          status: string
          tasks: Json
          title: string
          updated_at: string
        }
        Insert: {
          actuals?: Json | null
          bid_request_id?: string | null
          completed_at?: string | null
          contractor_id: string
          created_at?: string
          crew?: Json
          crew_leader_id?: string | null
          customer?: Json
          depends_on?: string[]
          est_crew_hours?: number | null
          est_hours?: number | null
          est_man_hours?: number | null
          estimate_id: string
          estimate_number?: number | null
          fulfillment?: string
          id?: string
          jobber_job_id?: string | null
          jobber_job_number?: string | null
          package_key: string
          planned_date?: string | null
          promised_window?: Json | null
          rate_card_version?: number | null
          resources?: Json
          salesperson_name?: string | null
          scheduled_date?: string | null
          scheduling_class?: string
          scope?: Json
          status?: string
          tasks?: Json
          title?: string
          updated_at?: string
        }
        Update: {
          actuals?: Json | null
          bid_request_id?: string | null
          completed_at?: string | null
          contractor_id?: string
          created_at?: string
          crew?: Json
          crew_leader_id?: string | null
          customer?: Json
          depends_on?: string[]
          est_crew_hours?: number | null
          est_hours?: number | null
          est_man_hours?: number | null
          estimate_id?: string
          estimate_number?: number | null
          fulfillment?: string
          id?: string
          jobber_job_id?: string | null
          jobber_job_number?: string | null
          package_key?: string
          planned_date?: string | null
          promised_window?: Json | null
          rate_card_version?: number | null
          resources?: Json
          salesperson_name?: string | null
          scheduled_date?: string | null
          scheduling_class?: string
          scope?: Json
          status?: string
          tasks?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_packets_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_packets_crew_leader_id_fkey"
            columns: ["crew_leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_packets_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "production_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      production_plans: {
        Row: {
          actual_cost: number | null
          actual_crew: Json | null
          actual_equipment: Json | null
          actual_hours: number | null
          adjusted_plan: Json | null
          ballpark_max: number | null
          ballpark_min: number | null
          capture_id: string
          confidence: string | null
          contractor_id: string
          created_at: string
          engine_version: string
          expected_cost: number | null
          final_price: number | null
          id: string
          inputs: Json
          original_plan: Json
          outcome: string | null
          recommended_price: number | null
          updated_at: string
        }
        Insert: {
          actual_cost?: number | null
          actual_crew?: Json | null
          actual_equipment?: Json | null
          actual_hours?: number | null
          adjusted_plan?: Json | null
          ballpark_max?: number | null
          ballpark_min?: number | null
          capture_id: string
          confidence?: string | null
          contractor_id: string
          created_at?: string
          engine_version: string
          expected_cost?: number | null
          final_price?: number | null
          id?: string
          inputs?: Json
          original_plan: Json
          outcome?: string | null
          recommended_price?: number | null
          updated_at?: string
        }
        Update: {
          actual_cost?: number | null
          actual_crew?: Json | null
          actual_equipment?: Json | null
          actual_hours?: number | null
          adjusted_plan?: Json | null
          ballpark_max?: number | null
          ballpark_min?: number | null
          capture_id?: string
          confidence?: string | null
          contractor_id?: string
          created_at?: string
          engine_version?: string
          expected_cost?: number | null
          final_price?: number | null
          id?: string
          inputs?: Json
          original_plan?: Json
          outcome?: string | null
          recommended_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_plans_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: true
            referencedRelation: "scout_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      production_pricing: {
        Row: {
          contractor_id: string
          created_at: string
          disposal_per_load: number | null
          minimum_job_charge: number | null
          target_margin: number
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          disposal_per_load?: number | null
          minimum_job_charge?: number | null
          target_margin?: number
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          disposal_per_load?: number | null
          minimum_job_charge?: number | null
          target_margin?: number
          updated_at?: string
        }
        Relationships: []
      }
      production_pricing_history: {
        Row: {
          calibration_id: string | null
          contractor_id: string
          created_at: string
          id: string
          sold_price: number
          updated_at: string
        }
        Insert: {
          calibration_id?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          sold_price: number
          updated_at?: string
        }
        Update: {
          calibration_id?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          sold_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_pricing_history_calibration_id_fkey"
            columns: ["calibration_id"]
            isOneToOne: true
            referencedRelation: "production_calibrations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_rate_cards: {
        Row: {
          based_on: string | null
          branch_key: string | null
          contractor_id: string
          created_at: string
          definition: Json
          effective_from: string | null
          id: string
          label: string
          pricing_engine_version: string | null
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          version: number | null
        }
        Insert: {
          based_on?: string | null
          branch_key?: string | null
          contractor_id: string
          created_at?: string
          definition?: Json
          effective_from?: string | null
          id?: string
          label?: string
          pricing_engine_version?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          version?: number | null
        }
        Update: {
          based_on?: string | null
          branch_key?: string | null
          contractor_id?: string
          created_at?: string
          definition?: Json
          effective_from?: string | null
          id?: string
          label?: string
          pricing_engine_version?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "production_rate_cards_based_on_fkey"
            columns: ["based_on"]
            isOneToOne: false
            referencedRelation: "production_rate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_rate_cards_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_rollout: {
        Row: {
          id: number
          jobber_extras: boolean
          live: boolean
          test_owner_ids: string[]
          updated_at: string
        }
        Insert: {
          id?: number
          jobber_extras?: boolean
          live?: boolean
          test_owner_ids?: string[]
          updated_at?: string
        }
        Update: {
          id?: number
          jobber_extras?: boolean
          live?: boolean
          test_owner_ids?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      production_settings: {
        Row: {
          active_profile: string
          basics: Json
          contractor_id: string
          cost_viewer_ids: string[]
          created_at: string
          crew_counts: Json
          isa_credentials: Json
          jobber: Json
          profile_schedule: Json
          resources: Json
          send_unit_cost: boolean
          updated_at: string
        }
        Insert: {
          active_profile?: string
          basics?: Json
          contractor_id: string
          cost_viewer_ids?: string[]
          created_at?: string
          crew_counts?: Json
          isa_credentials?: Json
          jobber?: Json
          profile_schedule?: Json
          resources?: Json
          send_unit_cost?: boolean
          updated_at?: string
        }
        Update: {
          active_profile?: string
          basics?: Json
          contractor_id?: string
          cost_viewer_ids?: string[]
          created_at?: string
          crew_counts?: Json
          isa_credentials?: Json
          jobber?: Json
          profile_schedule?: Json
          resources?: Json
          send_unit_cost?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_settings_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: string
          company_name: string | null
          company_rating_avg: number | null
          company_rating_count: number
          created_at: string
          credit_balance: number
          crew_auto_broadcast: boolean
          discount_next_lead: boolean
          dma_beta_enabled: boolean
          email: string
          first_refusal_minutes: number
          full_name: string | null
          id: string
          is_active: boolean
          is_founder: boolean
          is_sandbox: boolean
          parent_contractor_id: string | null
          phone: string | null
          return_address: Json | null
          role: string
          scout_auto_approve_reps: boolean
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_ends_at: string | null
          subscription_tier: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          account_type?: string
          company_name?: string | null
          company_rating_avg?: number | null
          company_rating_count?: number
          created_at?: string
          credit_balance?: number
          crew_auto_broadcast?: boolean
          discount_next_lead?: boolean
          dma_beta_enabled?: boolean
          email: string
          first_refusal_minutes?: number
          full_name?: string | null
          id: string
          is_active?: boolean
          is_founder?: boolean
          is_sandbox?: boolean
          parent_contractor_id?: string | null
          phone?: string | null
          return_address?: Json | null
          role?: string
          scout_auto_approve_reps?: boolean
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          company_name?: string | null
          company_rating_avg?: number | null
          company_rating_count?: number
          created_at?: string
          credit_balance?: number
          crew_auto_broadcast?: boolean
          discount_next_lead?: boolean
          dma_beta_enabled?: boolean
          email?: string
          first_refusal_minutes?: number
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_founder?: boolean
          is_sandbox?: boolean
          parent_contractor_id?: string | null
          phone?: string | null
          return_address?: Json | null
          role?: string
          scout_auto_approve_reps?: boolean
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_ends_at?: string | null
          subscription_tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pulse_access: {
        Row: {
          created_at: string
          disabled_at: string | null
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          max_items: number
          note: string | null
          owner_id: string
          plaid_env: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          max_items?: number
          note?: string | null
          owner_id: string
          plaid_env?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          max_items?: number
          note?: string | null
          owner_id?: string
          plaid_env?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_access_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_categories: {
        Row: {
          active: boolean
          created_at: string
          id: string
          key: string
          label: string
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          key: string
          label: string
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          key?: string
          label?: string
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_categories_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_events: {
        Row: {
          attempts: number
          dedupe_key: string
          error: string | null
          event_type: string | null
          external_id: string | null
          id: number
          payload: Json | null
          processed_at: string | null
          received_at: string
          source: string
        }
        Insert: {
          attempts?: number
          dedupe_key: string
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: number
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          source: string
        }
        Update: {
          attempts?: number
          dedupe_key?: string
          error?: string | null
          event_type?: string | null
          external_id?: string | null
          id?: number
          payload?: Json | null
          processed_at?: string | null
          received_at?: string
          source?: string
        }
        Relationships: []
      }
      pulse_rules: {
        Row: {
          account_row_id: string | null
          active: boolean
          category_key: string | null
          created_at: string
          created_by: string | null
          id: string
          match_kind: string
          match_value: string
          owner_id: string
          rule_type: string
          source: string
          updated_at: string
        }
        Insert: {
          account_row_id?: string | null
          active?: boolean
          category_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          match_kind: string
          match_value: string
          owner_id: string
          rule_type: string
          source: string
          updated_at?: string
        }
        Update: {
          account_row_id?: string | null
          active?: boolean
          category_key?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          match_kind?: string
          match_value?: string
          owner_id?: string
          rule_type?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_rules_account_row_id_fkey"
            columns: ["account_row_id"]
            isOneToOne: false
            referencedRelation: "plaid_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pulse_rules_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_settings: {
        Row: {
          card_payment_window_days: number
          cash_reserve: number
          classify_lock_until: string | null
          classify_requested: boolean
          created_at: string
          owner_id: string
          pay_anchor_date: string | null
          pay_frequency: string | null
          payroll_amount_override: number | null
          profit_target_monthly: number | null
          revenue_basis: string
          revenue_tax: string
          setup_completed_at: string | null
          setup_step: string | null
          timezone: string
          transfer_window_days: number
          updated_at: string
        }
        Insert: {
          card_payment_window_days?: number
          cash_reserve?: number
          classify_lock_until?: string | null
          classify_requested?: boolean
          created_at?: string
          owner_id: string
          pay_anchor_date?: string | null
          pay_frequency?: string | null
          payroll_amount_override?: number | null
          profit_target_monthly?: number | null
          revenue_basis?: string
          revenue_tax?: string
          setup_completed_at?: string | null
          setup_step?: string | null
          timezone?: string
          transfer_window_days?: number
          updated_at?: string
        }
        Update: {
          card_payment_window_days?: number
          cash_reserve?: number
          classify_lock_until?: string | null
          classify_requested?: boolean
          created_at?: string
          owner_id?: string
          pay_anchor_date?: string | null
          pay_frequency?: string | null
          payroll_amount_override?: number | null
          profit_target_monthly?: number | null
          revenue_basis?: string
          revenue_tax?: string
          setup_completed_at?: string | null
          setup_step?: string | null
          timezone?: string
          transfer_window_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pulse_settings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pulse_snapshots: {
        Row: {
          as_of_date: string | null
          computed_at: string | null
          created_at: string
          dirty: boolean
          engine_version: string | null
          inputs: Json | null
          metrics: Json | null
          owner_id: string
          sorter_version: string | null
          timezone: string | null
          updated_at: string
          warnings: Json | null
        }
        Insert: {
          as_of_date?: string | null
          computed_at?: string | null
          created_at?: string
          dirty?: boolean
          engine_version?: string | null
          inputs?: Json | null
          metrics?: Json | null
          owner_id: string
          sorter_version?: string | null
          timezone?: string | null
          updated_at?: string
          warnings?: Json | null
        }
        Update: {
          as_of_date?: string | null
          computed_at?: string | null
          created_at?: string
          dirty?: boolean
          engine_version?: string | null
          inputs?: Json | null
          metrics?: Json | null
          owner_id?: string
          sorter_version?: string | null
          timezone?: string | null
          updated_at?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "pulse_snapshots_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          admin_notes: string | null
          contractor_id: string
          created_at: string
          id: string
          lead_action: string | null
          lead_id: string
          purchase_amount: number
          purchase_id: string
          reason_code: string
          reason_notes: string | null
          refund_amount: number | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          contractor_id: string
          created_at?: string
          id?: string
          lead_action?: string | null
          lead_id: string
          purchase_amount: number
          purchase_id: string
          reason_code: string
          reason_notes?: string | null
          refund_amount?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          contractor_id?: string
          created_at?: string
          id?: string
          lead_action?: string | null
          lead_id?: string
          purchase_amount?: number
          purchase_id?: string
          reason_code?: string
          reason_notes?: string | null
          refund_amount?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_reports: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          reason: string
          reporter_user_id: string | null
          resolution: string | null
          resolved_at: string | null
          review_id: string
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          reason: string
          reporter_user_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          review_id: string
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          reason?: string
          reporter_user_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          review_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_reports_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          bid_request_id: string
          comment: string | null
          comment_hidden: boolean
          company_id: string
          created_at: string
          id: string
          responded_at: string | null
          response: string | null
          revealed_at: string
          reviewee_type: string
          reviewee_user_id: string
          reviewer_type: string
          reviewer_user_id: string
          stars: number
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          bid_request_id: string
          comment?: string | null
          comment_hidden?: boolean
          company_id: string
          created_at?: string
          id?: string
          responded_at?: string | null
          response?: string | null
          revealed_at?: string
          reviewee_type: string
          reviewee_user_id: string
          reviewer_type: string
          reviewer_user_id: string
          stars: number
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          bid_request_id?: string
          comment?: string | null
          comment_hidden?: boolean
          company_id?: string
          created_at?: string
          id?: string
          responded_at?: string | null
          response?: string | null
          revealed_at?: string
          reviewee_type?: string
          reviewee_user_id?: string
          reviewer_type?: string
          reviewer_user_id?: string
          stars?: number
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_bid_request_id_fkey"
            columns: ["bid_request_id"]
            isOneToOne: false
            referencedRelation: "bid_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_captures: {
        Row: {
          address_city: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          ai_difficulty: string | null
          ai_notes: string | null
          ai_price_max: number | null
          ai_price_min: number | null
          ai_risk: string | null
          ai_service: string | null
          approved_at: string | null
          circumference_inches: number | null
          contractor_id: string
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          diameter_inches: number | null
          final_notes: string | null
          final_price_max: number | null
          final_price_min: number | null
          final_service: string | null
          free_preview_locked: boolean
          id: string
          notes_raw: string | null
          notes_summary: string | null
          owner_id: string
          photo_path: string | null
          photo_paths: string[] | null
          price_source: string | null
          promoted_lead_id: string | null
          requested_service: string | null
          status: string
          trees: Json | null
          updated_at: string
          voice_memo_path: string | null
          wk_breakdown: Json | null
          wk_chipper: boolean | null
          wk_chipper_amount: number | null
          wk_climber_payout: number | null
          wk_climber_required: boolean | null
          wk_crane_hours: number | null
          wk_crane_required: boolean | null
          wk_extras_amount: number | null
          wk_extras_note: string | null
          wk_ground_crew: number | null
          wk_hours: number | null
          wk_loads: number | null
          wk_mini_skid: boolean | null
          wk_rigging_level: string | null
          wk_stump: boolean | null
          wk_stump_diameter_inches: number | null
          wk_total: number | null
        }
        Insert: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          ai_difficulty?: string | null
          ai_notes?: string | null
          ai_price_max?: number | null
          ai_price_min?: number | null
          ai_risk?: string | null
          ai_service?: string | null
          approved_at?: string | null
          circumference_inches?: number | null
          contractor_id: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          diameter_inches?: number | null
          final_notes?: string | null
          final_price_max?: number | null
          final_price_min?: number | null
          final_service?: string | null
          free_preview_locked?: boolean
          id?: string
          notes_raw?: string | null
          notes_summary?: string | null
          owner_id: string
          photo_path?: string | null
          photo_paths?: string[] | null
          price_source?: string | null
          promoted_lead_id?: string | null
          requested_service?: string | null
          status?: string
          trees?: Json | null
          updated_at?: string
          voice_memo_path?: string | null
          wk_breakdown?: Json | null
          wk_chipper?: boolean | null
          wk_chipper_amount?: number | null
          wk_climber_payout?: number | null
          wk_climber_required?: boolean | null
          wk_crane_hours?: number | null
          wk_crane_required?: boolean | null
          wk_extras_amount?: number | null
          wk_extras_note?: string | null
          wk_ground_crew?: number | null
          wk_hours?: number | null
          wk_loads?: number | null
          wk_mini_skid?: boolean | null
          wk_rigging_level?: string | null
          wk_stump?: boolean | null
          wk_stump_diameter_inches?: number | null
          wk_total?: number | null
        }
        Update: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          ai_difficulty?: string | null
          ai_notes?: string | null
          ai_price_max?: number | null
          ai_price_min?: number | null
          ai_risk?: string | null
          ai_service?: string | null
          approved_at?: string | null
          circumference_inches?: number | null
          contractor_id?: string
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          diameter_inches?: number | null
          final_notes?: string | null
          final_price_max?: number | null
          final_price_min?: number | null
          final_service?: string | null
          free_preview_locked?: boolean
          id?: string
          notes_raw?: string | null
          notes_summary?: string | null
          owner_id?: string
          photo_path?: string | null
          photo_paths?: string[] | null
          price_source?: string | null
          promoted_lead_id?: string | null
          requested_service?: string | null
          status?: string
          trees?: Json | null
          updated_at?: string
          voice_memo_path?: string | null
          wk_breakdown?: Json | null
          wk_chipper?: boolean | null
          wk_chipper_amount?: number | null
          wk_climber_payout?: number | null
          wk_climber_required?: boolean | null
          wk_crane_hours?: number | null
          wk_crane_required?: boolean | null
          wk_extras_amount?: number | null
          wk_extras_note?: string | null
          wk_ground_crew?: number | null
          wk_hours?: number | null
          wk_loads?: number | null
          wk_mini_skid?: boolean | null
          wk_rigging_level?: string | null
          wk_stump?: boolean | null
          wk_stump_diameter_inches?: number | null
          wk_total?: number | null
        }
        Relationships: []
      }
      scout_learning_runs: {
        Row: {
          activated_at: string | null
          active: boolean
          attempts: number
          avg_gap_pct: number | null
          block: string | null
          changes: Json
          claimed_at: string
          company_id: string
          created_at: string
          error: string | null
          finished_at: string | null
          guidance: Json | null
          id: string
          jobs: Json
          kind: string
          model: string | null
          previous_run_id: string | null
          status: string
          summary: string | null
          surface: string
          undone_at: string | null
          week_start: string | null
        }
        Insert: {
          activated_at?: string | null
          active?: boolean
          attempts?: number
          avg_gap_pct?: number | null
          block?: string | null
          changes?: Json
          claimed_at?: string
          company_id: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          guidance?: Json | null
          id?: string
          jobs?: Json
          kind: string
          model?: string | null
          previous_run_id?: string | null
          status?: string
          summary?: string | null
          surface: string
          undone_at?: string | null
          week_start?: string | null
        }
        Update: {
          activated_at?: string | null
          active?: boolean
          attempts?: number
          avg_gap_pct?: number | null
          block?: string | null
          changes?: Json
          claimed_at?: string
          company_id?: string
          created_at?: string
          error?: string | null
          finished_at?: string | null
          guidance?: Json | null
          id?: string
          jobs?: Json
          kind?: string
          model?: string | null
          previous_run_id?: string | null
          status?: string
          summary?: string | null
          surface?: string
          undone_at?: string | null
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scout_learning_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scout_learning_runs_previous_run_id_fkey"
            columns: ["previous_run_id"]
            isOneToOne: false
            referencedRelation: "scout_learning_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      scout_rate_cards: {
        Row: {
          chipper_rate: number
          chipper_rate_type: string
          climber_hourly: number
          contractor_id: string
          crane_hourly: number
          crane_mobilization_fee: number
          created_at: string
          disposal_per_load: number
          ground_crew_hourly: number
          id: string
          labor_rate: number
          markup_pct: number
          mini_skid_rate: number
          mini_skid_rate_type: string
          minimum_job_price: number
          overhead_per_job: number
          rigging_advanced_pct: number
          rigging_intermediate_pct: number
          stump_base_inches: number
          stump_base_price: number
          stump_per_inch: number
          target_profit_pct: number
          updated_at: string
        }
        Insert: {
          chipper_rate?: number
          chipper_rate_type?: string
          climber_hourly?: number
          contractor_id: string
          crane_hourly?: number
          crane_mobilization_fee?: number
          created_at?: string
          disposal_per_load?: number
          ground_crew_hourly?: number
          id?: string
          labor_rate?: number
          markup_pct?: number
          mini_skid_rate?: number
          mini_skid_rate_type?: string
          minimum_job_price?: number
          overhead_per_job?: number
          rigging_advanced_pct?: number
          rigging_intermediate_pct?: number
          stump_base_inches?: number
          stump_base_price?: number
          stump_per_inch?: number
          target_profit_pct?: number
          updated_at?: string
        }
        Update: {
          chipper_rate?: number
          chipper_rate_type?: string
          climber_hourly?: number
          contractor_id?: string
          crane_hourly?: number
          crane_mobilization_fee?: number
          created_at?: string
          disposal_per_load?: number
          ground_crew_hourly?: number
          id?: string
          labor_rate?: number
          markup_pct?: number
          mini_skid_rate?: number
          mini_skid_rate_type?: string
          minimum_job_price?: number
          overhead_per_job?: number
          rigging_advanced_pct?: number
          rigging_intermediate_pct?: number
          stump_base_inches?: number
          stump_base_price?: number
          stump_per_inch?: number
          target_profit_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_areas: {
        Row: {
          city: string
          contractor_id: string
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          region: string | null
        }
        Insert: {
          city: string
          contractor_id: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          region?: string | null
        }
        Update: {
          city?: string
          contractor_id?: string
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          region?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      signup_incidents: {
        Row: {
          account_email: string | null
          action: string
          created_at: string
          delivery_error: string | null
          fingerprint: string
          id: string
          incident_ref: string
          journey: string
          safe_summary: string
          severity: string
          sms_sent: boolean
          sms_suppressed: boolean
        }
        Insert: {
          account_email?: string | null
          action: string
          created_at?: string
          delivery_error?: string | null
          fingerprint: string
          id?: string
          incident_ref: string
          journey: string
          safe_summary: string
          severity?: string
          sms_sent?: boolean
          sms_suppressed?: boolean
        }
        Update: {
          account_email?: string | null
          action?: string
          created_at?: string
          delivery_error?: string | null
          fingerprint?: string
          id?: string
          incident_ref?: string
          journey?: string
          safe_summary?: string
          severity?: string
          sms_sent?: boolean
          sms_suppressed?: boolean
        }
        Relationships: []
      }
      signup_sandbox_sessions: {
        Row: {
          admin_user_id: string
          audience: string
          created_at: string
          id: string
          simulated_state: string
          test_data: Json
          test_email: string
          updated_at: string
        }
        Insert: {
          admin_user_id: string
          audience: string
          created_at?: string
          id?: string
          simulated_state?: string
          test_data?: Json
          test_email: string
          updated_at?: string
        }
        Update: {
          admin_user_id?: string
          audience?: string
          created_at?: string
          id?: string
          simulated_state?: string
          test_data?: Json
          test_email?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          full_name: string | null
          id: string
          invite_token: string
          parent_contractor_id: string
          phone: string | null
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invite_token?: string
          parent_contractor_id: string
          phone?: string | null
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          full_name?: string | null
          id?: string
          invite_token?: string
          parent_contractor_id?: string
          phone?: string | null
          used_at?: string | null
        }
        Relationships: []
      }
      team_member_access: {
        Row: {
          created_at: string
          email: string
          id: string
          invitation_id: string | null
          member_kind: string
          owner_id: string
          permissions: Json
          seat_type: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invitation_id?: string | null
          member_kind?: string
          owner_id: string
          permissions?: Json
          seat_type?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invitation_id?: string | null
          member_kind?: string
          owner_id?: string
          permissions?: Json
          seat_type?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_member_access_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "team_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_member_access_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_member_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_seats: {
        Row: {
          contractor_id: string
          created_at: string
          current_period_end: string | null
          id: string
          seat_quantity: number
          status: string
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          seat_quantity?: number
          status?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          current_period_end?: string | null
          id?: string
          seat_quantity?: number
          status?: string
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      leads_secure: {
        Row: {
          city: string | null
          created_at: string | null
          customer_address: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          estimated_cost_max: number | null
          estimated_cost_min: number | null
          id: string | null
          is_sample: boolean | null
          job_type: string | null
          last_purchased_at: string | null
          owner_contractor_id: string | null
          photo_url: string | null
          purchase_count: number | null
          source: string | null
          status: string | null
          urgency: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string | null
          customer_address?: never
          customer_email?: never
          customer_name?: never
          customer_phone?: never
          estimated_cost_max?: number | null
          estimated_cost_min?: number | null
          id?: string | null
          is_sample?: boolean | null
          job_type?: string | null
          last_purchased_at?: string | null
          owner_contractor_id?: string | null
          photo_url?: string | null
          purchase_count?: number | null
          source?: string | null
          status?: string | null
          urgency?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string | null
          customer_address?: never
          customer_email?: never
          customer_name?: never
          customer_phone?: never
          estimated_cost_max?: number | null
          estimated_cost_min?: number | null
          id?: string | null
          is_sample?: boolean | null
          job_type?: string | null
          last_purchased_at?: string | null
          owner_contractor_id?: string | null
          photo_url?: string | null
          purchase_count?: number | null
          source?: string | null
          status?: string | null
          urgency?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      billing_rollout_status: { Args: never; Returns: Json }
      calendar_jobs: {
        Args: never
        Returns: {
          bid_request_id: string
          city: string
          customer_address: string
          customer_name: string
          day: string
          kind: string
          title: string
          workflow_status: string
        }[]
      }
      can_purchase_lead: { Args: { p_lead_id: string }; Returns: boolean }
      claim_jobber_visit_days: { Args: { p_owner: string }; Returns: boolean }
      company_billing_claim: {
        Args: { p_owner: string; p_token: string }
        Returns: boolean
      }
      company_free_eligible: { Args: { p_owner: string }; Returns: boolean }
      company_has_permission: {
        Args: { p_owner: string; p_permission: string }
        Returns: boolean
      }
      company_past_due_grace: {
        Args: { p_interval: string; p_period_end: string }
        Returns: boolean
      }
      company_plan: { Args: { p_owner: string }; Returns: string }
      company_trial_used: { Args: { p_owner: string }; Returns: boolean }
      completed_crew_work: {
        Args: never
        Returns: {
          crew_member_id: string
        }[]
      }
      crew_scout_notes: {
        Args: never
        Returns: {
          bid_request_id: string
          difficulty: string
          notes: string
          risk: string
        }[]
      }
      free_plan_claim: {
        Args: { p_kind: string; p_owner: string; p_ref: string }
        Returns: Json
      }
      free_plan_limit: { Args: { p_kind: string }; Returns: number }
      free_plan_month: { Args: { p_at?: string }; Returns: string }
      free_plan_states: { Args: never; Returns: string[] }
      free_plan_status: { Args: never; Returns: Json }
      free_preview_unlock: { Args: never; Returns: number }
      get_metro_rank: {
        Args: { p_contractor_id: string }
        Returns: {
          rank: number
          total_contractors: number
          total_purchases: number
        }[]
      }
      get_mobile_accessible_leads: {
        Args: never
        Returns: {
          city: string
          contractor_lead_status: string
          created_at: string
          customer_address: string
          customer_name: string
          customer_phone: string
          estimate_range: string
          job_type: string
          lead_id: string
          photo_url: string
          source: string
          status: string
          unlocked_at: string
          urgency: string
        }[]
      }
      get_mobile_contractor_entitlements: {
        Args: never
        Returns: {
          account_owner_id: string
          account_status: string
          can_use_dma: boolean
          can_use_lsa: boolean
          can_use_marketing_package: boolean
          can_use_scout: boolean
          can_view_assigned_leads: boolean
          can_view_unlocked_leads: boolean
          contractor_id: string
          ios_app_store_safe_mode: boolean
          last_entitlement_sync_at: string
          mobile_access_enabled: boolean
          premium_active: boolean
          role: string
          subscription_current_period_end: string
          subscription_status: string
        }[]
      }
      get_parent_contractor_id: { Args: { p_user: string }; Returns: string }
      has_early_access: { Args: { p_lead_id: string }; Returns: boolean }
      has_product_entitlement: { Args: { p_product: string }; Returns: boolean }
      has_purchased_lead: { Args: { p_lead_id: string }; Returns: boolean }
      home_dma_counts: {
        Args: never
        Returns: {
          last_month: number
          this_month: number
          total: number
        }[]
      }
      home_scout_accuracy: {
        Args: never
        Returns: {
          avg_error: number
          jobs: number
          month: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_bid_request_owner: { Args: { p_request_id: string }; Returns: boolean }
      is_contractor_in_service_area: {
        Args: { lead_city: string }
        Returns: boolean
      }
      is_crew_recipient: { Args: { p_request_id: string }; Returns: boolean }
      is_dma_web_eligible: {
        Args: { p_contractor_id: string }
        Returns: boolean
      }
      is_job_dispatch_recipient: {
        Args: { p_dispatch_id: string }
        Returns: boolean
      }
      is_past_early_access: {
        Args: { p_lead_created_at: string }
        Returns: boolean
      }
      is_team_member_of: { Args: { p_parent: string }; Returns: boolean }
      job_closed_weekdays: {
        Args: { p_request_ids: string[] }
        Returns: {
          bid_request_id: string
          closed_weekdays: number[]
        }[]
      }
      jobber_claim_connect: {
        Args: { p_owner: string; p_return_to: string; p_state: string }
        Returns: Json
      }
      jobber_claim_payments: {
        Args: { p_owner: string; p_seconds: number }
        Returns: string
      }
      jobber_claim_refresh: {
        Args: { p_contractor: string; p_seconds: number }
        Returns: boolean
      }
      jobber_release_payments: {
        Args: { p_drop_request: boolean; p_owner: string; p_token: string }
        Returns: boolean
      }
      jobber_release_refresh: {
        Args: { p_contractor: string }
        Returns: undefined
      }
      jobber_take_payments_request: {
        Args: { p_owner: string; p_seconds: number; p_token: string }
        Returns: string
      }
      mobile_can_access_lead: {
        Args: { p_lead_id: string; p_user?: string }
        Returns: boolean
      }
      network_subs: {
        Args: { p_trade?: string }
        Returns: {
          can_chipper: boolean
          can_skid_steer: boolean
          connection_status: string
          crane_certified: boolean
          full_name: string
          home_city: string
          insured: string
          jobs_completed: number
          owns_saws: boolean
          rating_avg: number
          rating_count: number
          taking_work: boolean
          trade: string
          tree_experience_level: string
          user_id: string
          years_climbing: number
        }[]
      }
      owns_crew_member: { Args: { p_crew_member_id: string }; Returns: boolean }
      owns_crew_member_as_owner: {
        Args: { p_crew_member_id: string }
        Returns: boolean
      }
      owns_job_dispatch: { Args: { p_dispatch_id: string }; Returns: boolean }
      plaid_claim_sync: {
        Args: { p_item_row_id: string; p_seconds: number }
        Returns: boolean
      }
      plaid_commit_cursor: {
        Args: {
          p_item_row_id: string
          p_new_cursor: string
          p_old_cursor: string
        }
        Returns: boolean
      }
      plaid_release_sync: {
        Args: { p_item_row_id: string }
        Returns: undefined
      }
      plaid_reserve_slot: {
        Args: {
          p_env: string
          p_institution_id: string
          p_minutes: number
          p_owner: string
          p_team_cap: number
        }
        Returns: Json
      }
      plaid_slots_used: { Args: { p_env: string }; Returns: number }
      plaid_store_item: {
        Args: {
          p_ct: string
          p_env: string
          p_institution_id: string
          p_institution_name: string
          p_item_id: string
          p_iv: string
          p_key_version: number
          p_ledger_id: number
          p_linked_by: string
          p_owner: string
        }
        Returns: string
      }
      plaid_take_resync: { Args: { p_item_row_id: string }; Returns: boolean }
      production_can: {
        Args: { p_layer: string; p_owner: string }
        Returns: boolean
      }
      production_costs_open: {
        Args: { p_owner: string; p_write: boolean }
        Returns: boolean
      }
      production_has_key: {
        Args: { p_key: string; p_owner: string }
        Returns: boolean
      }
      production_status: { Args: never; Returns: Json }
      pulse_account_starts: { Args: { p_owner: string }; Returns: Json }
      pulse_apply_classifications: {
        Args: { p_owner: string; p_rows: Json }
        Returns: number
      }
      pulse_claim_classify: {
        Args: { p_owner: string; p_seconds: number }
        Returns: string
      }
      pulse_owner_id: { Args: never; Returns: string }
      pulse_release_classify: {
        Args: { p_drop_request: boolean; p_owner: string; p_token: string }
        Returns: boolean
      }
      pulse_revenue_basis: { Args: { p_owner: string }; Returns: string }
      pulse_seed_categories: { Args: { p_owner: string }; Returns: undefined }
      pulse_take_classify_request: {
        Args: { p_owner: string; p_seconds: number; p_token: string }
        Returns: string
      }
      pulse_window_totals: {
        Args: { p_owner: string; p_tz: string; p_windows: Json }
        Returns: Json
      }
      replace_job_jobber_days: {
        Args: { p_from: string; p_owner: string; p_rows: Json; p_to: string }
        Returns: number
      }
      scout_learning_claim: {
        Args: {
          p_company: string
          p_kind: string
          p_surface: string
          p_week: string
        }
        Returns: string
      }
      scout_learning_finish: {
        Args: {
          p_block: string
          p_fields: Json
          p_run: string
          p_status: string
        }
        Returns: boolean
      }
      scout_learning_report: { Args: never; Returns: Json }
      scout_learning_request_preview: {
        Args: { p_company: string; p_surface: string }
        Returns: string
      }
      scout_learning_surface_report: {
        Args: { p_company: string; p_surface: string }
        Returns: Json
      }
      scout_learning_undo: { Args: { p_surface: string }; Returns: Json }
      scout_price_pick: {
        Args: { p_max: number; p_min: number }
        Returns: Json
      }
      tc_alert_once: {
        Args: { p_bid_request_id: string; p_key: string }
        Returns: boolean
      }
      team_directory: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
