# Testing on real devices

Everything so far was tested in a desktop browser and in an emulator. Nobody has recorded a meeting on a real iPhone or Android yet. This is the plan, with the problems most likely to show up.

## What was and was not checked

| Checked automatically | Not checked (needs a real device) |
|---|---|
| Every page fits a 320 px wide screen in English, Hindi and Tamil (no sideways scrolling; this found and fixed long Tamil words and long e-mail addresses running off the screen) | Recording on iPhone Safari and Android Chrome |
| Real browser recordings in **WebM/Opus, MP4/Opus and MP4/AAC (the iPhone format)** all transcribe correctly through the live server (2026-10-28, recorded with desktop Edge) | Recording while the screen locks or the app is in the background |
| Crash-safe recording, offline queue, background processing (unit tests and live tests) | Installing the app to the home screen and updating it |
| Light and dark themes look right (screenshots) | Touch comfort, keyboard covering fields, notches and home bars |

## Devices to try (at least one of each row)

| Device | Browser | Also test as installed app |
|---|---|---|
| iPhone (iOS 16.4 or newer) | Safari | Yes (Share, Add to Home Screen) |
| Android phone | Chrome | Yes (Install app) |
| Windows or Mac laptop | Chrome or Edge | Optional |
| Mac | Safari | No |
| Any | Firefox | No (live captions are not available there; everything else should work) |

## The five-minute check (each device)

1. Open **Settings, Diagnostics**. Tap **Test recording (3 seconds)**. It must say *Recording works on this device*. Then tap **Copy diagnostics** and keep the text.
2. **Record 1 minute** of normal talking in your language. Stop. Save. Wait for the notes. Check the summary and transcript make sense.
3. **Lock the phone for 20 seconds in the middle of a recording**, then unlock. Does it keep recording? (Expected to be device-dependent: see below.)
4. **Switch to another app for 20 seconds** during recording and come back.
5. **Turn on airplane mode**, record 30 seconds, save. It should say it was saved for later. Turn airplane mode off: it uploads by itself.
6. **Close the browser** during recording and reopen: *Recover it* should offer the recording.
7. Open the meeting and **play the audio**, search the transcript, edit a line, export as Markdown.
8. Turn **Dark** mode on and off, rotate the phone, and make the text size larger in the phone's settings. Nothing should overlap or be cut off.
9. **Installed app only:** close it fully, reopen it twice and check the *new version* bar appears after a deploy.

## Likely problems and what to look for

| Risk | Why | What you would see |
|---|---|---|
| iPhone Safari writes MP4 slightly differently from desktop Edge | The live test used desktop Edge's MP4/AAC, which has the same codec but is not Safari's own file | The meeting fails with *Failed to decode audio* after upload. Diagnostics shows the format as `audio/mp4`. **Lower risk than before: the codec is proven, only Safari's packaging is not.** |
| Recording stops when the screen locks or the app is hidden | iOS and many Android phones suspend web pages | The recording ends at the moment you locked it. Crash-recovery should still offer what was captured. |
| Microphone permission asked again every time | Installed iPhone apps ask each launch | Annoying, not a bug; note it. |
| Storage cleared after a week unused (iPhone) | Safari limits storage for sites not added to the home screen | Queued offline recordings or drafts disappear. |
| Keyboard covers the field you type in | Fixed bottom navigation and small screens | The bottom bar sits on top of the field. |
| Live captions do nothing | Not supported on iPhone browsers other than Safari, nor on Firefox | The switch is missing and a note explains. |
| Hindi or Tamil text is cut off | Long words | Should not happen at 320 px (checked), but check on a real device. |

## How to report a problem

Paste the **Copy diagnostics** text and say: the device, what you did, what you expected and what happened. A screenshot or screen recording helps. For a failed meeting also give the meeting title and the time.

## Next steps once you have results
- If iPhone recordings still fail to transcribe, the fix is to convert to WAV in the browser before upload (the code for slicing WAV already exists in `src/lib/wav.ts`).
- If recording stops on screen lock, the app can show a clear warning and offer to keep the screen awake (it already requests a wake lock where supported).
