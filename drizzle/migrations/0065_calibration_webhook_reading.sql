-- Calibration photos are also read by the same Scout webhook (n8n) that prices live Scout jobs.
-- The webhook's trunk/height reading is kept apart from the in-app reader and locked once it arrives.
ALTER TABLE public.production_calibrations
  ADD COLUMN IF NOT EXISTS webhook_reading jsonb,
  ADD COLUMN IF NOT EXISTS webhook_requested_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_calibration_prediction() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.ai_characteristics IS NOT NULL THEN NEW.ai_characteristics := OLD.ai_characteristics; NEW.ai_model := OLD.ai_model; END IF;
  IF OLD.webhook_reading IS NOT NULL THEN NEW.webhook_reading := OLD.webhook_reading; END IF;
  IF OLD.predicted_plan IS NOT NULL THEN
    NEW.predicted_plan := OLD.predicted_plan;
    NEW.confirmed_characteristics := OLD.confirmed_characteristics;
    NEW.inputs := OLD.inputs;
    NEW.engine_version := OLD.engine_version;
    NEW.predicted_at := OLD.predicted_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;