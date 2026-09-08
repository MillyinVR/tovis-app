ALTER TYPE public."NotificationEventKey" ADD VALUE 'LOOK_BRIEF_REVIEW';
ALTER TABLE public."ConsultLookBriefVersion" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consult_look_brief_actor_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE client_user_id text; professional_user_id text;
BEGIN
  SELECT client."userId", professional."userId" INTO client_user_id, professional_user_id
    FROM public."ConsultSession" session
    JOIN public."ClientProfile" client ON client.id = session."clientId"
    JOIN public."ProfessionalProfile" professional ON professional.id = session."professionalId"
    WHERE session.id = NEW."consultSessionId";
  IF (NEW."createdByActorType" = 'CLIENT' AND NEW."createdByActorId" IS DISTINCT FROM client_user_id)
    OR (NEW."createdByActorType" = 'PROFESSIONAL' AND NEW."createdByActorId" IS DISTINCT FROM professional_user_id)
    OR (NEW."createdByActorType" = 'SYSTEM' AND NEW."createdByActorId" IS NOT NULL) THEN
    RAISE EXCEPTION 'look brief actor must own the consult' USING ERRCODE = '23514';
  END IF;
  IF NEW."sourceAnalysisRevisionId" IS DISTINCT FROM (SELECT id FROM public."ConsultRevision"
    WHERE "consultSessionId" = NEW."consultSessionId" AND kind = 'ANALYSIS' ORDER BY revision DESC LIMIT 1) THEN
    RAISE EXCEPTION 'a new look version must use the current analysis' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConsultLookBriefVersion_actor_guard" BEFORE INSERT ON public."ConsultLookBriefVersion"
  FOR EACH ROW EXECUTE FUNCTION public.consult_look_brief_actor_guard();
