DROP FUNCTION IF EXISTS public.claim_approved_admin();

CREATE POLICY "Approved emails claim own admin role"
ON public.user_roles FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND role = 'admin'::public.app_role
  AND lower(coalesce(auth.jwt() ->> 'email', '')) IN (
    'simbinikhalaza@gmail.com',
    'altairwebs24@gmail.com'
  )
);