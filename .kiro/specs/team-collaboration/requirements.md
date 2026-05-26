# Requirements Document

## Introduction

This document specifies the collaboration capabilities for Supermission, enabling the system to scale from single-user workflows to small team (2-5 people) and multi-team organizational use. The design preserves Supermission's local-first, git-backed, file-first philosophy while adding identity, assignment, visibility, notifications, workspace scoping, conflict detection, and optional cross-repo coordination.

The collaboration model is layered:

- **Layer 0 (Solo):** Current single-user, single-repo behavior (unchanged).
- **Layer 1 (Small Team):** Git-native collaboration within a single repo using file conventions and git as the sync mechanism.
- **Layer 2 (Organization):** Optional coordination server for cross-repo visibility, team management, and aggregated status.

## Glossary

- **Supermission_Engine**: The local work record engine that manages `.supermission/` state, lifecycle transitions, and artifact generation.
- **Collaboration_Registry**: A file at `.supermission/team.yaml` that declares team members, their roles, and notification preferences for a repository.
- **Work_Record**: A complete work unit stored under `.supermission/<work-id>/` including spec, events, tasks, and artifacts.
- **Assignment**: The binding of a Work_Record or Task to a specific team member or agent identity.
- **Identity**: A unique actor identifier combining a name and kind (human or agent), stored in the Collaboration_Registry.
- **Visibility_Scope**: The set of Work_Records and Tasks that a given Identity is permitted to view or act upon.
- **Notification_Channel**: A configured delivery mechanism (git-note, file-based inbox, webhook, or CLI poll) for status change alerts.
- **Coordination_Index**: An optional server-side read-only index that aggregates Work_Record status across multiple repositories for organizational visibility.
- **Workspace**: A logical grouping of repositories managed by a single organization, used by the Coordination_Index.
- **Team**: A named group of Identities within a Workspace that share Visibility_Scope and assignment pools.
- **Conflict_Detector**: A component that identifies concurrent mutations to the same Work_Record or overlapping file scopes across Tasks.
- **Lock_File**: A file at `.supermission/<work-id>/lock.yaml` that records which Identity holds an exclusive mutation lock on a Work_Record.
- **Inbox**: A per-identity file at `.supermission/inbox/<identity-id>.jsonl` that accumulates notification records locally.
- **Sync_Manifest**: A file at `.supermission/sync.yaml` that records the last-known git ref for each collaborator's state, enabling conflict detection on pull.

## Requirements

### Requirement 1: Team Identity Registration

**User Story:** As a team lead, I want to register team members and agents in the repository, so that work can be assigned to known identities with defined roles.

#### Acceptance Criteria

1. WHEN a user runs the team registration command with a name, kind, and role, THE Collaboration_Registry SHALL append the Identity to `.supermission/team.yaml` with a unique identifier.
2. THE Collaboration_Registry SHALL enforce that each Identity has a unique name within the repository.
3. WHEN an Identity is registered with kind "agent", THE Collaboration_Registry SHALL record the associated runner backend and profile.
4. IF a duplicate name is provided during registration, THEN THE Supermission_Engine SHALL reject the registration and return a descriptive error.
5. THE Collaboration_Registry SHALL support the following roles: owner, lead, developer, reviewer, agent, and observer.

### Requirement 2: Work Assignment

**User Story:** As a team lead, I want to assign work records and tasks to specific team members or agents, so that responsibility is clear and tracked.

#### Acceptance Criteria

1. WHEN a work record is created with an assignee, THE Supermission_Engine SHALL record the assignee Identity in `work.yaml` and emit an assignment event.
2. WHEN a task is added with an assignee, THE Supermission_Engine SHALL record the assignee Identity in the task record and emit an assignment event.
3. WHEN an assignment is changed, THE Supermission_Engine SHALL emit a reassignment event with both the previous and new assignee.
4. IF an assignee is not a registered Identity in the Collaboration_Registry, THEN THE Supermission_Engine SHALL reject the assignment and return a descriptive error.
5. WHILE a work record has status "running", THE Supermission_Engine SHALL prevent reassignment of the work record unless the current assignee or an owner explicitly releases it.

### Requirement 3: Visibility and Access Scoping

**User Story:** As an organization administrator, I want to control which team members can see and act on which work records, so that teams can work independently without interference.

#### Acceptance Criteria

1. WHERE team-scoped visibility is configured, THE Supermission_Engine SHALL filter work record listings to show only records assigned to the requesting Identity's team or explicitly shared with them.
2. THE Supermission_Engine SHALL enforce that only Identities with role "owner", "lead", or the assigned Identity can transition a work record's status.
3. WHEN an Identity with role "observer" queries work records, THE Supermission_Engine SHALL return read-only views without mutation commands.
4. WHERE no visibility configuration exists, THE Supermission_Engine SHALL default to full visibility for all registered Identities (backward-compatible solo behavior).
5. IF an Identity attempts a mutation on a work record outside their Visibility_Scope, THEN THE Supermission_Engine SHALL reject the operation and emit an access_denied supervisor signal.

### Requirement 4: Git-Native Sync for Small Teams

**User Story:** As a developer on a small team, I want collaboration state to sync through git push/pull without requiring a server, so that the team can collaborate using existing git workflows.

#### Acceptance Criteria

1. THE Supermission_Engine SHALL store all collaboration state (team registry, assignments, notifications) as files within `.supermission/` so that git push/pull propagates changes.
2. WHEN a user pulls changes that include Work_Record updates from another collaborator, THE Supermission_Engine SHALL detect and report any conflicting state transitions in the Sync_Manifest.
3. WHEN two collaborators modify the same `work.yaml` concurrently, THE Conflict_Detector SHALL identify the conflict on the next pull and emit a merge_conflict supervisor signal.
4. THE Supermission_Engine SHALL use append-only JSONL files for events, telemetry, and notifications so that concurrent appends from different collaborators merge without conflict.
5. WHEN a collaborator pushes work record changes, THE Sync_Manifest SHALL update with the collaborator's Identity and the git ref of the push.

### Requirement 5: Conflict Detection and Resolution

**User Story:** As a developer, I want the system to detect when two people are working on overlapping areas, so that merge conflicts and duplicated effort are prevented early.

#### Acceptance Criteria

1. WHEN two Tasks with overlapping file scopes are both in status "running", THE Conflict_Detector SHALL emit a scope_overlap supervisor signal with severity "warning" identifying both tasks and the overlapping paths.
2. WHEN a collaborator attempts to transition a Work_Record that has been modified by another collaborator since their last pull, THE Conflict_Detector SHALL block the transition and emit a stale_state supervisor signal.
3. THE Conflict_Detector SHALL run automatically during `supermission status` and `supermission monitor` commands to surface conflicts proactively.
4. WHEN a conflict is detected, THE Supermission_Engine SHALL include resolution guidance in the supervisor signal message specifying whether to pull, rebase, or coordinate with the other assignee.
5. IF two linear_write tasks targeting overlapping scopes are both set to "running", THEN THE Supermission_Engine SHALL block the second task and emit a linear_mutation_conflict signal.

### Requirement 6: Exclusive Work Locking

**User Story:** As a developer, I want to claim exclusive access to a work record when I'm actively mutating it, so that concurrent modifications are prevented at the file level.

#### Acceptance Criteria

1. WHEN a work record transitions to status "running", THE Supermission_Engine SHALL create a Lock_File recording the assigned Identity, timestamp, and expected duration.
2. WHILE a Lock_File exists for a work record, THE Supermission_Engine SHALL reject status transitions from any Identity other than the lock holder or an owner.
3. WHEN a work record transitions out of status "running", THE Supermission_Engine SHALL remove the Lock_File.
4. IF a Lock_File is older than the configured stale lock timeout, THEN THE Supermission_Engine SHALL emit a stale_lock supervisor signal and allow an owner to force-release the lock.
5. WHEN an Identity attempts to acquire a lock on an already-locked work record, THE Supermission_Engine SHALL reject the operation and return the current lock holder's Identity and lock acquisition time.

### Requirement 7: Notification System

**User Story:** As a team member, I want to be notified when work is assigned to me, when reviews are needed, or when conflicts arise, so that I can respond promptly.

#### Acceptance Criteria

1. WHEN a work record or task is assigned to an Identity, THE Supermission_Engine SHALL write a notification record to that Identity's Inbox.
2. WHEN a work record transitions to status "needs_review" or "needs_decision", THE Supermission_Engine SHALL notify all Identities with role "reviewer" or "lead" on the same team.
3. WHEN a supervisor signal with severity "blocking" is emitted, THE Supermission_Engine SHALL notify the assigned Identity and all Identities with role "owner" or "lead".
4. THE Supermission_Engine SHALL support a `supermission inbox` command that displays pending notifications for the current Identity, sorted by time.
5. WHERE webhook notification is configured in the Collaboration_Registry, THE Supermission_Engine SHALL POST notification payloads to the configured URL in addition to writing to the local Inbox.

### Requirement 8: Multi-Repository Workspace Coordination

**User Story:** As an engineering manager, I want to see work status across all repositories in my organization from a single view, so that I can track progress and identify blockers across teams.

#### Acceptance Criteria

1. WHERE a Coordination_Index server is configured, THE Supermission_Engine SHALL push work record status summaries to the index on each status transition.
2. THE Coordination_Index SHALL provide a read-only API that returns aggregated work status across all repositories in a Workspace, filterable by team, status, and assignee.
3. THE Coordination_Index SHALL treat `.supermission/` files as the authoritative source and rebuild its state from repository data on demand.
4. IF the Coordination_Index is unavailable, THEN THE Supermission_Engine SHALL continue operating normally using local `.supermission/` state and queue index updates for retry.
5. WHEN a new repository is added to a Workspace, THE Coordination_Index SHALL discover and index existing Work_Records from that repository's `.supermission/` directory.

### Requirement 9: Team and Workspace Configuration

**User Story:** As an organization administrator, I want to define teams, assign repositories to workspaces, and configure cross-repo policies, so that organizational structure is reflected in the collaboration system.

#### Acceptance Criteria

1. THE Supermission_Engine SHALL support a `.supermission/workspace.yaml` file that declares the workspace name, team definitions, and repository membership.
2. WHEN a workspace configuration is present, THE Supermission_Engine SHALL validate that all assignees belong to a declared team.
3. THE Supermission_Engine SHALL support team-level policy overrides in `workspace.yaml` including default runner backends, validation requirements, and approval gates.
4. WHEN a team is defined with a "lead" identity, THE Supermission_Engine SHALL route approval requests and blocking signals to that lead by default.
5. WHERE multiple teams share a repository, THE Supermission_Engine SHALL enforce that each Work_Record is owned by exactly one team and visible to other teams only through explicit sharing.

### Requirement 10: Agent-to-Human Handoff in Teams

**User Story:** As a developer, I want AI agents to hand off completed work to the appropriate human reviewer on my team, so that agent output is always validated by a responsible human.

#### Acceptance Criteria

1. WHEN an agent Identity completes a task, THE Supermission_Engine SHALL transition the work record to "needs_review" and assign the review to the team's configured reviewer or lead.
2. THE Supermission_Engine SHALL include the agent's footprint summary (files changed, tools used, validation results) in the handoff notification.
3. WHEN no reviewer is configured for the team, THE Supermission_Engine SHALL assign the review to the work record's owner.
4. IF an agent task fails validation, THEN THE Supermission_Engine SHALL notify the assigned human and include the validation failure details and the agent's debug artifact path.
5. WHILE a work record is in "needs_review" status after agent completion, THE Supermission_Engine SHALL block further agent mutations on that work record until a human approves or rejects.

### Requirement 11: Cross-Team Work Dependencies

**User Story:** As a team lead, I want to declare dependencies between work records owned by different teams, so that blocking relationships are visible and tracked across team boundaries.

#### Acceptance Criteria

1. WHEN a work record declares a dependency on another work record (including cross-repo), THE Supermission_Engine SHALL record the dependency in `work.yaml` with the target work ID and repository.
2. WHILE a dependency target has status other than "completed" or "validated", THE Supermission_Engine SHALL emit a blocked_by_dependency supervisor signal on the dependent work record.
3. WHEN a dependency target transitions to "completed", THE Supermission_Engine SHALL notify the dependent work record's assignee that the blocker is resolved.
4. THE Supermission_Engine SHALL support a `supermission deps` command that displays a dependency graph for a work record including cross-repo dependencies.
5. WHERE a Coordination_Index is configured, THE Coordination_Index SHALL track cross-repo dependencies and surface blocking chains in the aggregated view.

### Requirement 12: Collaboration Audit Trail

**User Story:** As a team lead, I want a complete audit trail of who did what and when across all collaboration actions, so that accountability is maintained and disputes can be resolved.

#### Acceptance Criteria

1. THE Supermission_Engine SHALL record the acting Identity, timestamp, and action type for every collaboration operation (assignment, lock, notification, visibility change, conflict resolution) in the work record's events.jsonl.
2. WHEN a lock is force-released by an owner, THE Supermission_Engine SHALL record the override in events.jsonl with the owner's Identity and reason.
3. THE Supermission_Engine SHALL support a `supermission audit` command that filters events by Identity, action type, and time range.
4. WHEN a visibility scope change grants or revokes access, THE Supermission_Engine SHALL emit an access_change event with the affected Identities and the actor who made the change.
5. THE Supermission_Engine SHALL preserve all collaboration events in append-only JSONL format so that the audit trail is tamper-evident through git history.

### Requirement 13: Backward Compatibility

**User Story:** As a solo developer, I want the collaboration features to be entirely optional, so that my existing single-user workflow continues to work without any configuration.

#### Acceptance Criteria

1. WHERE no `.supermission/team.yaml` exists, THE Supermission_Engine SHALL operate in solo mode with all existing commands and behaviors unchanged.
2. THE Supermission_Engine SHALL treat the absence of a Collaboration_Registry as implicit single-user mode where the current git user is the sole Identity.
3. WHEN collaboration files are present but a command is run without an explicit identity flag, THE Supermission_Engine SHALL infer the current Identity from git config `user.name` and `user.email`.
4. THE Supermission_Engine SHALL not require a Coordination_Index server for any single-repo team collaboration workflow.
5. IF a work record was created before collaboration was configured, THEN THE Supermission_Engine SHALL treat it as owned by the repository owner and accessible to all registered Identities.
