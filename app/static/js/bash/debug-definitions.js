// Authored data only. Completion is evaluated from resulting virtual state.
export const DEBUG_DEFINITIONS = Object.freeze([
  {
    id: "quote-assignment", version: 1, title: "Keep the greeting together", difficulty: "Beginner",
    description: "Fix the script so greeting.txt contains Hello World on one line.",
    learningObjectives: ["Quote an assignment value containing spaces."],
    brokenScript: 'message=Hello World\necho "$message" > greeting.txt',
    starting: { nodes: [] },
    objectives: [{ id: "greeting", label: "greeting.txt contains Hello World", type: "file_content_equals",
      path: "/home/learner/greeting.txt", content: "Hello World\n" }],
    hints: [
      "The issue occurs before echo runs. Check how the variable receives its value.",
      "An assignment with a space becomes more than one word unless the value is quoted.",
      "Keep message= on the left and quote the two-word value on the right.",
    ],
  },
  {
    id: "close-file-loop", version: 1, title: "Finish the backup loop", difficulty: "Beginner",
    description: "Fix the script so both incoming text files are copied into backup.",
    learningObjectives: ["Close a for block and use a virtual file glob."],
    brokenScript: 'mkdir backup\nfor file in *.txt; do\n cp "$file" "backup/$file"',
    starting: { nodes: [
      { path: "/home/learner/one.txt", type: "file", content: "one\n" },
      { path: "/home/learner/two.txt", type: "file", content: "two\n" },
    ] },
    objectives: [
      { id: "one", label: "one.txt is backed up", type: "file_content_equals", path: "/home/learner/backup/one.txt", content: "one\n" },
      { id: "two", label: "two.txt is backed up", type: "file_content_equals", path: "/home/learner/backup/two.txt", content: "two\n" },
    ],
    hints: [
      "The parser reaches the end while still inside a control block.",
      "The for header starts a block that needs a matching closing keyword.",
      "Check the final line: a for block closes with done.",
    ],
  },
  {
    id: "directory-test", version: 1, title: "Check the right path type", difficulty: "Intermediate",
    description: "Fix the condition so check.txt says ready when projects is a directory.",
    learningObjectives: ["Choose the correct virtual file test."],
    brokenScript: 'if [ -f projects ]; then\n echo ready > check.txt\nelse\n echo missing > check.txt\nfi',
    starting: { nodes: [] },
    objectives: [{ id: "result", label: "check.txt contains ready", type: "file_content_equals",
      path: "/home/learner/check.txt", content: "ready\n" }],
    hints: [
      "The script runs, but its condition selects the wrong branch.",
      "Look at the type of projects in the virtual filesystem.",
      "The test currently asks whether projects is a file. Use the directory test.",
    ],
  },
]);
