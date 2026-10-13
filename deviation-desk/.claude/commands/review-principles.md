---
description: Check the current diff against the non-negotiable principles
---
Review the current uncommitted changes against CLAUDE.md §2 (non-negotiable principles) and §15
(coding conventions). For each principle, say "OK" or describe the specific violation with file
and line. Pay special attention to: actions without approval records, missing worldId filters,
model-chosen world ids, hardcoded model ids, Math.random() in src/sim, and untrusted text reaching
prompts without <untrusted_data> wrapping.
