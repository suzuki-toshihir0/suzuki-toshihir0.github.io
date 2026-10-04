# 同梱するフォントを作る（npm run fonts の後半）。fontTools と brotli が要る
# 元のフォントは google/fonts の決まった commit から取り、ハッシュを確かめる。
# chars.json の文字だけを残して woff2 にし、fonts/ に置く。ライセンス文も一緒に置く
import hashlib, io, json, pathlib, urllib.request
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
CACHE = HERE / ".src"
OUT = ROOT / "fonts"
COMMIT = "9710da1eacb3be272583c3224dcb70f9da6eadbb"   # google/fonts
BASE = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl/"
SOURCES = {
    "MPLUS1p-Regular.ttf": ("mplus1p/MPLUS1p-Regular.ttf", "2f294ad496432b1608f070d310e3aa2adcf1de4af429f4901df97ec4bd361ed1"),
    "MPLUS1p-Bold.ttf": ("mplus1p/MPLUS1p-Bold.ttf", "76eb077b0a31ca33ca40238e47da5a17e2786741607cec09678d7d2e5ab1afc1"),
    "JetBrainsMono-wght.ttf": ("jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf", "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda"),
}
LICENSES = {"OFL-MPLUS1p.txt": "mplus1p/OFL.txt", "OFL-JetBrainsMono.txt": "jetbrainsmono/OFL.txt"}

def fetch(rel):
    with urllib.request.urlopen(BASE + rel) as r:
        return r.read()

def source(name):
    rel, sha = SOURCES[name]
    p = CACHE / name
    if not p.exists():
        CACHE.mkdir(exist_ok=True)
        p.write_bytes(fetch(rel))
    got = hashlib.sha256(p.read_bytes()).hexdigest()
    if got != sha:
        raise SystemExit(f"{name} のハッシュが違う: {got}")
    return p

def make(font, text, out):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.name_IDs = ["*"]
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(font)
    font.flavor = "woff2"
    font.save(out)
    missing = [c for c in text if ord(c) not in font.getBestCmap()]
    print(f"{out.name}: {out.stat().st_size / 1024:.1f} KB（{len(text)} 文字、フォントに無いもの {''.join(missing) or 'なし'}）")

chars = json.loads((HERE / "chars.json").read_text())
OUT.mkdir(exist_ok=True)
make(TTFont(source("MPLUS1p-Regular.ttf")), chars["mplus-400"], OUT / "mplus1p-400.woff2")
make(TTFont(source("MPLUS1p-Bold.ttf")), chars["mplus-700"], OUT / "mplus1p-700.woff2")
# JetBrains Mono は可変フォント。使う太さ 400〜600 だけを残す
# （絞ったものを一度書き出して読み直してから切り出す。そのまま切り出すと、表の読み込みが食い違って失敗する）
buf = io.BytesIO()
instancer.instantiateVariableFont(TTFont(source("JetBrainsMono-wght.ttf")), {"wght": (400, 600)}).save(buf)
buf.seek(0)
make(TTFont(buf), chars["jbm"], OUT / "jetbrainsmono.woff2")
for name, rel in LICENSES.items():
    (OUT / name).write_bytes(fetch(rel))
