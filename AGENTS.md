# Codex Cloud Instructions

This repository is intended to run in Codex Cloud.

## Project

- Node.js project for DingTalk task tracking, reminders, and summary reports.
- Default cloud setup command: `npm ci`
- Default verification command: `npm test`

## Working Rules

- Read `README.md` and `CLAUDE.md` before making product or workflow changes.
- Keep changes scoped and reuse existing scripts/modules before adding new ones.
- Do not assume access to the user's Mac desktop files, Chrome login state, local Excel files, or local `.env`.
- Do not commit real credentials. Use `.env.example` only for variable names and placeholders.
- For code changes, run `npm test` when possible and report the exact result.
- For DingTalk/API work, preserve environment-variable based configuration and avoid hardcoded tokens.

## User Context

- New formal materials should use the company name `今夕汽车`.
- The user prefers practical, directly usable outputs and clear verification notes.
