# Memory Index

Load this file at the start of every run. It is the index for persistent notes and should reference every file in `./.notes/`.

| File path | Relevance | When to load |
| --- | --- | --- |
| `./.notes/MEMORY.md` | Index of the memory system. | At the start of every run. |
| `./.notes/TIMELINE.md` | Timestamped record of notable work sessions and decisions. | When reconstructing recent work sequence or preparing release notes. |
| `./.notes/GOTCHAS.md` | Project-specific pitfalls and setup notes for future work. | Before changing dependencies, tests, recording/export code, storage behavior, or service worker behavior. |
| `./.notes/RESEARCH.md` | Summaries of external documentation checked during implementation. | Before changing browser media playback, native sharing, or related permission-sensitive flows. |
