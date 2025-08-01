import asyncio
from aiohttp import web
import bcrypt
import random
import json
import ssl
import os
import base64
import argparse

from tinydb import TinyDB, Query

from thrilldigger.thrilldigger import ThrilldiggerEnv

# Port configurations
HTTPS_PORT = 443

# Paths
PUBLIC_DIR = 'public'

LEADERBOARD_PATH = 'leaderboard'
USER_HASHES = dict() 

db = TinyDB('db/leaderboard.json')
use_auth = True


def parse_basic_auth(header):
    if not header or not header.startswith("Basic "):
        return None
    try:
        b64 = header.split(" ", 1)[1]
        decoded = base64.b64decode(b64).decode("utf-8")
        username, password = decoded.split(":", 1)
        return {"username": username, "password": password}
    except Exception:
        return None



@web.middleware
async def basic_auth_middleware(request, handler):
    creds = parse_basic_auth(request.headers.get("Authorization"))
    if not creds:
        return web.Response(status=401, headers={"WWW-Authenticate": "Basic realm=\"Thrilldigger\""})
    username, password = creds.get("username"), creds.get("password")
    hashed = USER_HASHES.get(username)
    if not hashed or not bcrypt.checkpw(password.encode(), hashed.encode()):
        return web.Response(status=403)

    return await handler(request)


async def index(request):
    return web.FileResponse('public/index.html')


async def health_check(request):
    return web.Response(text="OK", status=200)


def run_servers(port, use_ssl):
    global USER_HASHES

    if use_auth:
        with open("auth/auth_users.json") as f:
            USER_HASHES = json.load(f)
        app = web.Application(middlewares=[basic_auth_middleware])
    else:
        app = web.Application()
    app.router.add_get('/', index)
    app.router.add_static('/', path=PUBLIC_DIR, name='static')
    app.router.add_get('/' + LEADERBOARD_PATH, websocket_handler)
    app.router.add_get('/health', health_check)
    if use_ssl:
        ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
        ssl_context.load_cert_chain(os.getenv("CERT_PATH"), os.getenv("KEY_PATH"))
    else:
        ssl_context = None
    web.run_app(app, port=port, ssl_context=ssl_context)


def getleaderboard():
    dbresult = db.all()
    dbresult.sort(key=lambda el:-el['score'])
    return [(el['name'], el['score']) for el in dbresult[:20]]


async def send_leaderboard(ws):
    client_id = id(ws)
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
    if use_auth:
        auth_header = request.headers.get("Authorization")
        creds = parse_basic_auth(auth_header)

        if not creds or creds.get("username") not in USER_HASHES:
            return web.Response(status=401)

        if not bcrypt.checkpw(creds.get("password").encode(), USER_HASHES[creds.get("username")].encode()):
            return web.Response(status=403)

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
                score = int(data.get("score"))

                if name is None or name.strip() == '':
                    raise ValueError("No name")

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
    parser = argparse.ArgumentParser(description="Thrilldigger Server")
    parser.add_argument('--local', action='store_true', help='Run server in local mode')

    args = parser.parse_args()

    ThrilldiggerEnv()
    if args.local:
        print("Running in local mode — no SSL")
        # Start server on port 80 without SSL
        use_auth = False
        run_servers(port=80, use_ssl=False)
    else:
        print("Running in production mode — with SSL")
        # Load cert paths from environment
        use_auth = True
        run_servers(port=443, use_ssl=True)

