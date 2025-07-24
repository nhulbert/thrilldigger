import asyncio
from aiohttp import web
import random
import json
import ssl
import os
from tinydb import TinyDB, Query

from thrilldigger.thrilldigger import ThrilldiggerEnv

# Port configurations
HTTPS_PORT = 443

# Paths
PUBLIC_DIR = 'public'

LEADERBOARD_PATH = 'leaderboard'


# Compilation Commands
ffi = None
cartpole_lib = None
trainer = None
model = None

db = TinyDB('db/leaderboard.json')


async def index(request):
    return web.FileResponse('public/index.html')

async def health_check(request):
    return web.Response(text="OK", status=200)

def run_servers():
    app = web.Application()
    app.router.add_get('/', index)
    app.router.add_static('/', path=PUBLIC_DIR, name='static')
    app.router.add_get('/' + LEADERBOARD_PATH, websocket_handler)
    app.router.add_get('/health', health_check)
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.load_cert_chain(os.getenv("CERT_PATH"), os.getenv("KEY_PATH"))
    web.run_app(app, port=HTTPS_PORT, ssl_context=ssl_context)


def getleaderboard():
    dbresult = db.all()
    dbresult.sort(key=lambda el:-el['score'])
    return [(el['name'], el['score']) for el in dbresult[:20]]


async def send_leaderboard(ws):
    client_id = id(ws)
    global model
    try:
        while True:
            leaderboard = getleaderboard()
            data = {"type": "leaderboard",
                    "leaderboard": leaderboard}
            await ws.send_str(json.dumps(data))
            await asyncio.sleep(2)
    except Exception as e:
        print(f"Client {client_id} disconnected: {type(e).__name__} - {e}")


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    print("WebSocket connection established:", request.path)

    if request.path == "/" + LEADERBOARD_PATH:
        asyncio.create_task(send_leaderboard(ws))

    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
                name = data.get("name")
                score = data.get("score")

                print(f"Inserting score from {name}: {score}")
                db.insert({'name': name, 'score': score})

                data = {"type": "scoreAck", "successful": True}
                await ws.send_str(json.dumps(data))

            except Exception as e:
                print("Error processing score:", e)
                data = {"type": "scoreAck", "successful": False}
                await ws.send_str(json.dumps(data))
        elif msg.type == web.WSMsgType.ERROR:
            print("WebSocket connection closed with exception:", ws.exception())

    print("WebSocket connection closed.")
    return ws


if __name__ == "__main__":
    ThrilldiggerEnv()
    run_servers()

