# Builds src/timings.json: each scene's voice length and per-sentence start/end (seconds),
# by matching the sentence count to the longest pauses ffmpeg finds in the clip.
import json, re, subprocess
script = json.load(open('script.json'))
out = {}
for s in script:
    f = f"public/vo/{s['id']}.wav"
    dur = float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode())
    log = subprocess.run(['ffmpeg','-i',f,'-af','silencedetect=n=-35dB:d=0.12','-f','null','-'],capture_output=True,text=True).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    gaps = [(a, b) for a, b in zip(starts, ends) if a > 0.2 and b < dur - 0.1]
    sents = [x.strip() for x in re.split(r'(?<=[.?!])\s+', s['vo']) if x.strip()]
    # pick the n-1 longest gaps, in time order
    pick = sorted(sorted(gaps, key=lambda g: g[1]-g[0], reverse=True)[:len(sents)-1])
    bounds = [0.0] + [ (a+b)/2 for a, b in pick ] + [dur]
    if len(bounds) != len(sents)+1:  # fall back to character proportion
        tot = sum(len(x) for x in sents); acc = 0; bounds=[0.0]
        for x in sents: acc += len(x); bounds.append(dur*acc/tot)
    out[s['id']] = {'dur': round(dur,3), 'sentences': [{'text': t, 'start': round(bounds[i],3), 'end': round(bounds[i+1],3)} for i, t in enumerate(sents)]}
json.dump(out, open('src/timings.json','w'), indent=1)
for k,v in out.items(): print(k, v['dur'], [ (x['start']) for x in v['sentences']])
