import os
import re
import json
import time
import random
import difflib
import asyncio
import traceback
from pathlib import Path
from core.handle.sendAudioHandle import send_stt_message
from plugins_func.register import register_function, ToolType, ActionResponse, Action
from core.utils.dialogue import Message
from core.providers.tts.dto.dto import TTSMessageDTO, SentenceType, ContentType
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.connection import ConnectionHandler

TAG = __name__

MUSIC_CACHE = {}

play_music_function_desc = {
    "type": "function",
    "function": {
        "name": "play_music",
        "description": "Play music, sing a song, or listen to music. Use when the user wants to hear music.",
        "parameters": {
            "type": "object",
            "properties": {
                "song_name": {
                    "type": "string",
                    "description": "Song name. Use 'random' if no specific song requested.",
                }
            },
            "required": ["song_name"],
        },
    },
}


@register_function("play_music", play_music_function_desc, ToolType.SYSTEM_CTL)
def play_music(conn: "ConnectionHandler", song_name: str):
    try:
        music_intent = (
            f"play music {song_name}" if song_name != "random" else "play random music"
        )

        if not conn.loop.is_running():
            conn.logger.bind(tag=TAG).error("Event loop not running")
            return ActionResponse(
                action=Action.RESPONSE, result="System busy", response="Please try again later"
            )

        task = conn.loop.create_task(
            handle_music_command(conn, music_intent)
        )

        def handle_done(f):
            try:
                f.result()
                conn.logger.bind(tag=TAG).info("Music playback finished")
            except Exception as e:
                conn.logger.bind(tag=TAG).error(f"Music playback failed: {e}")

        task.add_done_callback(handle_done)

        return ActionResponse(
            action=Action.NONE, result="Command received", response="Playing music for you now"
        )
    except Exception as e:
        conn.logger.bind(tag=TAG).error(f"Music intent error: {e}")
        return ActionResponse(
            action=Action.RESPONSE, result=str(e), response="Sorry, there was an error playing music"
        )


def _extract_song_name(text):
    for keyword in ["play music", "play song", "listen to"]:
        if keyword in text.lower():
            parts = text.lower().split(keyword)
            if len(parts) > 1:
                return parts[1].strip()
    return None


def _find_best_match(potential_song, music_files):
    best_match = None
    highest_ratio = 0

    for music_file in music_files:
        song_name = os.path.splitext(music_file)[0]
        ratio = difflib.SequenceMatcher(None, potential_song.lower(), song_name.lower()).ratio()
        if ratio > highest_ratio and ratio > 0.3:
            highest_ratio = ratio
            best_match = music_file
    return best_match


def _has_sd_music(mac_address):
    """Check if device has any SD card music in the database."""
    try:
        import pymysql
        db = pymysql.connect(
            host=os.environ.get("DB_HOST", "xiaozhi-esp32-server-db"),
            port=int(os.environ.get("DB_PORT", "3306")),
            user="root",
            password=os.environ.get("DB_ROOT_PASS", "123456"),
            database="xiaozhi_esp32_server",
            cursorclass=pymysql.cursors.DictCursor,
        )
        cursor = db.cursor()
        cursor.execute(
            "SELECT COUNT(*) AS cnt FROM device_sd_files WHERE mac_address = %s",
            (mac_address,)
        )
        row = cursor.fetchone()
        cursor.close()
        db.close()
        return row and row["cnt"] > 0
    except Exception:
        return False


def get_music_files(music_dir, music_ext):
    music_dir = Path(music_dir)
    music_files = []
    music_file_names = []
    for file in music_dir.rglob("*"):
        if file.is_file():
            ext = file.suffix.lower()
            if ext in music_ext:
                music_files.append(str(file.relative_to(music_dir)))
                music_file_names.append(
                    os.path.splitext(str(file.relative_to(music_dir)))[0]
                )
    return music_files, music_file_names


def initialize_music_handler(conn: "ConnectionHandler"):
    global MUSIC_CACHE
    if MUSIC_CACHE == {}:
        plugins_config = conn.config.get("plugins", {})
        if "play_music" in plugins_config:
            MUSIC_CACHE["music_config"] = plugins_config["play_music"]
            MUSIC_CACHE["music_dir"] = os.path.abspath(
                MUSIC_CACHE["music_config"].get("music_dir", "./music")
            )
            MUSIC_CACHE["music_ext"] = MUSIC_CACHE["music_config"].get(
                "music_ext", (".mp3", ".wav", ".p3")
            )
            MUSIC_CACHE["refresh_time"] = MUSIC_CACHE["music_config"].get(
                "refresh_time", 60
            )
        else:
            MUSIC_CACHE["music_dir"] = os.path.abspath("./music")
            MUSIC_CACHE["music_ext"] = (".mp3", ".wav", ".p3")
            MUSIC_CACHE["refresh_time"] = 60
        MUSIC_CACHE["music_files"], MUSIC_CACHE["music_file_names"] = get_music_files(
            MUSIC_CACHE["music_dir"], MUSIC_CACHE["music_ext"]
        )
        MUSIC_CACHE["scan_time"] = time.time()
    return MUSIC_CACHE




async def _play_sd_via_mcp(conn: "ConnectionHandler", query: str, folder: str = ""):
    """Use MCP tools/call to search and play music on device SD card.

    New firmware: self.play_sd_music(query="baby shark") searches by keyword.
    Returns the MCP result string or None on error.
    """
    try:
        if not hasattr(conn, "mcp_client") or not conn.mcp_client:
            conn.logger.bind(tag=TAG).warning("MCP client not available")
            return None

        if not await conn.mcp_client.is_ready():
            conn.logger.bind(tag=TAG).warning("MCP client not ready")
            return None

        from core.providers.tools.device_mcp.mcp_handler import call_mcp_tool
        args = {"query": query}
        if folder:
            args["folder"] = folder

        conn.logger.bind(tag=TAG).info(f"MCP play_sd_music: query={query}, folder={folder}")
        result = await call_mcp_tool(
            conn, conn.mcp_client, "self_play_sd_music", json.dumps(args), timeout=10
        )
        conn.logger.bind(tag=TAG).info(f"MCP play_sd_music result: {str(result)[:200]}")
        return result
    except Exception as e:
        conn.logger.bind(tag=TAG).error(f"MCP play_sd_music error: {e}")
        return None


async def handle_music_command(conn: "ConnectionHandler", text):
    initialize_music_handler(conn)
    global MUSIC_CACHE

    clean_text = re.sub(r"[^\w\s]", "", text).strip()
    conn.logger.bind(tag=TAG).debug(f"Checking music command: {clean_text}")

    potential_song = _extract_song_name(clean_text)

    # Try SD card via MCP (new 1-call design: search by keyword on device)
    mac = getattr(conn, "headers", {}).get("device-id", "") if hasattr(conn, "headers") else ""
    if not mac:
        mac = getattr(conn, "device_id", "") or ""

    if mac and _has_sd_music(mac):
        query = potential_song or "random"
        result = await _play_sd_via_mcp(conn, query)
        if result:
            text_prompt = f"Playing music from SD card"
            if potential_song:
                text_prompt = _get_random_play_prompt(potential_song)
            await send_stt_message(conn, text_prompt)
            conn.dialogue.put(Message(role="assistant", content=text_prompt))
            return True

    # Fallback to server-side music streaming
    if os.path.exists(MUSIC_CACHE["music_dir"]):
        if time.time() - MUSIC_CACHE["scan_time"] > MUSIC_CACHE["refresh_time"]:
            MUSIC_CACHE["music_files"], MUSIC_CACHE["music_file_names"] = (
                get_music_files(MUSIC_CACHE["music_dir"], MUSIC_CACHE["music_ext"])
            )
            MUSIC_CACHE["scan_time"] = time.time()

        if potential_song:
            best_match = _find_best_match(potential_song, MUSIC_CACHE["music_files"])
            if best_match:
                conn.logger.bind(tag=TAG).info(f"Found best match: {best_match}")
                await play_local_music(conn, specific_file=best_match)
                return True
    await play_local_music(conn)
    return True


def _get_random_play_prompt(song_name):
    clean_name = os.path.splitext(song_name)[0]
    prompts = [
        f"Now playing {clean_name}",
        f"Here is {clean_name} for you",
        f"Let's listen to {clean_name}",
        f"Playing {clean_name} now",
        f"Enjoy this song, {clean_name}",
    ]
    return random.choice(prompts)


async def play_local_music(conn: "ConnectionHandler", specific_file=None):
    global MUSIC_CACHE
    try:
        if not os.path.exists(MUSIC_CACHE["music_dir"]):
            conn.logger.bind(tag=TAG).error(
                f"Music directory not found: " + MUSIC_CACHE["music_dir"]
            )
            return

        if specific_file:
            selected_music = specific_file
            music_path = os.path.join(MUSIC_CACHE["music_dir"], specific_file)
        else:
            if not MUSIC_CACHE["music_files"]:
                conn.logger.bind(tag=TAG).error("No music files found")
                return
            selected_music = random.choice(MUSIC_CACHE["music_files"])
            music_path = os.path.join(MUSIC_CACHE["music_dir"], selected_music)

        if not os.path.exists(music_path):
            conn.logger.bind(tag=TAG).error(f"Music file not found: {music_path}")
            return
        text = _get_random_play_prompt(selected_music)
        await send_stt_message(conn, text)
        conn.dialogue.put(Message(role="assistant", content=text))

        if conn.intent_type == "intent_llm":
            conn.tts.tts_text_queue.put(
                TTSMessageDTO(
                    sentence_id=conn.sentence_id,
                    sentence_type=SentenceType.FIRST,
                    content_type=ContentType.ACTION,
                )
            )
        conn.tts.tts_text_queue.put(
            TTSMessageDTO(
                sentence_id=conn.sentence_id,
                sentence_type=SentenceType.MIDDLE,
                content_type=ContentType.TEXT,
                content_detail=text,
            )
        )
        conn.tts.tts_text_queue.put(
            TTSMessageDTO(
                sentence_id=conn.sentence_id,
                sentence_type=SentenceType.MIDDLE,
                content_type=ContentType.FILE,
                content_file=music_path,
            )
        )
        if conn.intent_type == "intent_llm":
            conn.tts.tts_text_queue.put(
                TTSMessageDTO(
                    sentence_id=conn.sentence_id,
                    sentence_type=SentenceType.LAST,
                    content_type=ContentType.ACTION,
                )
            )

    except Exception as e:
        conn.logger.bind(tag=TAG).error(f"Music playback failed: {str(e)}")
        conn.logger.bind(tag=TAG).error(f"Detail: {traceback.format_exc()}")
