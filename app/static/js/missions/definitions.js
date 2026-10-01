// Authored data only. The catalog module builds and validates full virtual snapshots.
export const MISSION_DEFINITIONS = [
  {
    id: "find-workspace", version: 1, title: "Find your workspace", difficulty: "Beginner",
    description: "Navigate to your projects directory and leave the terminal there.",
    learningObjectives: ["Navigate with relative or absolute paths", "Check your current directory"],
    starting: { nodes: [] },
    objectives: [{ id: "location", label: "Current directory is /home/learner/projects", type: "cwd_equals", path: "/home/learner/projects" }],
    hints: ["Use a command that changes the current directory.", "The projects directory is inside your home directory.", "Use cd with the directory name shown by ls, then check where you are with pwd."],
  },
  {
    id: "prepare-project", version: 1, title: "Prepare a project", difficulty: "Beginner",
    description: "Create a notes directory inside projects, then create an empty todo.txt file in it.",
    learningObjectives: ["Create directories", "Create an empty file"],
    starting: { nodes: [] },
    objectives: [
      { id: "notes", label: "Projects has a notes directory", type: "directory_exists", path: "/home/learner/projects/notes" },
      { id: "todo", label: "notes/todo.txt is an empty file", type: "file_content_equals", path: "/home/learner/projects/notes/todo.txt", content: "" },
    ],
    hints: ["A file needs its parent directory first.", "mkdir creates a directory; touch creates an empty file.", "Build the directory path beneath projects, then add the empty file inside it."],
  },
  {
    id: "handoff-note", version: 1, title: "Write a handoff note", difficulty: "Beginner",
    description: "Write the line 'Shift complete' into projects/handoff.txt.",
    learningObjectives: ["Write text to a virtual file", "Understand output redirection"],
    starting: { nodes: [] },
    objectives: [{ id: "handoff", label: "handoff.txt contains the handoff line", type: "file_content_equals", path: "/home/learner/projects/handoff.txt", content: "Shift complete\n" }],
    hints: ["echo prints text; a redirect can save it to a file.", "Use > to write output to a virtual path.", "Combine echo with >, and match the requested capitalization and newline."],
  },
  {
    id: "hidden-config", version: 1, title: "Set up hidden configuration", difficulty: "Intermediate",
    description: "A hidden sample exists in projects/site. Make a working .env file beside it without changing the sample.",
    learningObjectives: ["Locate hidden files", "Copy a file while preserving the source"],
    starting: { nodes: [
      { path: "/home/learner/projects/site", type: "directory" },
      { path: "/home/learner/projects/site/.env.sample", type: "file", content: "MODE=training\n" },
    ] },
    objectives: [
      { id: "config", label: "Working .env has the sample content", type: "file_content_equals", path: "/home/learner/projects/site/.env", content: "MODE=training\n" },
      { id: "sample", label: "The hidden sample remains intact", type: "file_content_equals", path: "/home/learner/projects/site/.env.sample", content: "MODE=training\n" },
    ],
    hints: ["Hidden names begin with a dot; ordinary ls omits them.", "ls -a reveals the sample; cp can preserve it while making a new file.", "The destination should be named .env beside the sample, and the original should remain."],
  },
  {
    id: "file-report", version: 1, title: "File the incoming report", difficulty: "Intermediate",
    description: "Place the incoming report under projects/reports and remove its old inbox path. Keep its contents intact.",
    learningObjectives: ["Create a destination directory", "Move a file without changing its content"],
    starting: { nodes: [
      { path: "/home/learner/inbox", type: "directory" },
      { path: "/home/learner/inbox/report.txt", type: "file", content: "Quarterly status: ready\n" },
    ] },
    objectives: [
      { id: "reports", label: "The reports directory exists", type: "directory_exists", path: "/home/learner/projects/reports" },
      { id: "report", label: "Report is at its new path with original content", type: "file_content_equals", path: "/home/learner/projects/reports/report.txt", content: "Quarterly status: ready\n" },
      { id: "old-path", label: "Old inbox report path is absent", type: "path_absent", path: "/home/learner/inbox/report.txt" },
    ],
    hints: ["Prepare the destination before moving the file.", "mkdir can create reports; mv can relocate a file.", "The source is under inbox; its destination belongs inside reports."],
  },
  {
    id: "extract-error", version: 1, title: "Extract an error report", difficulty: "Intermediate",
    description: "Read the virtual demo log and save its ERROR line into projects/error-report.txt.",
    learningObjectives: ["Search a readable log", "Redirect matching output to a file"],
    starting: { nodes: [] },
    objectives: [{ id: "error-line", label: "error-report.txt contains the ERROR line", type: "file_content_equals", path: "/home/learner/projects/error-report.txt", content: "ERROR backup failed\n" }],
    hints: ["The demo log is under /var/log; you can read it but cannot edit it.", "grep searches lines for literal text, and > saves its output.", "Match the uppercase ERROR line, then direct only that output to the report path."],
  },
  {
    id: "backup-tree", version: 1, title: "Back up a project tree", difficulty: "Intermediate",
    description: "Create a copy of the site directory at projects/site-backup. Preserve both source files and their contents.",
    learningObjectives: ["Copy a directory recursively", "Verify copied virtual files"],
    starting: { nodes: [
      { path: "/home/learner/projects/site", type: "directory" },
      { path: "/home/learner/projects/site/index.txt", type: "file", content: "Site home\n" },
      { path: "/home/learner/projects/site/config", type: "directory" },
      { path: "/home/learner/projects/site/config/app.txt", type: "file", content: "mode=training\n" },
    ] },
    objectives: [
      { id: "backup-dir", label: "Backup directory exists", type: "directory_exists", path: "/home/learner/projects/site-backup" },
      { id: "backup-index", label: "Backup index retains its content", type: "file_content_equals", path: "/home/learner/projects/site-backup/index.txt", content: "Site home\n" },
      { id: "backup-config", label: "Backup configuration retains its content", type: "file_content_equals", path: "/home/learner/projects/site-backup/config/app.txt", content: "mode=training\n" },
      { id: "source-index", label: "Original index remains", type: "file_content_equals", path: "/home/learner/projects/site/index.txt", content: "Site home\n" },
      { id: "source-config", label: "Original configuration remains", type: "file_content_equals", path: "/home/learner/projects/site/config/app.txt", content: "mode=training\n" },
    ],
    hints: ["The source is a directory with a nested config directory.", "cp needs its recursive option to copy a directory tree.", "Use recursive copying on the site directory, then verify both files in the backup."],
  },
  {
    id: "protect-note", version: 1, title: "Protect a private note", difficulty: "Intermediate",
    description: "Set projects/private.txt to virtual mode 600, keeping its original contents.",
    learningObjectives: ["Read simplified permission modes", "Change a learner-owned file's mode"],
    starting: { nodes: [{ path: "/home/learner/projects/private.txt", type: "file", content: "Training secret\n" }] },
    objectives: [
      { id: "mode", label: "Private note has mode 600", type: "mode_equals", path: "/home/learner/projects/private.txt", nodeType: "file", mode: 0o600 },
      { id: "content", label: "Private note content is intact", type: "file_content_equals", path: "/home/learner/projects/private.txt", content: "Training secret\n" },
    ],
    hints: ["In this teaching simulation, the file owner can change its three-digit mode.", "chmod takes a mode and a path.", "The target mode is 600; apply it to the learner-owned private note."],
  },
  {
    id: "incident-tidy", version: 1, title: "Tidy an incident workspace", difficulty: "Advanced",
    description: "Archive the incident report under projects/archive, keep the original report, and remove the obsolete scratch directory.",
    learningObjectives: ["Copy a file into an archive", "Remove a directory tree", "Preserve the source"],
    starting: { nodes: [
      { path: "/home/learner/projects/incident.txt", type: "file", content: "Incident 42: resolved\n" },
      { path: "/home/learner/projects/scratch", type: "directory" },
      { path: "/home/learner/projects/scratch/draft.txt", type: "file", content: "obsolete\n" },
    ] },
    objectives: [
      { id: "archive", label: "Archive directory exists", type: "directory_exists", path: "/home/learner/projects/archive" },
      { id: "copy", label: "Archived report has original content", type: "file_content_equals", path: "/home/learner/projects/archive/incident.txt", content: "Incident 42: resolved\n" },
      { id: "source", label: "Original report remains intact", type: "file_content_equals", path: "/home/learner/projects/incident.txt", content: "Incident 42: resolved\n" },
      { id: "scratch", label: "Scratch directory is gone", type: "path_absent", path: "/home/learner/projects/scratch" },
    ],
    hints: ["Make an archive destination before copying the report.", "cp keeps the original; rm -r removes a virtual directory tree.", "Archive the report without moving it, then remove scratch recursively."],
  },
];
