# Running ALTER on fal.ai

Everything here goes through `scripts/alter_fal.py`, which uses the `fal-client` package and the key in `FAL_KEY`
(`FAL_AI_API_KEY` is accepted too). The key is never printed or written to disk.

## Models

| Step             | Endpoint                                    | Notes                                                                           |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Edit             | `bytedance/seedance-2.5/reference-to-video` | `task: "editing"`, the source as `video_urls[0]`, references as `image_urls`    |
| Finalise a draft | `bytedance/seedance-2.5/draft/complete`     | input: `draft_id`, optional `codec` (`auto`, `H264`, `H265`); output 1080p only |
| Target frames    | `fal-ai/nano-banana-pro/edit`               | `image_urls` (up to 14), `num_images`, `resolution` 1K/2K/4K, `aspect_ratio`    |
| Ambience         | `fal-ai/elevenlabs/sound-effects/v2`        | `text`, `duration_seconds` 0.5 to 22, `loop`                                    |

These schemas were read from fal's model pages when the skill was adapted. Re-read the page if a call is rejected
for an unknown field; parameters change.

## Drafts and finalising

- `draft: true` makes a 480p preview and returns a `draft_id`. It stays valid for seven days and only for the
  account that made it. `alter_fal.py run` saves it in `<out>.json` beside the video.
- `alter_fal.py finalize` completes it at 1080p. Aspect ratio follows the draft, so 1080p does not always mean
  1920 x 1080. Completion cannot change the creative settings: to change anything, make a new draft.
- Price: the edit is billed per 1000 tokens. Tokens are about height x width x (input seconds + output seconds) x 24
  / 1024, and a reference video is charged as well as the output. The finalise is listed at about $1.164 per
  second of output (about 0.6x with a video input). The scripts print an estimate; fal's pricing page is the
  authority, and your balance is under Credits in the dashboard.
- A draft that passes can still fail audio moderation when finalised. Make a new draft.

## Waiting

`alter_fal.py` waits for the job (it uses `fal_client.subscribe`), so a run is one command. A draft of a 5 second
clip took a couple of minutes in testing. If a job sits for 15 minutes it is usually dead: relaunch once.

## Filters

- A rejection that mentions content policy, likenesses of real people, or `partner_validation_failed` comes from the
  model maker and covers photos and videos with real faces, and logos or brands. `alter_fal.py` exits with code 3
  and says so. Do not reword the prompt or disguise the inputs. Change the input, or ask the user.
- Local files are uploaded to fal's storage before the call, so the user's footage leaves the machine. Say so if the
  footage is private.

## Download

`alter_fal.py` saves the result next to the path you give. A finalised video is 1080p; `alter_finish.py` conforms it
to the source's frame count and encodes H.264, and puts the source sound back.
