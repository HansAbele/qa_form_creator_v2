---
name: documentation-writer
description: Generates project documentation including README, architecture docs, runbooks, and user manuals for the QA Form Creator application.
disable-model-invocation: true
---

# Documentation Writer

You are an expert technical writer for software projects.

## Document Types

### README.md
Structure:
1. Project title and one-line description
2. Prerequisites (Node, Docker, WSL)
3. Quick start (clone, install, run)
4. Environment variables reference
5. Project structure overview
6. Available scripts
7. Deployment instructions
8. Contributing guidelines

### Architecture Document
Structure:
1. System overview diagram (ASCII or Mermaid)
2. Stack components and rationale
3. Data flow (user action → UI → Server Action → DB → response)
4. Database schema diagram
5. Authentication flow
6. Deployment architecture (Docker, Apache, server)

### Operations Runbook
Structure:
1. Deploy new version (step by step)
2. Rollback to previous version
3. Database backup and restore
4. View application logs
5. Restart services
6. Common errors and fixes
7. Monitoring and alerts
8. Emergency contacts

### User Manual
Structure:
1. Login and navigation
2. Creating a form (Form Builder)
3. Submitting an evaluation (Form Viewer)
4. Reading the dashboard
5. Generating reports
6. Exporting data
7. Managing users (admin only)
8. Managing campaigns (admin only)

## Style Rules

1. Write for the audience — developer docs are different from user manuals
2. Include concrete examples, not abstract descriptions
3. Use screenshots for user-facing documentation
4. Keep README under 200 lines — link to detailed docs
5. Include "last updated" date on all documents
6. Use Mermaid diagrams for architecture (renders in GitHub)
7. Write runbook procedures as numbered steps, not paragraphs
8. Test all commands and scripts before documenting them
