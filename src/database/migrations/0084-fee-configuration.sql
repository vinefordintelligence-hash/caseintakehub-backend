-- Fee Definitions
CREATE TABLE public.fee_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  purpose text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  vat_rate numeric(5, 4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fee Components
CREATE TABLE public.fee_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES public.fee_definitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL, -- 'FIXED' or 'PERCENT'
  value numeric(18, 2) NOT NULL,
  is_vatable boolean NOT NULL DEFAULT false,
  ordering int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Fee Snapshots
CREATE TABLE public.payment_operation_fee_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE REFERENCES public.payment_operations(id) ON DELETE CASCADE,
  snapshot_json jsonb NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now()
);
