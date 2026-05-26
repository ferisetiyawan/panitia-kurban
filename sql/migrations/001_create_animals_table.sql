-- Migration: 001_create_animals_table
-- Feature: Animal Card + Reception management
-- Run this BEFORE deploying feat/animal-card to production
-- (Required when DB_SYNCHRONIZE=false)

CREATE TABLE IF NOT EXISTS animals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  animal_code     VARCHAR     NOT NULL UNIQUE,
  animal_type     VARCHAR     NOT NULL,
  event_id        UUID        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  pengkurban_id   VARCHAR,
  is_vendor_animal BOOLEAN    NOT NULL DEFAULT false,
  status          VARCHAR     NOT NULL DEFAULT 'PENDING',
  received_at     TIMESTAMP,
  received_by_id  VARCHAR,
  photos          TEXT,
  notes           VARCHAR,
  created_at      TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMP   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_animals_event_id    ON animals(event_id);
CREATE INDEX IF NOT EXISTS idx_animals_animal_code ON animals(animal_code);
CREATE INDEX IF NOT EXISTS idx_animals_status      ON animals(status);
