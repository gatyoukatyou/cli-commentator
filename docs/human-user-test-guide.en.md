<a href="human-user-test-guide.ja.md"><kbd>日本語</kbd></a>
<a href="human-user-test-guide.en.md"><kbd>English</kbd></a>

# HUMAN User Testing Guide

This document is both a user guide and a test checklist for evaluating CLI Commentator through real HUMAN use. It covers setup clarity, interaction quality, terminal rendering, narration, speech, and confidence during operation.

## Highest-priority policy

- This test does not make a publication decision.
- Passing every checklist item never means the build should be published automatically.
- The app remains unpublished until the HUMAN has used it in realistic work and is personally satisfied with the experience.
- Confusion, anxiety, fatigue, visual discomfort, or friction are valid improvement findings even when the software is technically working.
- When something feels wrong, record it, fix it, and retest the affected experience. There is no fixed deadline or maximum number of cycles.
- Tag creation, Release publication, distribution, and updater availability are outside this guide. They always require a separate HUMAN decision.

The first target for this process is the **v0.2.2 unsigned candidate**, which includes managed PTY size synchronization. v0.2.1 remains No-Go for publication because its Managed Terminal rendering failed the device test.

## 1. What this test evaluates

This is not an automated test. It evaluates whether a HUMAN can:

1. Understand where to start without prior explanation
2. Launch Claude Code and work safely in a normal session
3. Read text, box-drawing characters, cursors, and scrollback naturally
4. Resize the window without corrupting the terminal display
5. Benefit from narration and explanations without distraction
6. Listen to speech without excessive interruption or fatigue
7. Recover from errors or disconnection without specialist knowledge
8. Work for at least 15–30 minutes without noticeable lag or frustration
9. Read approval prompts and important output with enough confidence to avoid mistakes

## 2. Roles

### HUMAN

- Operates the app in realistic work
- Records good points, bad points, confusion, and subjective discomfort
- Repeats tests after fixes
- Makes any publication decision separately from this test

### Codex / AI agent

- Helps prepare, install, and restore test builds
- Organizes version, commit, logs, and screenshots
- Converts findings into Issues, Todoist records, fixes, and pull requests
- Does not publish, distribute, or merge without HUMAN authorization

## 3. Preparation

### 3.1 Record the environment

```md
- Test date and time:
- Tester:
- App version:
- Commit:
- Artifact or build source:
- Mac: Apple Silicon / Intel
- macOS version:
- Claude Code version:
- Main working folder:
- Display size / external display:
- TTS: On / Off
```

The `Desktop Server` panel shows `Version` and `Platform`. Use `Copy Version/Platform` or `Copy Debug bundle` when reporting a problem.

### 3.2 Safety check

- [ ] Save or finish any active Claude Code, Codex, or CLI work
- [ ] Record the version of the currently installed `CLI Commentator.app`
- [ ] Confirm that the previous app can be restored or downloaded again
- [ ] Confirm that the test build came from this repository's internal artifact flow
- [ ] Never approve a real data-changing action without reading it completely
- [ ] If rendering breaks, stop using Managed Terminal for approvals or long input

## 4. Installing a v0.2.2 unsigned candidate

When Codex handles installation, the HUMAN only needs to confirm:

1. The test version and commit are stated clearly
2. The current official app has been moved to a recoverable backup location
3. After testing, the HUMAN can choose to restore the official app or keep testing the candidate

For manual `.dmg` installation:

1. Choose the artifact that matches the Mac:
   - Apple Silicon: `aarch64`
   - Intel: `x64`
2. Open the `.dmg`
3. Drag `CLI Commentator.app` into `Applications`
4. Launch it from Finder's `Applications` folder

If macOS blocks the unsigned app:

1. Right-click `CLI Commentator.app` in Finder
2. Choose `Open`
3. Review the warning and choose `Open`
4. If it remains blocked, open `System Settings` → `Privacy & Security` and choose `Open Anyway` for CLI Commentator

If macOS says the app is damaged, do not use bypass instructions from an unrelated website. Contact Codex. Quarantine removal is a last resort and is only acceptable after confirming that the artifact came from this repository.

## 5. Initial setup and normal operation

### 5.1 Desktop Server

Check the `Desktop Server` panel:

- `STATE`: running
- `HEALTH`: OK
- `Version`: the test version
- `Platform`: matches the Mac

If stopped, click `Start` and wait for `HEALTH: OK` and the connected indicator. `Stop` may terminate the active CLI session, so save work before using it.

### 5.2 Launching a CLI

In `Start commentary`:

1. Choose `Claude Code (recommended)`, `Codex`, `bash`, or `Custom`
2. Enter the absolute path of the project in `Working folder`
3. Click the launch button

Use `Claude Code (recommended)` for the main HUMAN test. Leave advanced command and argument settings unchanged unless testing Custom mode.

### 5.3 Managed Terminal

- Click the terminal area to type directly
- `Ctrl+C` interrupts the running operation
- `Clear` clears the display but does not stop the process
- The active session name appears above the terminal

### 5.4 Narration and explanation

- Style: Standard / Kansai / Zundamon-style text
- Display: Narration + explanation / Narration only / Explanation only
- Ruleset: shows whether Claude Code, Codex, or generic detection is active

Start with Standard and Narration + explanation for comparison, then try personal preferences.

### 5.5 Text-to-speech (TTS)

1. Enable `Text-to-speech (TTS)`
2. Open `Settings`
3. Choose a preset, voice, rate, pitch, and volume
4. Use `Test speech`

Enabling raw-detail speech increases the amount spoken. Start with it disabled. `Export evaluation log as JSON` can capture speech behavior.

### 5.6 Skin

Switch between `Standard` and `CLI`. Compare readability, navigation, information density, and fatigue—not only visual preference.

### 5.7 Profiles (optional)

Save repeated configurations with `+ New`:

- Name
- Input mode: PTY command launch / File log monitoring
- Command, arguments, and working directory
- Style and ruleset
- Narration and explanation LLM providers

API keys belong in environment variables, not in the profile UI. Profiles are optional for the first test.

## 6. Test result vocabulary

The full guide does not need to be completed in one session.

- `OK`: no problem was noticed in this session
- `Concern`: work can continue, but improvement is wanted
- `Fail`: risk of mistake, blocked work, or strong discomfort
- `Not run`: not checked in this session

`OK` never means permission to publish.

## 7. Required user tests

### UT-01 Startup and connection

1. Launch the app
2. Inspect Desktop Server and the connection indicator
3. Click `Start` if needed

- [ ] The app becomes usable in roughly 30 seconds or less
- [ ] Running, Health OK, and connected states do not contradict each other
- [ ] A first-time user can identify the next action
- [ ] Error guidance is understandable without specialist knowledge

### UT-02 Launch Claude Code

1. Choose Claude Code
2. Select a safe test repository as the working folder
3. Launch Claude Code

- [ ] Claude Code starts in the specified folder
- [ ] The input line and cursor are visible
- [ ] Text, logo, and box-drawing characters do not overlap
- [ ] It is clear when startup is complete and input is available

### UT-03 Long input and wrapping

Suggested prompt:

```text
This is a display test. Do not modify files or use tools. Write five long bullet points, with each point long enough to wrap across two or three terminal lines.
```

- [ ] Input is not dropped or reduced to the last character
- [ ] Long output wraps naturally at the terminal width
- [ ] Cursor and input positions match
- [ ] Old characters or borders do not remain on new lines
- [ ] Output does not cause excessive flicker

### UT-04 Window resizing

With long Claude Code output visible:

1. Narrow the window
2. Widen it
3. Enter full screen
4. Return to windowed mode
5. Move between displays if available

- [ ] Existing lines redraw for the new width
- [ ] Borders, cursor, and input line remain aligned
- [ ] There is no overlap, residue, or missing text
- [ ] Input and scrolling continue to work

Any corrupted rendering is a `Fail`. Stop using Managed Terminal for approvals or long input and save a screenshot and `Copy Debug bundle` output.

### UT-05 Scroll, clear, and interrupt

1. Produce several screens of output
2. Scroll up and down
3. Return to the bottom
4. Use `Ctrl+C` during a safe long response
5. Use `Clear`

- [ ] It is easy to return to the desired location
- [ ] New output does not cause unreasonable jumps
- [ ] Ctrl+C interrupts and leaves an understandable state
- [ ] Input still works after Clear
- [ ] The difference between Clear and Stop is understandable

### UT-06 Stop, Start, and reconnect

Use a disposable test session:

1. Click `Stop`
2. Observe the disconnected state
3. Click `Start`
4. Launch Claude Code or bash again
5. Resize the window again

- [ ] State labels match stopping, starting, and connection behavior
- [ ] Terminal dimensions are correct after reconnect
- [ ] Old session text does not contaminate the new terminal
- [ ] The UI explains the next action

### UT-07 PTY size diagnostic

This is required if display corruption returns.

1. Launch `bash`
2. Run `stty size`
3. Record the displayed `rows columns`
4. Resize the window substantially
5. Run `stty size` again

- [ ] The numbers change after resizing
- [ ] Widening the window normally increases the column count
- [ ] If the numbers do not change, capture a screenshot

### UT-08 Approval safety

Observe a naturally occurring approval prompt. Do not create a dangerous action solely for testing.

- [ ] The complete command or operation can be read
- [ ] Options, cursor, and current selection are clear
- [ ] Wrapping does not hide critical information
- [ ] Reject or cancel is available when uncertain
- [ ] The rendering does not create a fear of accidental approval

Any material readability concern is a `Fail`.

## 8. Experience tests

### UT-09 Narration and explanation

- [ ] Narration roughly matches actual progress
- [ ] Repetition is not excessive
- [ ] Raw output and explanation are distinguishable
- [ ] Important errors or approval requests are difficult to miss
- [ ] The amount of explanation does not obstruct work

### UT-10 Speech

- [ ] Test speech is audible
- [ ] Normal progress is not spoken too often
- [ ] Urgent speech is not buried
- [ ] Speech does not overlap or continue reading stale content
- [ ] Rate, pitch, and volume can be made comfortable
- [ ] Ten minutes of listening does not cause fatigue

### UT-11 Skin and readability

Use Standard and CLI for about five minutes each.

- [ ] Primary controls are easy to find
- [ ] Text size, contrast, and spacing are readable
- [ ] Terminal and narration areas are easy to distinguish
- [ ] The design does not cause eye strain
- [ ] Differences in work efficiency can be explained

### UT-12 Profiles

If profiles are relevant:

1. Create a test profile
2. Launch a session with it
3. Edit it
4. Delete only the disposable test profile

- [ ] Input modes and required fields are understandable
- [ ] Saved settings launch the intended CLI
- [ ] Edits take effect
- [ ] It is difficult to delete the wrong profile by mistake

### UT-13 Error recovery

When a real error occurs:

- [ ] A likely cause is shown
- [ ] The first recovery action is clear
- [ ] Checks and commands can be copied
- [ ] `Copy Debug bundle` gathers the needed context
- [ ] Normal work can resume after recovery

### UT-14 Sustained use

Perform a real small task for at least 15–30 minutes.

- [ ] Input latency is not distracting
- [ ] Scrolling and redraw do not degrade
- [ ] Narration and speech do not cause fatigue
- [ ] The app materially helps the work
- [ ] There is no strong reason to return to a normal terminal
- [ ] Behavior remains predictable after restart

## 9. End-of-session questions

1. What was the best part today?
2. Where did you first become confused?
3. Which action felt least safe?
4. What felt slow, noisy, or difficult to read?
5. What was better than a normal terminal?
6. When did you want to return to a normal terminal?
7. Would you use this build again tomorrow, and why?
8. If one thing could be fixed next, what should it be?

```md
- Ease of starting: 1 2 3 4 5
- Natural input: 1 2 3 4 5
- Rendering confidence: 1 2 3 4 5
- Narration usefulness: 1 2 3 4 5
- Speech comfort: 1 2 3 4 5 / Not used
- Sustained-use comfort: 1 2 3 4 5
- Desire to use again: 1 2 3 4 5
```

`1` is very poor, `3` is usable but needs improvement, and `5` is excellent. Always add at least one sentence explaining the score.

## 10. Finding template

```md
## Finding / Defect

- Title:
- Result: Concern / Fail
- Date and time:
- App version and commit:
- macOS and Mac:
- Active CLI: Claude Code / Codex / bash / Custom
- Working folder:
- Skin, display mode, and TTS settings:

### What I was trying to do

### Expected behavior

### Actual behavior

### Reproduction steps
1.
2.
3.

### Frequency
- Every time / Sometimes / Once

### HUMAN explanation
- Practical impact:
- Risk of a mistake:
- Can work continue?
- What felt unpleasant or confusing?

### Evidence
- Screenshot or video:
- Copy Debug bundle:
- Logs path:
```

Remove credentials, personal data, and private repository content before sharing screenshots or logs.

## 11. Fix and retest loop

1. Record each `Fail` and important `Concern` in Issue/Todoist
2. Explain the practical impact and desired improvement in plain language
3. Implement a fix and pass automated tests
4. Produce a new unsigned candidate
5. Retest the failing scenario
6. Retest related basics and another 15–30 minute real session

Stop testing a build when there is corrupted rendering, risk of accidental approval, dropped input, a crash, or risk of data loss.

## 12. Session record template

```md
# CLI Commentator HUMAN User Test: YYYY-MM-DD

## Test build
- Version:
- Commit:
- Environment:
- Tester:
- Duration:

## Results
- UT-01 Startup and connection:
- UT-02 Launch Claude Code:
- UT-03 Long input and wrapping:
- UT-04 Window resizing:
- UT-05 Scroll, clear, and interrupt:
- UT-06 Stop, Start, and reconnect:
- UT-07 PTY size diagnostic:
- UT-08 Approval safety:
- UT-09 Narration and explanation:
- UT-10 Speech:
- UT-11 Skin and readability:
- UT-12 Profiles:
- UT-13 Error recovery:
- UT-14 Sustained use:

## Good points

## Concerns

## Failed items

## Next improvement

## Items to retest

## Current conclusion
- Continue testing / Waiting for fixes / No problem in this test scope

Note: "No problem in this test scope" is not permission to publish.
```

## 13. v0.2.2 on-device smoke Go/No-Go criteria

`Go` in this section means that the v0.2.2 on-device smoke test passed. It is not permission to publish, distribute, or create a Release.

Run one 30-minute normal work session in the desktop app launched from Finder. The result is `Go` only when every criterion below is satisfied.

1. Zero rendering-corruption incidents
2. Speech does not consist only of canned phrases three or more times in a row
3. The input position and text being typed in Managed Terminal remain readable at all times
4. Zero missed action-required alerts and no more than one false action-required alert
5. No more than ten minutes from launching the app to starting commentary while following the guide

If any criterion is not satisfied, the result is `No-Go`. **Create Issues only for the criteria that were not satisfied, and send all other findings to the v0.2.3 backlog.**

## 14. Separation from publication

The only completion states in this guide are `Continue testing`, `Waiting for fixes`, and `No problem in this test scope`. There is no `Publication Go` result.

`Go` in the previous section means only that the v0.2.2 on-device smoke test passed; it does not mean Publication Go.

Only after repeated realistic use and explicit HUMAN satisfaction may a separate publication-decision process begin. Until then, keep the build as a Draft Release or internal artifact.
