# Requirements Document

## Introduction

This document specifies the project management capabilities for Supermission, enabling it to serve as a standalone project management tool for AI-assisted software delivery while also integrating with external tools (Linear, Jira, GitHub Issues, etc.) and supporting import/export of project data.

The design follows Supermission's local-first philosophy: project state lives in `.supermission/` files, external tools are optional sync targets, and the system works fully offline.

## Glossary

- **Project**: A named collection of work records organized by milestones, priorities, and labels. Stored in `.supermission/project.yaml`.
- **Milestone**: A time-bounded goal containing a set of work records. Has a target date and completion criteria.
- **Priority**: An urgency level (urgent, high, medium, low, backlog) assigned to work records.
- **Label**: A free-form tag for categorizing work (bug, feature, chore, security, performance, etc.).
- **Cycle**: A time-boxed iteration (like a sprint) with a start/end date and a set of work records. Optional — teams can work without cycles.
- **Integration**: A configured connection to an external project management tool that syncs work record status bidirectionally.
- **Import**: Reading project data from an external source (CSV, JSON, Linear export, Jira export) and creating corresponding work records.
- **Export**: Writing project data to a portable format (CSV, JSON, Markdown) for use in other tools or reporting.

## Requirements

### Requirement 1: Project Configuration

**User Story:** As a team lead, I want to define a project with milestones, labels, and priorities, so that work records are organized and trackable toward goals.

#### Acceptance Criteria

1. WHEN a user runs `supermission project init`, THE system SHALL create `.supermission/project.yaml` with project name, description, and default configuration.
2. THE project configuration SHALL support milestones with id, title, description, target_date, and status (active, completed, cancelled).
3. THE project configuration SHALL support custom labels as a list of strings.
4. THE project configuration SHALL support cycles with id, title, start_date, end_date, and associated work IDs.
5. WHEN a work record is created, THE system SHALL allow optional `--milestone`, `--priority`, and `--label` flags to categorize it.

### Requirement 2: Milestone Management

**User Story:** As a team lead, I want to create and track milestones, so that I can measure progress toward delivery goals.

#### Acceptance Criteria

1. THE system SHALL support `supermission milestone add/list/update/close` commands for managing milestones.
2. WHEN a milestone is listed, THE system SHALL show the count of work records by status (draft, running, completed) and a completion percentage.
3. WHEN all work records in a milestone reach status "completed", THE system SHALL emit a milestone_completed event.
4. THE system SHALL support `supermission milestone board` to show a milestone-focused view of work progress.
5. IF a milestone's target_date has passed and work records remain incomplete, THE system SHALL emit a milestone_overdue supervisor signal.

### Requirement 3: Priority and Label Management

**User Story:** As a developer, I want to prioritize and label work records, so that I can focus on what matters most.

#### Acceptance Criteria

1. THE system SHALL support priority levels: urgent, high, medium, low, backlog (default: medium).
2. THE system SHALL support `supermission prioritize <work-id> --priority <level>` to change priority.
3. THE system SHALL support `supermission label <work-id> --add <label>` and `--remove <label>` for tagging.
4. THE `supermission list` and `supermission board` commands SHALL support `--priority` and `--label` filters.
5. THE `supermission board` command SHALL sort work records by priority within each status column.

### Requirement 4: Cycle (Sprint) Management

**User Story:** As a team lead, I want to organize work into time-boxed cycles, so that the team has clear short-term goals.

#### Acceptance Criteria

1. THE system SHALL support `supermission cycle create --title "Week 23" --start 2026-06-02 --end 2026-06-08` for creating cycles.
2. THE system SHALL support `supermission cycle add <work-id>` to add work records to the current cycle.
3. THE system SHALL support `supermission cycle board` to show only work in the current active cycle.
4. WHEN a cycle's end_date passes, THE system SHALL emit a cycle_ended event and report completion stats.
5. WHERE no cycles are configured, THE system SHALL operate without them (cycles are optional).

### Requirement 5: Linear Integration

**User Story:** As a team using Linear, I want Supermission to sync work status with Linear issues, so that both tools stay current without manual updates.

#### Acceptance Criteria

1. THE system SHALL support `supermission integration add --provider linear --api-key <key> --team <team-id>` to configure Linear sync.
2. WHEN a work record transitions status, THE system SHALL update the corresponding Linear issue status via API.
3. WHEN a Linear issue is assigned or status-changed externally, THE system SHALL detect the change on next sync and update the local work record.
4. THE system SHALL support `supermission sync` to trigger a manual bidirectional sync.
5. THE system SHALL map Supermission statuses to Linear statuses: draft→Backlog, planned→Todo, approved→Todo, running→In Progress, needs_review→In Review, validated→Done, completed→Done, failed→Cancelled.

### Requirement 6: GitHub Issues Integration

**User Story:** As a team using GitHub Issues, I want Supermission to link work records to issues, so that progress is visible in both places.

#### Acceptance Criteria

1. THE system SHALL support `supermission integration add --provider github --repo <owner/repo>` to configure GitHub sync.
2. WHEN a work record is created with `--github-issue <number>`, THE system SHALL link it to the GitHub issue and post a comment with the work record ID.
3. WHEN a work record completes, THE system SHALL close the linked GitHub issue with a summary comment.
4. THE system SHALL support `supermission import github --repo <owner/repo> --label <label>` to import open issues as work records.
5. THE integration SHALL store credentials in `.supermission/integrations.yaml` with redacted display in CLI output.

### Requirement 7: Jira Integration

**User Story:** As a team using Jira, I want Supermission to sync with Jira issues, so that enterprise teams can adopt Supermission without abandoning existing workflows.

#### Acceptance Criteria

1. THE system SHALL support `supermission integration add --provider jira --url <instance-url> --project <key>` to configure Jira sync.
2. WHEN a work record transitions status, THE system SHALL update the corresponding Jira issue via REST API.
3. THE system SHALL map Supermission statuses to Jira transitions based on a configurable mapping in integrations.yaml.
4. THE system SHALL support `supermission import jira --project <key> --status "To Do"` to import Jira issues as work records.
5. IF the Jira API is unreachable, THE system SHALL queue updates locally and retry on next sync.

### Requirement 8: Import from External Sources

**User Story:** As a team migrating to Supermission, I want to import existing project data from CSV, JSON, or tool exports, so that I don't start from scratch.

#### Acceptance Criteria

1. THE system SHALL support `supermission import csv <file>` with column mapping for goal, acceptance, priority, milestone, labels, and assignee.
2. THE system SHALL support `supermission import json <file>` expecting an array of objects with work record fields.
3. THE system SHALL support `supermission import linear --team <team-id>` to bulk-import issues from Linear.
4. WHEN importing, THE system SHALL create work records in "draft" status and report the count of imported items.
5. THE system SHALL support `--dry-run` flag on all import commands to preview what would be created without writing.

### Requirement 9: Export to External Formats

**User Story:** As a team lead, I want to export project data to CSV, JSON, or Markdown, so that I can share progress reports or migrate to other tools.

#### Acceptance Criteria

1. THE system SHALL support `supermission export csv` to write all work records as a CSV file with columns: id, goal, status, priority, milestone, assignee, labels, created_at, updated_at.
2. THE system SHALL support `supermission export json` to write all work records as a JSON array.
3. THE system SHALL support `supermission export markdown` to generate a Markdown progress report grouped by milestone and status.
4. ALL export commands SHALL support `--milestone`, `--status`, `--priority`, and `--assignee` filters.
5. THE system SHALL support `supermission export linear` to push work records as new Linear issues (one-way export).

### Requirement 10: Project Dashboard Data

**User Story:** As a team lead, I want project-level metrics and views, so that I can track overall progress and identify bottlenecks.

#### Acceptance Criteria

1. THE system SHALL support `supermission project status` showing: total works, by-status counts, by-priority counts, active milestone progress, and overdue items.
2. THE system SHALL support `supermission project velocity` showing: works completed per cycle/week, average time from draft to completed, and agent vs human completion ratio.
3. THE `supermission board` command SHALL support `--group-by milestone` and `--group-by priority` views.
4. THE web dashboard (`supermission serve`) SHALL display project metrics, milestone progress bars, and priority distribution.
5. THE system SHALL emit project-level telemetry (works created/completed per day) in `.supermission/project-telemetry.jsonl`.

### Requirement 11: Backward Compatibility

**User Story:** As an existing user, I want project management features to be optional, so that my current workflow continues unchanged.

#### Acceptance Criteria

1. WHERE no `.supermission/project.yaml` exists, ALL existing commands SHALL work identically to current behavior.
2. THE priority field SHALL default to "medium" when not specified.
3. THE milestone and label fields SHALL be empty/unset when not specified.
4. ALL new project management commands SHALL fail gracefully with "run `supermission project init` first" when no project is configured.
5. THE integration configuration SHALL be entirely optional — no external tool connection is required for any local workflow.
