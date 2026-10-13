-- Some agents run before an incident exists (the Signal Watcher judges a sensor anomaly first).
-- Their DecisionRecords still belong in the append-only decision log, so incident_id is optional.
alter table decision_records alter column incident_id drop not null;
