import asyncio, json, collections
from playwright.async_api import async_playwright
URL="https://dannyyoon7.github.io/market-live/"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for name, vp, dev, ua in [("live-v2-mobile",{"width":390,"height":844},2,"Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36"),
                                  ("live-v2-desktop",{"width":1280,"height":900},1,None)]:
            ctx=await b.new_context(viewport=vp, device_scale_factor=dev, user_agent=ua)
            pg=await ctx.new_page()
            logs,errs,failed=[],[],[]
            codes=collections.Counter()
            pg.on("console", lambda m: logs.append((m.type,m.text[:120])))
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("requestfailed", lambda r: failed.append([r.url[:90], str(r.failure)]))
            pg.on("response", lambda r: codes.update([r.status]) if r.status>=400 else None)
            await pg.goto(URL, wait_until="load")
            await pg.wait_for_timeout(15000)
            snap=await pg.evaluate("""() => ({cards:[...document.querySelectorAll('.card')].map(c=>({id:c.dataset.id,num:c.querySelector('.num').textContent.trim(),src:c.querySelector('.src .tx').textContent.trim()})),status:document.querySelector('#statusText').textContent.trim(),count:document.querySelector('#countdown').textContent.trim(),overflow:document.documentElement.scrollWidth-window.innerWidth,share:buildShareText()})""")
            await pg.screenshot(path=f"screenshots/{name}.png", full_page=True)
            missing=[c for c in snap["cards"] if c["num"] in ("–","")]
            print("==",name,"| status:",snap["status"],"| count:",snap["count"],"| overflow:",snap["overflow"],"| cards:",len(snap["cards"]),"| missing:",[c["id"] for c in missing])
            for c in snap["cards"]: print(f"   {c['id']:<9} {c['num']:>13}  {c['src']}")
            print("   console:",logs,"| errors:",errs,"| failed:",failed,"| 4xx/5xx:",dict(codes))
            if name.endswith("mobile"): print("   SHARE:\n"+snap["share"])
            await ctx.close()
        await b.close()
asyncio.run(main())
