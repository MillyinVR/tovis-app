-- Pro Finance mileage helper: logged business miles on a MILEAGE expense.
-- amountCents remains the (server-computed) deduction; this stores the miles for
-- the record / Schedule C. Additive, nullable — no existing data touched.
ALTER TABLE "ProfessionalExpense" ADD COLUMN     "mileageMiles" DECIMAL(9,1);
