import asyncio, json
from playwright.async_api import async_playwright
URL="https://dannyyoon7.github.io/market-live/"
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); ctx=await b.new_context(); pg=await ctx.new_page()
        await pg.goto(URL, wait_until="domcontentloaded")
        for attempt in range(3):
            res = await pg.evaluate("""() => new Promise(res => {
                const out = {events: []};
                let ws;
                try { ws = new WebSocket('wss://api.upbit.com/websocket/v1'); } catch (e) { return res({err: String(e)}); }
                ws.binaryType = 'arraybuffer';
                const t = setTimeout(() => { out.events.push('timeout'); try{ws.close();}catch(e){}; res(out); }, 8000);
                ws.onopen = () => { out.events.push('open'); ws.send(JSON.stringify([{ticket:'t'},{type:'ticker',codes:['KRW-BTC']}])); };
                ws.onmessage = async (ev) => { const s = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data); out.events.push('msg:'+s.slice(0,60)); clearTimeout(t); ws.close(); res(out); };
                ws.onerror = () => out.events.push('error');
                ws.onclose = (e) => { out.events.push('close:'+e.code); };
            })""")
            print(attempt, json.dumps(res, ensure_ascii=False)[:300])
            await pg.wait_for_timeout(1000)
        await b.close()
asyncio.run(main())
