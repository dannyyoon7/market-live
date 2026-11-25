import asyncio, collections, json, sys
from playwright.async_api import async_playwright
URL="https://dannyyoon7.github.io/market-live/"
async def main(name, vp, dev, seconds=25):
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(viewport=vp, device_scale_factor=dev)
        pg=await ctx.new_page()
        logs, errs, failed, codes = [], [], [], collections.Counter()
        pg.on("console", lambda m: logs.append((m.type,m.text[:120])))
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("requestfailed", lambda r: failed.append([r.url[:90], str(r.failure)]))
        pg.on("response", lambda r: codes.update([r.status]) if r.status>=400 else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(seconds*1000)
        snap=await pg.evaluate("""() => ({cards:[...document.querySelectorAll('.card')].map(c=>({id:c.dataset.id,num:c.querySelector('.num').textContent.trim(),delta:c.querySelector('.delta').textContent.replace(/\\s+/g,' ').trim(),src:c.querySelector('.src .tx').textContent.trim()})),status:document.querySelector('#statusText').textContent.trim(),overflow:document.documentElement.scrollWidth-window.innerWidth,share:buildShareText()})""")
        await pg.screenshot(path=f"screenshots/{name}.png", full_page=True)
        print("==",name,"|",snap["status"],"| cards",len(snap["cards"]),"| missing",[c["id"] for c in snap["cards"] if c["num"] in ("–","")],"| overflow",snap["overflow"])
        print("   console:",logs,"errors:",errs,"failed:",failed,"4xx:",dict(codes))
        for c in snap["cards"]: print(f"   {c['id']:<9} {c['num']:>13} {c['delta'][:26]:<26} {c['src']}")
        if name=="live-final-mobile": print(snap["share"])
        await b.close()
asyncio.run(main(sys.argv[1], {"width":int(sys.argv[2]),"height":int(sys.argv[3])}, 2 if sys.argv[1].endswith("mobile") else 1, int(sys.argv[4]) if len(sys.argv)>4 else 25))
