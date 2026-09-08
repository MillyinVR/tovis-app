ALTER TABLE public."ConsultChartReview" DROP CONSTRAINT "ConsultChartReview_decision_check";
ALTER TABLE public."ConsultChartReview" ADD CONSTRAINT "ConsultChartReview_decision_check" CHECK (decision IN ('CONFIRMED', 'CHANGED', 'BOX_DYE_ONLY', 'SINGLE_FACT'));
