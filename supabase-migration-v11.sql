-- Preserve a reasoned, immutable history whenever an editable project date changes.
CREATE TABLE IF NOT EXISTS public.date_change_history (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_name       text NOT NULL,
  field_name      text NOT NULL,
  changed_from    text,
  changed_to      text NOT NULL,
  reason          text NOT NULL,
  changed_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  changed_by_name text,
  changed_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS date_change_history_site_idx
  ON public.date_change_history(site_name, field_name, changed_at);

ALTER TABLE public.date_change_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read date change history" ON public.date_change_history;
CREATE POLICY "Authenticated users can read date change history"
  ON public.date_change_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert date change history" ON public.date_change_history;
CREATE POLICY "Authenticated users can insert date change history"
  ON public.date_change_history FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = changed_by);
