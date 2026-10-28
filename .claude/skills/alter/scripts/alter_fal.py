#!/usr/bin/env python3
"""The ALTER model steps on fal.ai: edit (draft), finalise, target frame, ambience, character replace.

Needs `pip install fal-client` and a key in FAL_KEY (FAL_AI_API_KEY is accepted too). The key is never printed.

Every command that spends money prints what it would send and a price estimate, and stops there. Add --go to run it.

  python3 alter_fal.py run run.json --out draft.mp4 [--go]          # run.json comes from alter_prompt.py --out
  python3 alter_fal.py finalize --draft draft.mp4 --out final.mov [--go]     # or --draft-id ID
  python3 alter_fal.py frame --image frame.png [--image sheet.png] --prompt "..." --num 2 --out target.png [--go]
  python3 alter_fal.py sound --text "..." --seconds 9 --loop --out bed.mp3 [--go]
  python3 alter_fal.py replace --video prepared.mp4 --image character.png --prompt "..." --out replaced.mp4 [--go]

`run` and `finalize` write <out>.json next to the video (the draft_id, the seed, the endpoint). A draft is valid for
seven days and only for the account that made it.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.request

EDIT = 'bytedance/seedance-2.5/reference-to-video'
COMPLETE = 'bytedance/seedance-2.5/draft/complete'
IMAGE = 'fal-ai/nano-banana-pro/edit'
SOUND = 'fal-ai/elevenlabs/sound-effects/v2'
# Not Seedance: Alibaba's Wan 2.2 Animate swaps the person in a clip for the character in one image. Its own rules.
REPLACE = 'fal-ai/wan/v2.2-14b/animate/replace'
# fal's listed price per "video second" (frames / 16), by output resolution
REPLACE_PER_SECOND = {'480p': 0.04, '580p': 0.06, '720p': 0.08}
# fal's published figure for a 1080p finalise, per second of output (about 0.6x of that when a video is an input)
COMPLETE_PER_SECOND = 1.164


def key_or_exit():
    if not os.environ.get('FAL_KEY') and os.environ.get('FAL_AI_API_KEY'):
        os.environ['FAL_KEY'] = os.environ['FAL_AI_API_KEY']
    if not os.environ.get('FAL_KEY'):
        raise SystemExit('FAL_KEY is not set. Add it as a secret in the environment; never paste it into the chat.')


def client():
    key_or_exit()
    try:
        import fal_client
    except ImportError:
        raise SystemExit('fal-client is missing: pip install fal-client')
    return fal_client


def unit_price(endpoint):
    """fal's listed unit price for an endpoint, or None. Best effort; never blocks a run."""
    if not os.environ.get('FAL_KEY') and os.environ.get('FAL_AI_API_KEY'):
        os.environ['FAL_KEY'] = os.environ['FAL_AI_API_KEY']
    try:
        req = urllib.request.Request(
            f'https://api.fal.ai/v1/models/pricing?endpoint_id={endpoint}',
            headers={'Authorization': 'Key ' + os.environ['FAL_KEY']})
        with urllib.request.urlopen(req, timeout=15) as r:
            p = json.load(r)['prices'][0]
        return p['unit_price'], p['unit']
    except Exception:
        return None


def ffprobe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=width,height:format=duration', '-of', 'json', path],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    return j['streams'][0]['width'], j['streams'][0]['height'], float(j['format']['duration'])


def estimate_edit(params):
    """fal: tokens = h * w * (input s + output s) * 24 / 1024, billed per 1000 tokens. An upper bound for an edit."""
    src = (params.get('video_urls') or [None])[0]
    price = unit_price(EDIT)
    if not (src and os.path.exists(src) and price):
        return None
    w, h, dur = ffprobe(src)
    res = 480 if params.get('draft') else int(str(params.get('resolution', '720p')).rstrip('p'))
    scale = res / min(w, h)
    tokens = (w * scale) * (h * scale) * (2 * dur) * 24 / 1024
    return tokens / 1000 * price[0]


def say_price(label, usd):
    if usd is None:
        print(f'price: could not estimate {label}; check the model page on fal.ai before running')
    else:
        print(f'price: about ${usd:.2f} for {label} (an estimate from fal\'s published rate)')


def upload_local(fc, items):
    """Local paths become fal URLs; anything that is not an existing file is assumed to be a URL already."""
    out = []
    for it in items:
        out.append(fc.upload_file(it) if os.path.exists(it) else it)
    return out


def run_endpoint(fc, endpoint, args):
    try:
        return fc.subscribe(endpoint, arguments=args, with_logs=False,
                            on_queue_update=lambda u: print(' ', type(u).__name__, flush=True))
    except Exception as e:
        msg = str(e)
        if 'content_policy' in msg or 'likeness' in msg or 'moderat' in msg:
            print('fal / the model maker rejected the inputs on content policy (real people, brands or similar):\n  '
                  + msg[:400], file=sys.stderr)
            print('Do not reword the prompt or disguise the inputs to get past it. Change the input, or ask the user.',
                  file=sys.stderr)
            raise SystemExit(3)
        raise SystemExit('fal error: ' + msg[:600])


def fetch(url, path, force):
    if os.path.exists(path) and not force:
        raise SystemExit(f'{path} already exists. Pick another path or pass --force to replace it.')
    urllib.request.urlretrieve(url, path)


def sidecar(path, data):
    with open(path + '.json', 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=1)


def cmd_run(a):
    with open(a.json, encoding='utf-8') as fh:
        payload = json.load(fh)
    params = dict(payload['parameters'])
    print(f'endpoint: {EDIT}\nprompt: {params["prompt"]}')
    print('inputs:', {k: v for k, v in params.items() if k != 'prompt'})
    say_price('this ' + ('480p draft' if params.get('draft') else 'edit'), estimate_edit(params))
    if not a.go:
        print('dry run: nothing sent. Add --go to run it.')
        return 0
    fc = client()
    for k in ('video_urls', 'image_urls'):
        if params.get(k):
            params[k] = upload_local(fc, params[k])
    res = run_endpoint(fc, EDIT, params)
    fetch(res['video']['url'], a.out, a.force)
    sidecar(a.out, {'endpoint': EDIT, 'preset': payload.get('preset'), 'seed': res.get('seed'),
                    'draft_id': res.get('draft_id'), 'draft': bool(params.get('draft')),
                    'check': payload.get('check')})
    print(f'wrote {a.out}' + (f'  (draft_id {res["draft_id"]}, valid 7 days)' if res.get('draft_id') else ''))
    return 0


def cmd_finalize(a):
    draft_id = a.draft_id
    secs = None
    if a.draft:
        with open(a.draft + '.json', encoding='utf-8') as fh:
            draft_id = draft_id or json.load(fh).get('draft_id')
        secs = ffprobe(a.draft)[2]
    if not draft_id:
        raise SystemExit('no draft_id: pass --draft draft.mp4 (with its .json beside it) or --draft-id ID')
    print(f'endpoint: {COMPLETE}\ndraft_id: {draft_id}\ncodec: {a.codec}')
    say_price('1080p finalising', secs * COMPLETE_PER_SECOND * 0.6 if secs else None)
    if secs:
        print(f'  (up to ${secs * COMPLETE_PER_SECOND:.2f} at fal\'s full per-second rate of ${COMPLETE_PER_SECOND})')
    if not a.go:
        print('dry run: nothing sent. Add --go to run it.')
        return 0
    res = run_endpoint(client(), COMPLETE, {'draft_id': draft_id, 'codec': a.codec})
    fetch(res['video']['url'], a.out, a.force)
    sidecar(a.out, {'endpoint': COMPLETE, 'draft_id': draft_id, 'seed': res.get('seed')})
    print(f'wrote {a.out}')
    return 0


def cmd_frame(a):
    args = {'prompt': a.prompt, 'image_urls': a.image, 'num_images': a.num, 'resolution': a.resolution,
            'aspect_ratio': a.aspect, 'output_format': 'png'}
    print(f'endpoint: {IMAGE}\nprompt: {a.prompt}\ninputs: {a.image}  x{a.num} at {a.resolution}')
    say_price('these target frames', None)
    if not a.go:
        print('dry run: nothing sent. Add --go to run it.')
        return 0
    fc = client()
    args['image_urls'] = upload_local(fc, a.image)
    res = run_endpoint(fc, IMAGE, args)
    base, ext = os.path.splitext(a.out)
    for i, im in enumerate(res['images'], 1):
        dest = f'{base}_{i}{ext or ".png"}'
        fetch(im['url'], dest, a.force)
        print(f'wrote {dest}')
    return 0


def cmd_replace(a):
    args = {'prompt': a.prompt, 'video_url': a.video, 'image_url': a.image}
    if a.turbo:
        args['use_turbo'] = True
    for k in ('video_url', 'image_url'):
        if not os.path.exists(args[k]) and not args[k].startswith('http'):
            raise SystemExit(f'{args[k]}: file not found')
    print(f'endpoint: {REPLACE}\nprompt: {a.prompt}\ninputs: {({k: v for k, v in args.items() if k != "prompt"})}')
    if os.path.exists(a.video):
        probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
                                'stream=nb_read_frames,r_frame_rate', '-of', 'json', a.video],
                               capture_output=True, text=True, check=True).stdout
        st = json.loads(probe)['streams'][0]
        billed = int(st['nb_read_frames']) / 16
        print(f'price: {billed:.1f} billed seconds (frames / 16); ' + ', '.join(
            f'${billed * r:.2f} at {k}' for k, r in REPLACE_PER_SECOND.items()) + " (fal's listed rates; the output size is the model's)")
    else:
        say_price('this replace', None)
    if not a.go:
        print('dry run: nothing sent. Add --go to run it.')
        return 0
    fc = client()
    for k in ('video_url', 'image_url'):
        args[k] = upload_local(fc, [args[k]])[0]
    res = run_endpoint(fc, REPLACE, args)
    fetch(res['video']['url'], a.out, a.force)
    sidecar(a.out, {'endpoint': REPLACE, 'seed': res.get('seed')})
    print(f'wrote {a.out}')
    return 0


def cmd_sound(a):
    args = {'text': a.text, 'loop': a.loop, 'output_format': 'mp3_44100_128'}
    if a.seconds:
        args['duration_seconds'] = min(max(a.seconds, 0.5), 22.0)
    print(f'endpoint: {SOUND}\ninputs: {args}')
    say_price('this ambience', None)
    if not a.go:
        print('dry run: nothing sent. Add --go to run it.')
        return 0
    res = run_endpoint(client(), SOUND, args)
    fetch(res['audio']['url'], a.out, a.force)
    print(f'wrote {a.out}')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)

    def common(p):
        p.add_argument('--go', action='store_true', help='actually run it and spend money (default: show and price only)')
        p.add_argument('--force', action='store_true', help='overwrite an existing output')

    p = sub.add_parser('run', help='the edit, as a 480p draft or a direct final')
    p.add_argument('json')
    p.add_argument('--out', required=True)
    common(p)
    p.set_defaults(fn=cmd_run)

    p = sub.add_parser('finalize', help='finish a draft at 1080p, same motion and framing')
    p.add_argument('--draft')
    p.add_argument('--draft-id')
    p.add_argument('--codec', default='auto', choices=['auto', 'H264', 'H265'])
    p.add_argument('--out', required=True)
    common(p)
    p.set_defaults(fn=cmd_finalize)

    p = sub.add_parser('frame', help='a target frame: the change photographed into one frame of the shot')
    p.add_argument('--image', action='append', required=True)
    p.add_argument('--prompt', required=True)
    p.add_argument('--num', type=int, default=2)
    p.add_argument('--resolution', default='2K', choices=['1K', '2K', '4K'])
    p.add_argument('--aspect', default='auto')
    p.add_argument('--out', required=True)
    common(p)
    p.set_defaults(fn=cmd_frame)

    p = sub.add_parser('sound', help='an ambience bed for a new place')
    p.add_argument('--text', required=True)
    p.add_argument('--seconds', type=float)
    p.add_argument('--loop', action='store_true')
    p.add_argument('--out', required=True)
    common(p)
    p.set_defaults(fn=cmd_sound)

    p = sub.add_parser('replace', help='swap the person in the clip for the character in one image (Wan 2.2 Animate)')
    p.add_argument('--video', required=True)
    p.add_argument('--image', required=True)
    p.add_argument('--prompt', required=True)
    p.add_argument('--turbo', action='store_true', help="fal's use_turbo toggle")
    p.add_argument('--out', required=True)
    common(p)
    p.set_defaults(fn=cmd_replace)

    a = ap.parse_args()
    return a.fn(a)


if __name__ == '__main__':
    sys.exit(main())
