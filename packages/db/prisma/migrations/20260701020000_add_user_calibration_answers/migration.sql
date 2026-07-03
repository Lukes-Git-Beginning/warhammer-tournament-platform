-- Skill classification (N2): store the incrementally-built calibration
-- questionnaire answers per user. Additive + nullable → safe online change.
ALTER TABLE "User" ADD COLUMN "calibration_answers" JSONB;
