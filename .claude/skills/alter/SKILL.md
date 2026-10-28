---
name: alter
description: 'Use when changing what is in an existing video while keeping its performance, on fal.ai with Seedance 2.5 in edit mode: swap a product, prop or outfit in the take; recast who performs it; move the scene to a new place; restyle the footage (anime, 3D feature, claymation, comic); make wardrobe, cast or market variants of one take that stay frame-aligned; or alter clips longer than 30 seconds. Builds a photoreal target frame first so swaps look photographed rather than pasted, assembles every prompt from tested presets, drafts at 480p and finalises only the keepers, checks every output against the source (change, structure, motion, jumps, tail drift, 100% crops of what changed), puts the source sound back or lays a new ambience, and exports before/afters and a version reel. Also preps phone footage (HDR, rotation, variable frame rate). Keywords: ALTER, video to video, V2V, object swap, product swap, motion transfer, recast, restyle, wardrobe change, ad variants, change anything keep the performance.'
license: MIT
---

# ALTER: change anything in a video, keep the performance

Adapted from the `scenario-alter` skill by Scenario Inc. (MIT, `scenario-labs/skills`; see `LICENSE`). The method, the
presets, the checks and the local scripts are theirs. The model calls are rewritten to go straight to fal.ai instead
of the Scenario MCP.

## Overview

One source clip in, the same performance out with one thing changed: the product in a hand, the outfit, who is on
screen, where they are, or the whole look. Motion, camera, timing and framing come from the source frame for frame,
so several versions of one take can be cut together on one clock.

It runs on fal.ai:

| Step                      | fal endpoint                                                                  | Script                  |
| ------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| The edit, as a 480p draft | `bytedance/seedance-2.5/reference-to-video`, `task: "editing"`, `draft: true` | `alter_fal.py run`      |
| Finalise a keeper         | `bytedance/seedance-2.5/draft/complete` (takes the `draft_id`)                | `alter_fal.py finalize` |
| Target frame              | `fal-ai/nano-banana-pro/edit` (Gemini 3 Pro Image)                            | `alter_fal.py frame`    |
| Ambience for a new place  | `fal-ai/elevenlabs/sound-effects/v2`                                          | `alter_fal.py sound`    |

Everything else (probing, prepping, prompts, checks, finishing, reels, splitting) is local Python and ffmpeg and
never touches the network. The presets, the draft-and-finalise loop and the checker's thresholds were measured by
Scenario on this same model (Seedance 2.5) through their route. On fal the model is the same, but **none of it has
been re-measured on fal yet**: run `alter_check.py` on the first draft and trust its numbers over the thresholds'
wording.

**Before anything.** Check `FAL_KEY` is set, without printing it (`[ -n "$FAL_KEY" ] && echo set`). If not, tell the
user to add it as a secret in the environment and to start a new session. Never ask for the key in chat, never write
it into a file. Needs `pip install fal-client numpy Pillow`, and ffmpeg and ffprobe on PATH. HDR phone footage is
tone-mapped with macOS `avconvert` when present, otherwise an ffmpeg build with zscale.

**Money.** Every `alter_fal.py` command is a dry run (it shows the input and a price estimate) until `--go` is added.
Show the user the estimate and get a yes before `--go`. Finalising is the expensive step: fal lists about $1.16 per
second of output at 1080p (about 0.6x of that when a video is an input), so a 5 second clip is a few dollars. Drafts
are far cheaper. Run one draft at a time until the user likes the look.

**People and filters.** Work on footage the user owns or has the rights to, and recast only with people who agreed
to it. Seedance refuses videos or photos that contain real people's likenesses (fal returns `content_policy_violation`,
`partner_validation_failed`). When that happens, **do not** reword the prompt, crop, mask or disguise the inputs to
get past it, and do not retry: tell the user, and offer what works without a real face in the reference (outfit,
product, place, restyle). Whether a real person in the source clip is accepted for those edits is the model's call.
A different model with other rules is the user's decision to make, not yours.

**The three modes.** The opening sentence of the prompt decides what the model may change, so each mode has its own:

| Mode                    | What is kept                            | What changes                                            | Reference that works best                                                                                    |
| ----------------------- | --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Swap** (O)            | everything, exactly as shot             | one element: product, prop, outfit, hair, device, shoes | a target frame: a frame of this shot with the new element photographed in                                    |
| **Motion transfer** (M) | the performance, the camera, the timing | who performs it, or where it happens                    | a target frame with the new person (in the source's clothes) or the new place                                |
| **Restyle** (R)         | motion and composition only             | the whole rendering                                     | prompt alone first; if the background stays photographic, this shot's first frame fully redrawn in the style |

## Quick reference

```bash
S=.claude/skills/alter/scripts                                # from the repo root
python3 $S/alter_probe.py clip.MOV                            # limits, HDR, rotation, variable frame rate
python3 $S/alter_prep.py clip.MOV --out prepared.mp4 --start 2 --end 10   # fix all of that, trim to the moment
python3 $S/alter_frame.py prepared.mp4 --sheet moments.jpg    # pick the frame for the target frame
python3 $S/alter_frame.py prepared.mp4 --t 7.7 --out frame.png
python3 $S/alter_prompt.py --list                             # 36 presets, grouped by use, each with its mode
python3 $S/alter_prompt.py product-swap --who "the man with dark curly hair" \
    --set object="white paper coffee cup" --set product="slim cream drinks can" \
    --video prepared.mp4 --image target.png --out run.json    # prompt + fal input, 480p draft
python3 $S/alter_fal.py run run.json --out draft.mp4          # dry run: prints the input and the price
python3 $S/alter_fal.py run run.json --out draft.mp4 --go     # after the user agreed to the price
python3 $S/alter_check.py prepared.mp4 draft.mp4 --out qa/ --mode swap   # swap|recast|motion|restyle
python3 $S/alter_fal.py finalize --draft draft.mp4 --out final.mov --go
python3 $S/alter_finish.py prepared.mp4 final.mov --out out/final.mp4 --trim-tail 9 --compare
python3 $S/alter_versions.py prepared.mp4 v1.mp4 v2.mp4 v3.mp4 --out reel.mp4 --with-source --frames 184
python3 $S/alter_split.py long.mp4 --out segs/                # over 30 s; then alter_assemble.py segs/manifest.json
```

Presets are stored with `@video1` and `@image1`; the builder writes them as fal spells them, `@Video1` and
`@Image1`. In the edit the source is always `@Video1`, and the target frame is `@Image1`.

fal limits for the edit (from its schema): MP4 or MOV, 1.8 to 30.2 s per video and 30.2 s in all, 300 to 6000 px per
side, aspect ratio 0.4 to 2.5, 24 to 60 fps, at most 200 MB; up to 30 images. `task: "editing"` fixes duration and
aspect ratio to the source's, so the scripts send neither. Edit runs under 4 seconds were not tested by Scenario, so
the scripts ask for at least 4. More on running and waiting: [references/fal.md](references/fal.md).

## Workflow

1. **Probe and prep.** `alter_probe.py` says what the clip needs; `alter_prep.py` fixes it: HDR to SDR, rotation baked in, constant frame rate, short side at least 480 px, long side at most 1920 px, trimmed to 4 to 30 seconds. Edit mode settles differently in the last third of a second when the action is fast at the very end (6 of 11 kept edits in Scenario's run, by 3 to 9 frames), so leave a held beat at the end of the span or plan to trim the tail.
2. **One change per run.** Pick one preset (`alter_prompt.py --list`). Two changes in one run ("new outfit and new place") drift more. Read what the user wants:
   - **A chain** ("give him a leather jacket, then make that anime"): run the second change on the first's finalised output. Run it through `alter_prep.py` first (finalised files come back as 10-bit video) and use that as the new source.
   - **Versions** ("a leather jacket version, and also a comic version"): run each change on the original, in parallel. This is the default when the request is ambiguous; say which you chose.
3. **Make the reference a target frame.** Seedance copies an example of the finished look far better than it infers one. For swaps, outfits, recasts and new places, take the clearest frame (`alter_frame.py --sheet`, then `--t`) and have the image model change only that element in that frame, photographed in that light (`alter_fal.py frame`). Generate two, look at both at 100%, keep one. Method and prompts: [references/realism-pass.md](references/realism-pass.md).
   - A recast reference wears the source's clothes, or the reference's own clothes leak into the shot.
   - A new place keeps the performer at the same size and position as in the source frame; it holds alignment.
4. **Build the prompt with `alter_prompt.py`.** It writes the mode's opening block, the preset's change line and the close block, binds the images, refuses the combinations that failed in testing, and prints the matching check command. Put the user's words into `--set` slots, not into a rewritten prompt. `--who` describes the person without the thing you are changing ("the man with dark curly hair", not "the man in the olive hoodie" when the hoodie changes): the opening asks to keep everything about `--who`. Presets and rules: [references/presets.md](references/presets.md).
5. **Price, then run 480p drafts.** Dry run, tell the user the price, then `--go`. Launch one or two at a time. Scenario saw a multi-hour rate-limit cooldown after about 28 jobs in 30 minutes; fal's limits differ, but do not flood it. A job stuck for 15 minutes is usually dead: relaunch once.
6. **Check every draft.** `alter_check.py source draft --out qa/ --mode ...`, then open `qa/crops.jpg` (100% crops of what changed) and `qa/sheet.jpg`. What it measures and how to read it: [references/qa.md](references/qa.md). Re-run a failed draft once (takes vary) or strengthen its target frame; never stitch two takes mid-action.
7. **Restyles: prompt first, then a target frame.** The default restyle prompt names the background as art ("hand-painted anime background art"). If the check still reports the background photographic (structure above 0.65), redraw this shot's first frame in the style with the image model and pass it with `--image`: the builder binds it as "the first frame of the result".
8. **Finalise only the keepers** with `alter_fal.py finalize --draft draft.mp4` (same motion, framing and sound, at 1080p; the draft must be under seven days old and made by the same account), then check again: finalising can sharpen a soft painterly look back toward the photo. If fal rejects the final on audio moderation, make a new draft rather than retrying the same id.
9. **Sound.** Keep `generate_audio` off: with it on, both world edits in Scenario's run came back with murmured speech nobody asked for. `alter_finish.py` puts the source sound back (lips and footsteps stay in sync because the motion is the source's). For a new place, make an ambience bed with `alter_fal.py sound` and pass it with `--audio`; it loops if shorter. Recasting to a different voice type needs a voice changer on the source line: [references/sound.md](references/sound.md).
10. **Deliver.** `alter_finish.py --trim-tail N --compare` writes the final plus a side by side and a wipe. For variants, `alter_versions.py` cuts between frame-aligned versions on one clock with the source sound. Clips over 30 seconds: `alter_split.py` cuts at real shot changes, run every segment with the same preset and references, then `alter_assemble.py` joins them frame-exact under the original sound.

## Common mistakes

- Handing the edit a flat product render for a swap: it reads as pasted on, and the old object's shape can survive. Build the target frame.
- Using one mode's opening in another: a swap's "keep absolutely everything (the light, the set)" inside a restyle makes the model return the source unchanged. The builder refuses it.
- A restyle prompt that only describes the people: they get drawn and the sky, sea and buildings stay a photo. Name the background as art; if it still stays a photo, add a redrawn first frame as the target.
- Leaving `generate_audio` on: the model invents a track (murmured voices included) and the lips and steps stop matching. Put the source sound back, or lay an ambience made for the new place.
- Two changes in one run. Chain runs instead.
- Judging a draft from its thumbnail. Open the 100% crops; models add real-brand marks to sportswear and shoes even under "no logos", invent props they cannot see, and add fingers.
- Showing the last frames untrimmed: when the source ends on a fast move, the edit's last third of a second leaves the source. Trim what `alter_check.py` reports as tail drift, on every version of a set, so they loop together.
- Finalising and shipping without a second check: finalising a restyle can pull detail back toward the photo.
- Recasting from a bare face crop: the model may only age the original face, and the reference's clothes leak in. Use a target frame of this shot with the new person in the source's clothes; trim the first frames if they open on the reference's expression.
- Rewording a prompt, or altering inputs, to get past a content or real-person filter: do not. Change the input or ask the user.
- Spending without a quote: always show the price and get a yes before `--go`.
- Speeding up or freezing people to fit a slot. Retime only camera-only moves, at exact integer speeds.
- Rendering text, prices or logos into references. Composite text in post.
