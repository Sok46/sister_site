#!/usr/bin/env python3
"""
Telegram-бот для получения уведомлений о записях на йогу.
Уведомления приходят автоматически с сайта при каждой новой записи.
Слоты добавляются вручную в файл content/bookings/available-slots.json
"""
import json
import os
import re
import hmac
import hashlib
import secrets
import sqlite3
import subprocess
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Dict, Literal, Optional

# Загрузка .env из корня проекта
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import telebot
from telebot import types

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("Задайте переменную окружения TELEGRAM_BOT_TOKEN")

bot = telebot.TeleBot(BOT_TOKEN)
def _parse_admin_chat_ids() -> set[str]:
    many_raw = (os.environ.get("TELEGRAM_ADMIN_CHAT_IDS") or "").strip()
    single_raw = (os.environ.get("TELEGRAM_ADMIN_CHAT_ID") or "").strip()
    values: set[str] = set()

    for chunk in [many_raw, single_raw]:
        if not chunk:
            continue
        for item in chunk.split(","):
            normalized = item.strip()
            if normalized:
                values.add(normalized)

    return values


ADMIN_CHAT_IDS = _parse_admin_chat_ids()

BASE_DIR = Path(__file__).resolve().parent.parent
SLOTS_FILE = BASE_DIR / "content" / "bookings" / "available-slots.json"
BOOKINGS_FILE = BASE_DIR / "content" / "bookings" / "bookings.json"
POSTS_DIR = BASE_DIR / "content" / "posts"
PAGE_SIZE_POSTS = 5
PUBLIC_DIR = BASE_DIR / "public"
PACKAGES_FILE = BASE_DIR / "content" / "yoga" / "packages.json"
VIDEOS_DIR = BASE_DIR / "public" / "videos"
PAGE_SIZE_PKGS = 5
ADMIN_TOKEN_DB_PATH = Path(
    (os.environ.get("ADMIN_TOKEN_DB_PATH") or str(BASE_DIR / "data" / "admin-auth.sqlite")).strip()
)
ADMIN_TOKEN_HASH_SECRET = (os.environ.get("ADMIN_TOKEN_HASH_SECRET") or "").strip()
ADMIN_TOKEN_TTL_SECONDS = 4 * 60 * 60

# Простое состояние диалога по chat_id:
#   None                 — обычный режим
#   "add_slot"           — ждём дату и время слота для добавления
#   "del_slot"           — ждём дату и время слота для удаления
#   "add_post"           — ждём текст нового поста для блога
#   "add_post_preview"   — ждём фото‑превью для только что созданного поста
#   "edit_post"          — ждём новый текст markdown для выбранного поста
#   "upload_file"        — ждём файл для загрузки в выбранную папку public
#   "rename_file"        — ждём новый текст имени файла для переименования
StateType = Optional[
    Literal[
        "add_slot",
        "del_slot",
        "add_post",
        "add_post_preview",
        "edit_post",
        "upload_file",
        "rename_file",
        # Yoga packages
        "add_pkg_name",
        "add_pkg_level",
        "add_pkg_desc",
        "add_pkg_price",
        "add_video_title",
        "add_video_duration",
        "add_video_position",
        "add_video_file",
        # Edit yoga packages / videos
        "edit_pkg_name",
        "edit_pkg_desc",
        "edit_pkg_price",
        "edit_vid_title",
        "add_pkg_preview",
        "edit_pkg_preview",
        "edit_pkg_position",
    ]
]
chat_state: Dict[int, StateType] = {}

# Для добавления/редактирования постов и файлов: временно храним имя файла/папки на пользователя
chat_post_files: Dict[int, str] = {}            # для нового поста (add_post_preview)
chat_edit_post_files: Dict[int, str] = {}       # для редактирования существующего поста
chat_upload_dirs: Dict[int, str] = {}           # для загрузки файлов в public/<dir>
chat_rename_targets: Dict[int, tuple[str, str]] = {}  # (dir_name, filename) для переименования

# Yoga packages
chat_pkg_draft: Dict[int, dict] = {}       # черновик нового пакета {name, level, description}
chat_pkg_target: Dict[int, str] = {}       # ID пакета для действий (добавление/удаление видео)
chat_video_draft: Dict[int, dict] = {}     # черновик нового видео {title, duration, position}
chat_edit_vid_idx: Dict[int, int] = {}     # индекс видео для редактирования


def is_admin_chat(chat_id: int) -> bool:
    if not ADMIN_CHAT_IDS:
        return False
    return str(chat_id) in ADMIN_CHAT_IDS


def ensure_admin(chat_id: int) -> bool:
    if is_admin_chat(chat_id):
        return True
    bot.send_message(chat_id, "⛔ Эта команда доступна только администратору.")
    return False


def _open_admin_token_db() -> sqlite3.Connection:
    ADMIN_TOKEN_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(ADMIN_TOKEN_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS admin_auth_token (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            token_hash TEXT NOT NULL,
            issued_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            created_by TEXT
        );
        """
    )
    conn.commit()
    return conn


def _hash_admin_token(raw_token: str) -> str:
    return hmac.new(
        ADMIN_TOKEN_HASH_SECRET.encode("utf-8"),
        raw_token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def issue_admin_token(chat_id: int) -> tuple[str, int]:
    if not ADMIN_TOKEN_HASH_SECRET:
        raise RuntimeError("Не задан ADMIN_TOKEN_HASH_SECRET в .env")

    raw_token = secrets.token_urlsafe(32)
    issued_at = int(datetime.now().timestamp())
    expires_at = issued_at + ADMIN_TOKEN_TTL_SECONDS
    token_hash = _hash_admin_token(raw_token)

    conn = _open_admin_token_db()
    try:
        conn.execute(
            """
            INSERT INTO admin_auth_token (id, token_hash, issued_at, expires_at, created_by)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                token_hash = excluded.token_hash,
                issued_at = excluded.issued_at,
                expires_at = excluded.expires_at,
                created_by = excluded.created_by
            """,
            (token_hash, issued_at, expires_at, str(chat_id)),
        )
        conn.commit()
    finally:
        conn.close()

    return raw_token, expires_at


def _trim_output(text: str, max_chars: int = 3000) -> str:
    text = (text or "").strip()
    if not text:
        return "нет вывода"
    if len(text) <= max_chars:
        return text
    return "...\n" + text[-max_chars:]


def _run_cmd(args: list[str], timeout: int = 120) -> tuple[int, str]:
    completed = subprocess.run(
        args,
        cwd=BASE_DIR,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    output = _trim_output((completed.stdout or "") + "\n" + (completed.stderr or ""))
    return completed.returncode, output


def sync_bot_content_to_github(chat_id: int) -> tuple[bool, str]:
    tracked_paths = [
        "content/posts",
        "public/photos",
        "public/audio",
        "public/videos",
        "content/playlist",
    ]

    status_code, status_output = _run_cmd(
        ["git", "status", "--porcelain", "--", *tracked_paths],
        timeout=60,
    )
    if status_code != 0:
        return False, f"Не удалось проверить git status.\n{status_output}"

    if not status_output.strip() or status_output.strip() == "нет вывода":
        return True, "Изменений контента для GitHub не найдено."

    add_code, add_output = _run_cmd(["git", "add", "--", *tracked_paths], timeout=120)
    if add_code != 0:
        return False, f"Ошибка git add.\n{add_output}"

    commit_message = f"chore(content): sync bot updates {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    commit_code, commit_output = _run_cmd(["git", "commit", "-m", commit_message], timeout=120)
    if commit_code != 0:
        if "nothing to commit" in commit_output.lower() or "нет изменений" in commit_output.lower():
            return True, "После git add не осталось изменений для коммита."
        return False, f"Ошибка git commit.\n{commit_output}"

    push_code, push_output = _run_cmd(["git", "push", "origin", "main"], timeout=180)
    if push_code != 0:
        return False, f"Ошибка git push.\n{push_output}"

    return True, f"Изменения контента отправлены в GitHub.\n{push_output}"


def run_site_rebuild(chat_id: int) -> None:
    try:
        bot.send_message(
            chat_id,
            "🚀 Запускаю деплой:\n1) sync контента в GitHub\n2) npm run build\n3) pm2 restart sister-site",
        )

        sync_ok, sync_message = sync_bot_content_to_github(chat_id)
        if not sync_ok:
            bot.send_message(
                chat_id,
                "❌ Деплой остановлен: не удалось отправить контент в GitHub.\n\n"
                f"{sync_message}",
            )
            return
        bot.send_message(chat_id, f"✅ GitHub: {sync_message}")

        build_code, build_output = _run_cmd(["npm", "run", "build"], timeout=1800)
        if build_code != 0:
            bot.send_message(
                chat_id,
                "❌ Сборка завершилась с ошибкой.\n\n"
                f"Код выхода: {build_code}\n\n"
                f"Логи:\n{build_output}",
            )
            return

        restart_code, restart_output = _run_cmd(["pm2", "restart", "sister-site"], timeout=120)
        if restart_code != 0:
            bot.send_message(
                chat_id,
                "⚠️ Сборка прошла успешно, но перезапуск PM2 завершился с ошибкой.\n\n"
                f"Код выхода: {restart_code}\n\n"
                f"Логи PM2:\n{restart_output}",
            )
            return

        bot.send_message(
            chat_id,
            "✅ Пересборка и перезапуск выполнены успешно.\n\n"
            f"Короткий лог сборки:\n{build_output}\n\n"
            f"Лог PM2:\n{restart_output}",
        )
    except subprocess.TimeoutExpired:
        bot.send_message(chat_id, "⏱️ Команда выполнялась слишком долго и была остановлена по таймауту.")
    except Exception as e:
        bot.send_message(chat_id, f"❌ Ошибка запуска пересборки: {e}")


def read_slots():
    if not SLOTS_FILE.exists():
        return {}
    with open(SLOTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def write_slots(data: Dict[str, list]) -> None:
    SLOTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SLOTS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def read_bookings():
    if not BOOKINGS_FILE.exists():
        return []
    with open(BOOKINGS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def format_date_ru(date_str):
    months = {
        "01": "января", "02": "февраля", "03": "марта", "04": "апреля",
        "05": "мая", "06": "июня", "07": "июля", "08": "августа",
        "09": "сентября", "10": "октября", "11": "ноября", "12": "декабря",
    }
    try:
        y, m, d = date_str.split("-")
        return f"{int(d)} {months.get(m, m)} {y}"
    except Exception:
        return date_str


def read_packages() -> list:
    if not PACKAGES_FILE.exists():
        return []
    with open(PACKAGES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def write_packages(packages: list) -> None:
    PACKAGES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PACKAGES_FILE, "w", encoding="utf-8") as f:
        json.dump(packages, f, ensure_ascii=False, indent=2)


def make_main_keyboard() -> types.ReplyKeyboardMarkup:
    """
    Главное меню: два крупных раздела.
    """
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.row(
        types.KeyboardButton("Управление расписанием"),
    )
    kb.row(
        types.KeyboardButton("Управление блогом"),
    )
    kb.row(
        types.KeyboardButton("Управление уроками"),
    )
    kb.row(
        types.KeyboardButton("Системные функции"),
    )
    return kb


def make_system_keyboard() -> types.ReplyKeyboardMarkup:
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.row(types.KeyboardButton("Деплой"))
    kb.row(types.KeyboardButton("Получить токен"))
    kb.row(types.KeyboardButton("⬅️ В главное меню"))
    return kb


def make_schedule_keyboard() -> types.ReplyKeyboardMarkup:
    """
    Меню управления расписанием.
    """
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.row(types.KeyboardButton("Показать слоты"))
    kb.row(
        types.KeyboardButton("Добавить слот"),
        types.KeyboardButton("Удалить слот"),
    )
    kb.row(types.KeyboardButton("Отменить запись"))
    kb.row(types.KeyboardButton("⬅️ В главное меню"))
    return kb


def make_yoga_keyboard() -> types.ReplyKeyboardMarkup:
    """
    Меню управления пакетами видеоуроков.
    """
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.row(types.KeyboardButton("Показать пакеты"))
    kb.row(
        types.KeyboardButton("Добавить пакет"),
        types.KeyboardButton("Удалить пакет"),
    )
    kb.row(types.KeyboardButton("Редактировать пакет"))
    kb.row(
        types.KeyboardButton("Добавить видео в пакет"),
        types.KeyboardButton("Удалить видео из пакета"),
    )
    kb.row(types.KeyboardButton("⬅️ В главное меню"))
    return kb


def make_blog_keyboard() -> types.ReplyKeyboardMarkup:
    """
    Меню управления блогом (пока заглушки).
    """
    kb = types.ReplyKeyboardMarkup(resize_keyboard=True)
    kb.row(types.KeyboardButton("Добавить пост"))
    kb.row(types.KeyboardButton("Удалить пост"))
    kb.row(types.KeyboardButton("Редактировать пост"))
    kb.row(types.KeyboardButton("Управление файлами"))
    kb.row(types.KeyboardButton("⬅️ В главное меню"))
    return kb


def create_blog_post_file(markdown_text: str) -> str:
    """
    Создаёт новый markdown‑файл поста в content/posts.
    Ожидается, что текст уже в нужном формате (как пример return-to-yoga-after-illness.md).
    Имя файла генерируется автоматически, например: post-20260203-153045.md
    Возвращает имя файла (без пути).
    """
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    slug = f"post-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    filename = f"{slug}.md"
    target = POSTS_DIR / filename
    target.write_text(markdown_text, encoding="utf-8")
    return filename


def add_preview_to_post(filename: str, image_path: str) -> None:
    """
    Добавляет previewImage в шапку markdown‑файла, если его там ещё нет.
    image_path — путь вида "/photos/имяфайла.jpg".
    """
    target = POSTS_DIR / filename
    if not target.exists():
        return
    text = target.read_text(encoding="utf-8")
    lines = text.splitlines()

    # Ищем границы frontmatter '---'
    if not lines or lines[0].strip() != "---":
        # Нет шапки — просто добавим её в начало
        frontmatter = ["---", f'previewImage: "{image_path}"', "---", ""]
        new_text = "\n".join(frontmatter + lines)
        target.write_text(new_text, encoding="utf-8")
        return

    # Уже есть frontmatter — проверим, нет ли previewImage
    end_idx = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx is None:
        # Неполная шапка — не трогаем
        return

    header_lines = lines[1:end_idx]
    if any(l.strip().startswith("previewImage:") for l in header_lines):
        # previewImage уже есть
        return

    new_header = ['previewImage: "' + image_path + '"'] + header_lines
    new_lines = ["---"] + new_header + ["---"] + lines[end_idx + 1 :]
    target.write_text("\n".join(new_lines), encoding="utf-8")


def list_blog_posts():
    """
    Возвращает список постов блога в виде [(slug, title), ...],
    где slug = имя файла без .md, title — из фронтматтера (если есть) или slug.
    """
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    posts = []
    for path in POSTS_DIR.glob("*.md"):
        slug = path.stem
        title = slug
        post_date_str = None
        try:
            text = path.read_text(encoding="utf-8")
            lines = text.splitlines()
            if lines and lines[0].strip() == "---":
                # Ищем поля между первой и второй '---'
                for line in lines[1:]:
                    s = line.strip()
                    if s == "---":
                        break
                    if s.startswith("title:"):
                        raw = line.split(":", 1)[1].strip()
                        if raw.startswith('"') and raw.endswith('"'):
                            raw = raw[1:-1]
                        title = raw or slug
                    if s.startswith("date:"):
                        raw = line.split(":", 1)[1].strip()
                        if raw.startswith('"') and raw.endswith('"'):
                            raw = raw[1:-1]
                        post_date_str = raw or None
        except Exception:
            pass
        posts.append((slug, title, post_date_str))

    def sort_key(item):
        slug, _title, d = item
        # Пытаемся сортировать по дате, самые новые сначала
        try:
            if d:
                dt = datetime.fromisoformat(d)
            else:
                dt = datetime.min
        except Exception:
            dt = datetime.min
        # Сортируем по дате (новые сверху), при равенстве — по имени файла
        return (-dt.timestamp(), slug)

    posts.sort(key=sort_key)
    # Возвращаем только (slug, title)
    return [(slug, title) for slug, title, _d in posts]


def send_posts_page(chat_id: int, page: int):
    posts = list_blog_posts()
    if not posts:
        bot.send_message(
            chat_id,
            "Постов в блоге пока нет.",
            reply_markup=make_blog_keyboard(),
        )
        return

    total = len(posts)
    max_page = (total - 1) // PAGE_SIZE_POSTS
    if page < 0:
        page = 0
    if page > max_page:
        page = max_page

    start = page * PAGE_SIZE_POSTS
    end = min(start + PAGE_SIZE_POSTS, total)

    kb = types.InlineKeyboardMarkup()
    for slug, title in posts[start:end]:
        label = title
        if len(label) > 40:
            label = label[:37] + "..."
        kb.add(
            types.InlineKeyboardButton(
                text=label,
                callback_data=f"delpost:{slug}:{page}",
            )
        )

    nav_row = []
    if page > 0:
        nav_row.append(
            types.InlineKeyboardButton(
                text="⬅️ Предыдущие",
                callback_data=f"delpostpage:{page-1}",
            )
        )
    if end < total:
        nav_row.append(
            types.InlineKeyboardButton(
                text="Следующие посты ➡️",
                callback_data=f"delpostpage:{page+1}",
            )
        )
    if nav_row:
        kb.row(*nav_row)

    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="cancel_delpost",
        )
    )

    bot.send_message(
        chat_id,
        "Выберите пост для удаления:",
        reply_markup=kb,
    )


def send_edit_posts_page(chat_id: int, page: int):
    posts = list_blog_posts()
    if not posts:
        bot.send_message(
            chat_id,
            "Постов в блоге пока нет.",
            reply_markup=make_blog_keyboard(),
        )
        return

    total = len(posts)
    max_page = (total - 1) // PAGE_SIZE_POSTS
    if page < 0:
        page = 0
    if page > max_page:
        page = max_page

    start = page * PAGE_SIZE_POSTS
    end = min(start + PAGE_SIZE_POSTS, total)

    kb = types.InlineKeyboardMarkup()
    for slug, title in posts[start:end]:
        label = title
        if len(label) > 40:
            label = label[:37] + "..."
        kb.add(
            types.InlineKeyboardButton(
                text=label,
                callback_data=f"editpost:{slug}:{page}",
            )
        )

    nav_row = []
    if page > 0:
        nav_row.append(
            types.InlineKeyboardButton(
                text="⬅️ Предыдущие",
                callback_data=f"editpostpage:{page-1}",
            )
        )
    if end < total:
        nav_row.append(
            types.InlineKeyboardButton(
                text="Следующие посты ➡️",
                callback_data=f"editpostpage:{page+1}",
            )
        )
    if nav_row:
        kb.row(*nav_row)

    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="cancel_editpost",
        )
    )

    bot.send_message(
        chat_id,
        "Выберите пост для редактирования:",
        reply_markup=kb,
    )


def list_media_dirs():
    """
    Возвращает список папок из public, в которых есть медиафайлы (фото/видео/аудио).
    """
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    media_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".avi", ".mp3", ".wav"}
    dirs = []
    for entry in PUBLIC_DIR.iterdir():
        if entry.is_dir():
            has_media = any(
                child.is_file() and child.suffix.lower() in media_exts
                for child in entry.iterdir()
            )
            if has_media:
                dirs.append(entry.name)
    dirs.sort()
    return dirs


def list_media_files(dir_name: str):
    """
    Возвращает список файлов в public/<dir_name> с медиа‑расширениями.
    """
    media_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".avi", ".mp3", ".wav"}
    target = PUBLIC_DIR / dir_name
    if not target.exists() or not target.is_dir():
        return []
    files = [
        p.name
        for p in target.iterdir()
        if p.is_file() and p.suffix.lower() in media_exts
    ]
    files.sort()
    return files


def send_media_dirs(chat_id: int):
    dirs = list_media_dirs()
    if not dirs:
        bot.send_message(
            chat_id,
            "В папке `public` нет папок с фото или видео.",
            parse_mode="Markdown",
            reply_markup=make_blog_keyboard(),
        )
        return

    kb = types.InlineKeyboardMarkup()
    for d in dirs:
        kb.add(
            types.InlineKeyboardButton(
                text=d,
                callback_data=f"mf_dir:{d}",
            )
        )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="mf_cancel",
        )
    )

    bot.send_message(
        chat_id,
        "Выберите папку с файлами (из `public`):",
        parse_mode="Markdown",
        reply_markup=kb,
    )


def send_media_files(chat_id: int, dir_name: str, page: int = 0):
    files = list_media_files(dir_name)
    if not files:
        bot.send_message(
            chat_id,
            f"В папке `{dir_name}` нет файлов.",
            parse_mode="Markdown",
            reply_markup=make_blog_keyboard(),
        )
        return

    PAGE_SIZE_FILES = 10
    total = len(files)
    max_page = (total - 1) // PAGE_SIZE_FILES
    if page < 0:
        page = 0
    if page > max_page:
        page = max_page

    start = page * PAGE_SIZE_FILES
    end = min(start + PAGE_SIZE_FILES, total)

    kb = types.InlineKeyboardMarkup()
    for name in files[start:end]:
        label = name
        if len(label) > 40:
            label = label[:37] + "..."
        kb.add(
            types.InlineKeyboardButton(
                text=label,
                callback_data=f"mf_file:{dir_name}|{name}|{page}",
            )
        )

    nav_row = []
    if page > 0:
        nav_row.append(
            types.InlineKeyboardButton(
                text="⬅️ Предыдущие",
                callback_data=f"mf_page:{dir_name}|{page-1}",
            )
        )
    if end < total:
        nav_row.append(
            types.InlineKeyboardButton(
                text="Следующие файлы ➡️",
                callback_data=f"mf_page:{dir_name}|{page+1}",
            )
        )
    if nav_row:
        kb.row(*nav_row)

    kb.row(
        types.InlineKeyboardButton(
            text="⬆️ Загрузить файл",
            callback_data=f"mf_upload:{dir_name}",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="⬅️ К папкам",
            callback_data="mf_back_dirs",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="mf_cancel",
        )
    )

    bot.send_message(
        chat_id,
        f"Файлы в папке `{dir_name}`:",
        parse_mode="Markdown",
        reply_markup=kb,
    )


@bot.message_handler(commands=["start"])
def cmd_start(message):
    text = (
        "🧘 Этот бот получает уведомления о новых записях на йогу.\n\n"
        "Главные разделы:\n"
        "• «Управление расписанием» — слоты, записи, отмены\n"
        "• «Управление блогом» — работа с постами\n"
        "• «Управление уроками» — пакеты видеоуроков йоги\n"
        "• «Системные функции» — деплой и выдача админ-токена\n\n"
        "Технически слоты хранятся в available-slots.json, записи — в bookings.json,\n"
        "пакеты уроков — в content/yoga/packages.json."
    )
    bot.send_message(message.chat.id, text, reply_markup=make_main_keyboard())


@bot.message_handler(commands=["slots"])
def cmd_slots(message):
    parts = message.text.split()
    slots = read_slots()
    if not slots:
        bot.reply_to(message, "Слотов пока нет.")
        return

    if len(parts) >= 2:
        date = parts[1]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            bot.reply_to(message, "Формат даты: ГГГГ-ММ-ДД (например 2025-02-10)")
            return
        if date not in slots:
            bot.reply_to(message, f"На {format_date_ru(date)} слотов нет.")
            return
        times = slots[date]
        bookings = read_bookings()
        booked = {b["time"] for b in bookings if b["date"] == date}
        free = [t for t in times if t not in booked]
        taken = [t for t in times if t in booked]
        lines = [f"📅 {format_date_ru(date)}"]
        if free:
            lines.append("Свободно: " + ", ".join(free))
        if taken:
            lines.append("Занято: " + ", ".join(taken))
        bot.reply_to(message, "\n".join(lines))
    else:
        lines = ["📋 Слоты по датам:\n"]
        for d in sorted(slots.keys()):
            times = slots[d]
            bookings = read_bookings()
            booked = {b["time"] for b in bookings if b["date"] == d}
            free = [t for t in times if t not in booked]
            status = "свободно: " + ", ".join(free) if free else "все заняты"
            lines.append(f"• {format_date_ru(d)} — {status}")
        bot.reply_to(message, "\n".join(lines))


@bot.message_handler(commands=["deploy", "rebuild"])
def cmd_deploy(message):
    chat_id = message.chat.id
    if not ensure_admin(chat_id):
        return
    threading.Thread(target=run_site_rebuild, args=(chat_id,), daemon=True).start()


@bot.message_handler(func=lambda m: m.text in ["Деплой", "Получить токен"])
def handle_system_actions(message):
    chat_id = message.chat.id
    text = (message.text or "").strip()
    if not ensure_admin(chat_id):
        return

    if text == "Деплой":
        threading.Thread(target=run_site_rebuild, args=(chat_id,), daemon=True).start()
        return

    if text == "Получить токен":
        try:
            raw_token, expires_at = issue_admin_token(chat_id)
            expires_at_human = datetime.fromtimestamp(expires_at).strftime("%d.%m.%Y %H:%M:%S")
            bot.send_message(
                chat_id,
                "🔐 Выдан новый токен администратора.\n\n"
                f"`{raw_token}`\n\n"
                "Срок действия: 4 часа.\n"
                f"Истекает: {expires_at_human}\n\n"
                "⚠️ Важно: действует только последний выданный токен.",
                parse_mode="Markdown",
                reply_markup=make_system_keyboard(),
            )
        except Exception as e:
            bot.send_message(
                chat_id,
                f"❌ Не удалось выдать токен: {e}",
                reply_markup=make_system_keyboard(),
            )


def parse_date_time(text: str):
    """
    Поддерживаем более удобные форматы для ввода с телефона:

    1) ДД.ММ ЧЧ:ММ        -> текущий год
    2) ДД.ММ.ГГГГ ЧЧ:ММ   -> указанный год
    3) ГГГГ-ММ-ДД ЧЧ:ММ   -> старый формат (ISO), тоже остаётся
    """
    text = text.strip()

    # 3) Старый формат: 2026-02-10 10:00
    m = re.match(r"^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$", text)
    if m:
        return m.group(1), m.group(2)

    # 2) ДД.ММ.ГГГГ 10.02.2026 10:00
    m = re.match(r"^(\d{2})[.\-](\d{2})[.\-](\d{4})\s+(\d{2}:\d{2})$", text)
    if m:
        d, mth, y, t = m.groups()
        date_str = f"{y}-{mth}-{d}"
        return date_str, t

    # 1) ДД.ММ 10.02 10:00 -> текущий год
    m = re.match(r"^(\d{2})[.\-](\d{2})\s+(\d{2}:\d{2})$", text)
    if m:
        d, mth, t = m.groups()
        y = date.today().year
        date_str = f"{y:04d}-{mth}-{d}"
        return date_str, t

    return None, None


def parse_date_range(text: str):
    """
    Ожидаем формат с датой и двумя временами:

    1) ДД.ММ ЧЧ:ММ ЧЧ:ММ          -> текущий год
    2) ДД.ММ.ГГГГ ЧЧ:ММ ЧЧ:ММ     -> указанный год
    3) ГГГГ-ММ-ДД ЧЧ:ММ ЧЧ:ММ     -> ISO-формат
    """
    parts = text.strip().split()
    if len(parts) < 3:
        return None, None, None

    date_part, start_part, end_part = parts[0], parts[1], parts[2]

    start_date, start_time = parse_date_time(f"{date_part} {start_part}")
    end_date, end_time = parse_date_time(f"{date_part} {end_part}")

    if not start_date or not start_time or not end_date or not end_time:
        return None, None, None

    # на всякий случай, если форматы даты различились, берём дату старта
    return start_date, start_time, end_time


def handle_add_slot(chat_id: int, text: str):
    date_str, time_start, time_end = parse_date_range(text)
    if not date_str or not time_start or not time_end:
        bot.send_message(
            chat_id,
            "Формат для добавления слота (дата + начало и конец):\n"
            "`ДД.ММ ЧЧ:ММ ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ ЧЧ:ММ`\n\n"
            "Например: `10.02 10:00 11:00` или `10.02.2026 10:00 11:00`",
            parse_mode="Markdown",
        )
        return

    slots = read_slots()
    day_slots = slots.get(date_str, [])

    if time_start in day_slots:
        bot.send_message(chat_id, f"Слот {format_date_ru(date_str)} в {time_start} уже есть в списке.")
        return

    # Пока храним только время начала слота — сайт показывает именно его.
    day_slots.append(time_start)
    day_slots = sorted(set(day_slots))
    slots[date_str] = day_slots
    write_slots(slots)

    bot.send_message(
        chat_id,
        f"✅ Слот добавлен: {format_date_ru(date_str)} с {time_start} до {time_end}\n"
        f"(в расписании сайта используется время начала: {time_start})",
        reply_markup=make_main_keyboard(),
    )
    chat_state[chat_id] = None


def handle_delete_slot(chat_id: int, text: str):
    date_str, time = parse_date_time(text)
    if not date_str or not time:
        bot.send_message(
            chat_id,
            "Формат для удаления слота:\n"
            "`ДД.ММ ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`\n\n"
            "Например: `10.02 10:00` или `10.02.2026 10:00`",
            parse_mode="Markdown",
        )
        return

    delete_slot_and_notify(chat_id, date_str, time)


def delete_slot_and_notify(chat_id: int, date_str: str, time: str):
    slots = read_slots()
    if date_str not in slots or time not in slots[date_str]:
        bot.send_message(chat_id, f"Слота {format_date_ru(date_str)} в {time} не найдено.")
        return

    # Проверяем, есть ли записи на этот слот
    bookings = read_bookings()
    affected = [b for b in bookings if b.get("date") == date_str and b.get("time") == time]

    # Если есть записи, сначала спрашиваем подтверждение, а не удаляем сразу
    if affected:
        lines = [
            f"⚠ На этот слот уже есть записи: {format_date_ru(date_str)} в {time}.",
            "",
            "Клиенты:",
        ]
        for b in affected:
            name = b.get("name") or "Без имени"
            phone = b.get("phone") or "без телефона"
            lines.append(f"• {name}, телефон: {phone}")
        lines.append("")
        lines.append("Вы действительно хотите удалить этот слот?")

        kb = types.InlineKeyboardMarkup()
        kb.add(
            types.InlineKeyboardButton(
                text="✅ Да, удалить слот",
                callback_data=f"confirm_del:{date_str}|{time}",
            )
        )
        kb.add(
            types.InlineKeyboardButton(
                text="Отмена",
                callback_data="cancel_del",
            )
        )

        bot.send_message(chat_id, "\n".join(lines), reply_markup=kb)
        return

    # Удаляем слот
    new_times = [t for t in slots[date_str] if t != time]
    if new_times:
        slots[date_str] = new_times
    else:
        del slots[date_str]
    write_slots(slots)

    if affected:
        lines = [
            f"⚠ Слот удалён: {format_date_ru(date_str)} в {time}.",
            "",
            "На этот слот уже были записи. Необходимо уведомить клиентов:",
        ]
        for b in affected:
            name = b.get("name") or "Без имени"
            phone = b.get("phone") or "без телефона"
            lines.append(f"• {name}, телефон: {phone}")
        bot.send_message(chat_id, "\n".join(lines), reply_markup=make_main_keyboard())
    else:
        bot.send_message(
            chat_id,
            f"🗑 Слот удалён: {format_date_ru(date_str)} в {time}",
            reply_markup=make_main_keyboard(),
        )

    chat_state[chat_id] = None


@bot.message_handler(func=lambda m: m.text in ["Показать слоты", "Добавить слот", "Удалить слот", "Отменить запись"])
def handle_buttons(message):
    chat_id = message.chat.id
    text = (message.text or "").strip()

    if text == "Показать слоты":
        # Показываем все слоты (свободные и занятые, как /slots без даты, но по всем датам)
        slots = read_slots()
        if not slots:
            bot.send_message(chat_id, "Слотов пока нет.", reply_markup=make_main_keyboard())
            chat_state[chat_id] = None
            return
        lines = ["📋 Слоты по датам:\n"]
        bookings = read_bookings()
        for d in sorted(slots.keys()):
            times = slots[d]
            booked = {b["time"] for b in bookings if b.get("date") == d}
            free = [t for t in times if t not in booked]
            taken = [t for t in times if t in booked]

            lines.append(f"📅 {format_date_ru(d)}")
            if free:
                lines.append("Свободно: " + ", ".join(free))
            if taken:
                lines.append("Занято: " + ", ".join(taken))
            lines.append("")  # пустая строка между датами
        bot.send_message(chat_id, "\n".join(lines), reply_markup=make_main_keyboard())
        chat_state[chat_id] = None
        return

    if text == "Добавить слот":
        chat_state[chat_id] = "add_slot"
        bot.send_message(
            chat_id,
            "Отправьте дату и *начало и конец* слота в формате:\n"
            "`ДД.ММ ЧЧ:ММ ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ ЧЧ:ММ`\n\n"
            "Например: `10.02 10:00 11:00` или `10.02.2026 10:00 11:00`.",
            parse_mode="Markdown",
        )
        return

    if text == "Удалить слот":
        # Переходим к выбору даты через inline‑кнопки
        slots = read_slots()
        if not slots:
            bot.send_message(
                chat_id,
                "Слотов пока нет — удалять нечего 🙂",
                reply_markup=make_main_keyboard(),
            )
            return

        today_str = date.today().isoformat()
        available_dates = sorted(
            d for d, times in slots.items() if d >= today_str and times
        )

        if not available_dates:
            bot.send_message(
                chat_id,
                "Нет будущих дат со слотами для удаления.",
                reply_markup=make_main_keyboard(),
            )
            return

        kb = types.InlineKeyboardMarkup()
        for d in available_dates:
            kb.add(
                types.InlineKeyboardButton(
                    text=format_date_ru(d),
                    callback_data=f"del_date:{d}",
                )
            )

        bot.send_message(
            chat_id,
            "Выберите дату, для которой нужно удалить слот:",
            reply_markup=kb,
        )
        chat_state[chat_id] = None
        return


@bot.message_handler(func=lambda m: m.text in ["Управление расписанием", "Управление блогом", "Управление уроками", "Системные функции", "⬅️ В главное меню"])
def handle_main_menus(message):
    chat_id = message.chat.id
    text = (message.text or "").strip()

    if text == "Управление расписанием":
        bot.send_message(
            chat_id,
            "Раздел «Управление расписанием». Выберите действие:",
            reply_markup=make_schedule_keyboard(),
        )
        return

    if text == "Управление блогом":
        chat_state[chat_id] = None
        bot.send_message(
            chat_id,
            "Раздел «Управление блогом».\n\n"
            "Раздел позволяет добавлять, удалять и редактировать посты,\n"
            "а также управлять файлами (фото/видео) в папке `public`.\n\n"
            "• «Добавить пост» — новый markdown‑файл в `content/posts`\n"
            "• «Удалить пост» — удалить выбранный пост\n"
            "• «Редактировать пост» — изменить содержимое файла\n"
            "• «Управление файлами» — посмотреть и скачать файлы из `public`.\n\n"
            "Для добавления поста: нажмите «Добавить пост», затем отправьте текст в формате markdown — "
            "как в примере файла return-to-yoga-after-illness.md (шапка `---` с полями и текст ниже).",
            reply_markup=make_blog_keyboard(),
        )
        return

    if text == "Управление уроками":
        chat_state[chat_id] = None
        bot.send_message(
            chat_id,
            "Раздел «Управление уроками».\n\n"
            "Здесь можно управлять пакетами видеоуроков йоги:\n\n"
            "• «Показать пакеты» — список всех пакетов\n"
            "• «Добавить пакет» — создать новый пакет\n"
            "• «Удалить пакет» — удалить пакет\n"
            "• «Добавить видео в пакет» — добавить видеоурок\n"
            "• «Удалить видео из пакета» — убрать урок из пакета",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if text == "Системные функции":
        if not ensure_admin(chat_id):
            return
        chat_state[chat_id] = None
        bot.send_message(
            chat_id,
            "Раздел «Системные функции». Выберите действие:",
            reply_markup=make_system_keyboard(),
        )
        return

    if text == "⬅️ В главное меню":
        bot.send_message(
            chat_id,
            "Главное меню.",
            reply_markup=make_main_keyboard(),
        )
        return

    if text == "Отменить запись":
        # Выбор даты, на которую есть записи
        bookings = read_bookings()
        if not bookings:
            bot.send_message(
                chat_id,
                "Пока нет ни одной записи — отменять нечего 🙂",
                reply_markup=make_main_keyboard(),
            )
            return

        today_str = date.today().isoformat()
        dates_with_bookings = sorted(
            {b["date"] for b in bookings if b.get("date", "") >= today_str}
        )

        if not dates_with_bookings:
            bot.send_message(
                chat_id,
                "Нет будущих дат с записями для отмены.",
                reply_markup=make_main_keyboard(),
            )
            return

        kb = types.InlineKeyboardMarkup()
        for d in dates_with_bookings:
            kb.add(
                types.InlineKeyboardButton(
                    text=format_date_ru(d),
                    callback_data=f"cancel_date:{d}",
                )
            )

        bot.send_message(
            chat_id,
            "Выберите дату, для которой хотите отменить запись:",
            reply_markup=kb,
        )
        chat_state[chat_id] = None
        return


@bot.message_handler(func=lambda m: m.text == "Добавить пост")
def handle_add_post_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = "add_post"

    help_text = (
        "Отправьте *одним сообщением* полный текст поста в формате markdown.\n\n"
        "После отправки я сохраню его как новый файл в `content/posts/` и спрошу, нужно ли добавить превью‑изображение.\n\n"
        "━━━━━━━━━━━━━━━━━━━━\n"
        "*Справка по полям (YAML в шапке между ---)*\n\n"
        "*Обязательные:*\n"
        "• *title* — заголовок поста (в кавычках)\n"
        "• *date* — дата в формате ГГГГ-ММ-ДД, например 2026-02-03\n"
        "• *category* — категория, например «Йога», «Путешествия»\n"
        "• *excerpt* — короткое описание поста (отображается в списке и в шапке статьи)\n\n"
        "*Необязательные:*\n"
        "• *emoji* — иконка к посту, например 🧘‍♀️ или 🏔\n"
        "• *previewImage* — URL картинки для превью в списке постов и в шапке (обычно заполняется автоматически после публикации, когда вы загружаете превью через бота)\n"
        "• *image* — основное изображение поста (URL)\n"
        "• *video* — ссылка на видео (YouTube, Vimeo, RuTube или прямой URL); показывается в начале поста\n"
        "• *telegram* — ссылка на пост в Telegram для встраивания\n\n"
        "Текст под второй строкой `---` — это тело поста (markdown: заголовки, списки, картинки, ссылки)."
    )

    example_text = (
        "Пример markdown‑поста:\n"
        "```md\n"
        "---\n"
        "title: \"Заголовок поста\"\n"
        "date: \"2026-02-03\"\n"
        "category: \"Йога\"\n"
        "excerpt: \"Короткое описание\"\n"
        "emoji: \"🧘‍♀️\"\n"
        "---\n"
        "\n"
        "Текст поста в формате markdown...\n"
        "\n"
        "![Фото с Яндекс Диска](ПРЯМАЯ_ССЫЛКА_С_КНОПКИ_«СКАЧАТЬ»)\n"
        "\n"
        "![Фото из папки photos](/photos/primer.jpg)\n"
        "```"
    )

    bot.send_message(
        chat_id,
        help_text,
        parse_mode="Markdown",
    )
    bot.send_message(
        chat_id,
        example_text,
        parse_mode="Markdown",
    )


@bot.message_handler(func=lambda m: m.text == "Удалить пост")
def handle_delete_post_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_posts_page(chat_id, page=0)


@bot.message_handler(func=lambda m: m.text == "Редактировать пост")
def handle_edit_post_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_edit_posts_page(chat_id, page=0)


@bot.message_handler(func=lambda m: m.text == "Управление файлами")
def handle_manage_files_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_media_dirs(chat_id)


# ─── УПРАВЛЕНИЕ ПАКЕТАМИ ВИДЕОУРОКОВ ───────────────────────────────


def send_packages_list(chat_id: int, prefix: str, prompt: str, page: int = 0):
    """
    Отправляет пагинированный список пакетов с inline‑кнопками.
    prefix — для callback_data, напр. 'delpkg', 'addvid', 'delvid'.
    """
    packages = read_packages()
    if not packages:
        bot.send_message(
            chat_id,
            "Пакетов пока нет.",
            reply_markup=make_yoga_keyboard(),
        )
        return

    total = len(packages)
    max_page = (total - 1) // PAGE_SIZE_PKGS
    if page < 0:
        page = 0
    if page > max_page:
        page = max_page

    start = page * PAGE_SIZE_PKGS
    end = min(start + PAGE_SIZE_PKGS, total)

    kb = types.InlineKeyboardMarkup()
    for pkg in packages[start:end]:
        name = pkg.get("name", pkg["id"])
        level = pkg.get("level", "")
        vids = len(pkg.get("videos", []))
        label = f"{name} ({level}, {vids} видео)"
        if len(label) > 55:
            label = label[:52] + "..."
        kb.add(
            types.InlineKeyboardButton(
                text=label,
                callback_data=f"{prefix}:{pkg['id']}:{page}",
            )
        )

    nav_row = []
    if page > 0:
        nav_row.append(
            types.InlineKeyboardButton(
                text="⬅️ Предыдущие",
                callback_data=f"{prefix}_page:{page-1}",
            )
        )
    if end < total:
        nav_row.append(
            types.InlineKeyboardButton(
                text="Следующие ➡️",
                callback_data=f"{prefix}_page:{page+1}",
            )
        )
    if nav_row:
        kb.row(*nav_row)

    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data=f"{prefix}_cancel",
        )
    )

    bot.send_message(chat_id, prompt, reply_markup=kb)


@bot.message_handler(func=lambda m: m.text == "Показать пакеты")
def handle_show_packages(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    packages = read_packages()
    if not packages:
        bot.send_message(
            chat_id,
            "Пакетов видеоуроков пока нет.",
            reply_markup=make_yoga_keyboard(),
        )
        return

    lines = ["📦 Пакеты видеоуроков:\n"]
    for pkg in packages:
        name = pkg.get("name", pkg["id"])
        level = pkg.get("level", "—")
        price = pkg.get("price", 0)
        price_str = f"{price} ₽" if price > 0 else "Бесплатно"
        vids = pkg.get("videos", [])
        available = "✅" if pkg.get("available", True) else "❌"
        lines.append(f"{available} *{name}*")
        lines.append(f"   Уровень: {level} | Цена: {price_str} | Видео: {len(vids)}")
        if vids:
            for i, v in enumerate(vids, 1):
                title = v.get("title", "Без названия")
                dur = v.get("duration", "")
                has_url = "🎬" if v.get("videoUrl") else "📝"
                lines.append(f"   {i}. {has_url} {title} ({dur})")
        lines.append("")

    bot.send_message(
        chat_id,
        "\n".join(lines),
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


@bot.message_handler(func=lambda m: m.text == "Добавить пакет")
def handle_add_package_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = "add_pkg_name"
    chat_pkg_draft[chat_id] = {}
    bot.send_message(
        chat_id,
        "Создание нового пакета.\n\n"
        "Шаг 1/4: Введите *название* пакета:",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


@bot.message_handler(func=lambda m: m.text == "Удалить пакет")
def handle_delete_package_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_packages_list(chat_id, "delpkg", "Выберите пакет для удаления:")


@bot.message_handler(func=lambda m: m.text == "Добавить видео в пакет")
def handle_add_video_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_packages_list(chat_id, "addvid", "Выберите пакет, в который нужно добавить видео:")


@bot.message_handler(func=lambda m: m.text == "Редактировать пакет")
def handle_edit_package_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_packages_list(chat_id, "editpkg", "Выберите пакет для редактирования:")


@bot.message_handler(func=lambda m: m.text == "Удалить видео из пакета")
def handle_delete_video_start(message):
    chat_id = message.chat.id
    chat_state[chat_id] = None
    send_packages_list(chat_id, "delvid", "Выберите пакет, из которого нужно удалить видео:")


# ─── Callback‑обработчики пакетов ──────────────────────────────────

# Пагинация списка пакетов (все три префикса)
@bot.callback_query_handler(func=lambda c: c.data and c.data.split("_page:")[0] in ["delpkg", "addvid", "delvid", "editpkg"])
def handle_pkg_list_page(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    prefix, page_str = call.data.split("_page:", 1)
    try:
        page = int(page_str)
    except ValueError:
        bot.answer_callback_query(call.id, "Ошибка страницы.")
        return

    prompts = {
        "delpkg": "Выберите пакет для удаления:",
        "addvid": "Выберите пакет, в который нужно добавить видео:",
        "delvid": "Выберите пакет, из которого нужно удалить видео:",
        "editpkg": "Выберите пакет для редактирования:",
    }
    bot.answer_callback_query(call.id)
    send_packages_list(chat_id, prefix, prompts.get(prefix, "Выберите пакет:"), page)


# Отмена выбора пакета
@bot.callback_query_handler(func=lambda c: c.data and c.data.split("_cancel")[0] in ["delpkg", "addvid", "delvid", "editpkg"])
def handle_pkg_cancel(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    bot.answer_callback_query(call.id, "Отмена.")
    bot.send_message(
        chat_id,
        "Действие отменено.",
        reply_markup=make_yoga_keyboard(),
    )


# ── Удаление пакета ──

@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("delpkg:"))
def handle_delete_package_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        pkg_id, page_str = payload.rsplit(":", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка.")
        return

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    name = pkg.get("name", pkg_id)
    vids = len(pkg.get("videos", []))

    kb = types.InlineKeyboardMarkup()
    kb.row(
        types.InlineKeyboardButton(
            text="✅ Да, удалить пакет",
            callback_data=f"confirm_delpkg:{pkg_id}",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="delpkg_cancel",
        )
    )

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Вы действительно хотите удалить пакет «{name}»?\n"
        f"В нём {vids} видеоурок(ов).",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("confirm_delpkg:"))
def handle_confirm_delete_package(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет уже удалён.")
        bot.send_message(chat_id, "Пакет уже не существует.", reply_markup=make_yoga_keyboard())
        return

    name = pkg.get("name", pkg_id)

    # Удаляем файл превью из notgallery
    deleted_files = []
    image = pkg.get("image", "")
    if image and image.startswith("/notgallery/"):
        img_path = PUBLIC_DIR / image.lstrip("/")
        if img_path.exists():
            try:
                img_path.unlink()
                deleted_files.append(f"превью {img_path.name}")
            except Exception:
                pass

    # Удаляем все видеофайлы из public/videos/
    for v in pkg.get("videos", []):
        video_url = v.get("videoUrl", "")
        if video_url.startswith("/videos/"):
            video_path = PUBLIC_DIR / video_url.lstrip("/")
            if video_path.exists():
                try:
                    video_path.unlink()
                    deleted_files.append(f"видео {video_path.name}")
                except Exception:
                    pass

    packages = [p for p in packages if p["id"] != pkg_id]
    write_packages(packages)

    files_note = ""
    if deleted_files:
        files_note = "\n📁 Удалены файлы: " + ", ".join(deleted_files)

    bot.answer_callback_query(call.id, "Пакет удалён.")
    bot.send_message(
        chat_id,
        f"🗑 Пакет «{name}» удалён.{files_note}",
        reply_markup=make_yoga_keyboard(),
    )


# ── Добавление видео в пакет ──

@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("addvid:"))
def handle_add_video_select_package(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        pkg_id, page_str = payload.rsplit(":", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка.")
        return

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    chat_pkg_target[chat_id] = pkg_id
    chat_video_draft[chat_id] = {}
    chat_state[chat_id] = "add_video_title"

    name = pkg.get("name", pkg_id)
    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Добавление видео в пакет «{name}».\n\n"
        "Шаг 1/3: Введите *название* видеоурока:",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# ── Удаление видео из пакета ──

@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("delvid:"))
def handle_delete_video_select_package(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        pkg_id, page_str = payload.rsplit(":", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка.")
        return

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    videos = pkg.get("videos", [])
    if not videos:
        bot.answer_callback_query(call.id, "В пакете нет видео.")
        bot.send_message(
            chat_id,
            f"В пакете «{pkg.get('name', pkg_id)}» нет видеоуроков.",
            reply_markup=make_yoga_keyboard(),
        )
        return

    kb = types.InlineKeyboardMarkup()
    for i, v in enumerate(videos):
        title = v.get("title", f"Видео {i+1}")
        dur = v.get("duration", "")
        label = f"{title} ({dur})" if dur else title
        if len(label) > 55:
            label = label[:52] + "..."
        kb.add(
            types.InlineKeyboardButton(
                text=label,
                callback_data=f"rmvid:{pkg_id}|{i}",
            )
        )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="delvid_cancel",
        )
    )

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Выберите видео для удаления из пакета «{pkg.get('name', pkg_id)}»:",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("rmvid:"))
def handle_remove_video_confirm(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        pkg_id, idx_str = payload.split("|", 1)
        idx = int(idx_str)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных.")
        return

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    videos = pkg.get("videos", [])
    if idx < 0 or idx >= len(videos):
        bot.answer_callback_query(call.id, "Видео не найдено.")
        return

    video = videos[idx]
    title = video.get("title", f"Видео {idx+1}")

    kb = types.InlineKeyboardMarkup()
    kb.row(
        types.InlineKeyboardButton(
            text="✅ Да, удалить видео",
            callback_data=f"confirm_rmvid:{pkg_id}|{idx}",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="delvid_cancel",
        )
    )

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Удалить видео «{title}» из пакета «{pkg.get('name', pkg_id)}»?",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("confirm_rmvid:"))
def handle_confirm_remove_video(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        pkg_id, idx_str = payload.split("|", 1)
        idx = int(idx_str)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных.")
        return

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        bot.send_message(chat_id, "Пакет уже не существует.", reply_markup=make_yoga_keyboard())
        return

    videos = pkg.get("videos", [])
    if idx < 0 or idx >= len(videos):
        bot.answer_callback_query(call.id, "Видео уже удалено.")
        bot.send_message(chat_id, "Видео уже было удалено.", reply_markup=make_yoga_keyboard())
        return

    removed = videos.pop(idx)
    title = removed.get("title", "Без названия")
    pkg["videos"] = videos
    write_packages(packages)

    # Удаляем файл из public/videos/, если он там есть
    video_url = removed.get("videoUrl", "")
    file_deleted = False
    if video_url.startswith("/videos/"):
        video_path = PUBLIC_DIR / video_url.lstrip("/")
        if video_path.exists():
            try:
                video_path.unlink()
                file_deleted = True
            except Exception:
                pass

    file_note = "\n📁 Файл видео удалён с сервера." if file_deleted else ""
    bot.answer_callback_query(call.id, "Видео удалено.")
    bot.send_message(
        chat_id,
        f"🗑 Видео «{title}» удалено из пакета «{pkg.get('name', pkg_id)}».{file_note}",
        reply_markup=make_yoga_keyboard(),
    )


# ── Выбор уровня при создании пакета (inline) ──

@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("pkg_level:"))
def handle_package_level_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, level = call.data.split(":", 1)

    draft = chat_pkg_draft.get(chat_id)
    if not draft:
        bot.answer_callback_query(call.id, "Ошибка: данные черновика потеряны.")
        return

    draft["level"] = level
    chat_state[chat_id] = "add_pkg_desc"

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Уровень: *{level}*.\n\n"
        "Шаг 3/4: Введите *описание* пакета:",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# ── Редактирование пакета ──

def _send_edit_pkg_menu(chat_id: int, pkg_id: str):
    """
    Показывает меню редактирования пакета: свойства + видеоуроки.
    """
    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
        return

    name = pkg.get("name", pkg_id)
    level = pkg.get("level", "—")
    price = pkg.get("price", 0)
    price_str = f"{price} ₽" if price > 0 else "Бесплатно"
    desc = pkg.get("description", "—")
    if len(desc) > 80:
        desc = desc[:77] + "..."
    videos = pkg.get("videos", [])

    image = pkg.get("image", "")
    image_str = f"`{image}`" if image else "нет"

    # Текущая позиция пакета в списке
    pkg_idx = next((i for i, p in enumerate(packages) if p["id"] == pkg_id), 0)
    total_pkgs = len(packages)

    lines = [
        f"✏️ Редактирование пакета «{name}»\n",
        f"📊 Уровень: {level}",
        f"💰 Цена: {price_str}",
        f"📝 {desc}",
        f"🖼 Превью: {image_str}",
        f"🎬 Видеоуроков: {len(videos)}",
        f"📍 Позиция: {pkg_idx + 1} из {total_pkgs}",
    ]

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton(text="✏️ Название", callback_data=f"epkg_name:{pkg_id}"))
    kb.add(types.InlineKeyboardButton(text="📊 Уровень", callback_data=f"epkg_level:{pkg_id}"))
    kb.add(types.InlineKeyboardButton(text="📝 Описание", callback_data=f"epkg_desc:{pkg_id}"))
    kb.add(types.InlineKeyboardButton(text="💰 Цена", callback_data=f"epkg_price:{pkg_id}"))
    kb.add(types.InlineKeyboardButton(text="🖼 Сменить превью", callback_data=f"epkg_img:{pkg_id}"))
    kb.add(types.InlineKeyboardButton(text=f"📍 Позиция ({pkg_idx + 1}/{total_pkgs})", callback_data=f"epkg_pos:{pkg_id}"))
    if videos:
        kb.add(types.InlineKeyboardButton(text="🎬 Редактировать видеоуроки", callback_data=f"epkg_vids:{pkg_id}"))
    kb.add(types.InlineKeyboardButton(text="⬅️ Назад", callback_data="editpkg_cancel"))

    bot.send_message(chat_id, "\n".join(lines), reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("editpkg:"))
def handle_edit_package_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        pkg_id, page_str = payload.rsplit(":", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка.")
        return

    bot.answer_callback_query(call.id)
    chat_pkg_target[chat_id] = pkg_id
    _send_edit_pkg_menu(chat_id, pkg_id)


# Редактирование названия
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_name:"))
def handle_edit_pkg_name(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    chat_pkg_target[chat_id] = pkg_id
    chat_state[chat_id] = "edit_pkg_name"
    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        "Введите новое *название* пакета:",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# Редактирование уровня
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_level:"))
def handle_edit_pkg_level(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    chat_pkg_target[chat_id] = pkg_id

    kb = types.InlineKeyboardMarkup()
    for level in ["Начинающий", "Средний", "Продвинутый", "Все уровни"]:
        kb.add(types.InlineKeyboardButton(text=level, callback_data=f"epkg_setlvl:{pkg_id}|{level}"))
    kb.add(types.InlineKeyboardButton(text="⬅️ Назад", callback_data=f"epkg_back:{pkg_id}"))

    bot.answer_callback_query(call.id)
    bot.send_message(chat_id, "Выберите новый *уровень* пакета:", parse_mode="Markdown", reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_setlvl:"))
def handle_edit_pkg_set_level(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    pkg_id, level = payload.split("|", 1)

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    pkg["level"] = level
    write_packages(packages)
    bot.answer_callback_query(call.id, f"Уровень: {level}")
    bot.send_message(chat_id, f"✅ Уровень изменён на «{level}».", reply_markup=make_yoga_keyboard())
    _send_edit_pkg_menu(chat_id, pkg_id)


# Редактирование описания
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_desc:"))
def handle_edit_pkg_desc(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    chat_pkg_target[chat_id] = pkg_id
    chat_state[chat_id] = "edit_pkg_desc"
    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        "Введите новое *описание* пакета:",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# Редактирование цены
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_price:"))
def handle_edit_pkg_price(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    chat_pkg_target[chat_id] = pkg_id
    chat_state[chat_id] = "edit_pkg_price"
    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        "Введите новую *цену* пакета в рублях (0 = бесплатно):",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# Смена превью
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_img:"))
def handle_edit_pkg_image(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    chat_pkg_target[chat_id] = pkg_id
    chat_state[chat_id] = "edit_pkg_preview"
    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        "Отправьте новое *превью* для пакета:\n\n"
        "• *Фото* — обложка пакета (старое фото удалится)\n"
        "• *Эмодзи* (например 🧘) — будет вместо картинки",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# Смена позиции пакета
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_pos:"))
def handle_edit_pkg_position(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    chat_pkg_target[chat_id] = pkg_id
    chat_state[chat_id] = "edit_pkg_position"

    packages = read_packages()
    total = len(packages)
    pkg_idx = next((i for i, p in enumerate(packages) if p["id"] == pkg_id), 0)

    lines = ["Текущий порядок пакетов:\n"]
    for i, p in enumerate(packages):
        marker = " 👈" if p["id"] == pkg_id else ""
        lines.append(f"  {i + 1}. {p.get('name', p['id'])}{marker}")
    lines.append(f"\nВведите новую позицию (1–{total}):")

    bot.answer_callback_query(call.id)
    bot.send_message(chat_id, "\n".join(lines), reply_markup=make_yoga_keyboard())


# Назад к меню редактирования пакета
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_back:"))
def handle_edit_pkg_back(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)
    bot.answer_callback_query(call.id)
    _send_edit_pkg_menu(chat_id, pkg_id)


# ── Редактирование видеоуроков внутри пакета ──

@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("epkg_vids:"))
def handle_edit_pkg_videos_list(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, pkg_id = call.data.split(":", 1)

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    videos = pkg.get("videos", [])
    if not videos:
        bot.answer_callback_query(call.id, "Видео нет.")
        return

    kb = types.InlineKeyboardMarkup()
    for i, v in enumerate(videos):
        title = v.get("title", f"Видео {i+1}")
        label = f"{i+1}. {title}"
        if len(label) > 55:
            label = label[:52] + "..."
        kb.add(types.InlineKeyboardButton(text=label, callback_data=f"evid_sel:{pkg_id}|{i}"))

    kb.add(types.InlineKeyboardButton(text="⬅️ Назад к пакету", callback_data=f"epkg_back:{pkg_id}"))

    bot.answer_callback_query(call.id)
    bot.send_message(chat_id, "Выберите видео для редактирования:", reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("evid_sel:"))
def handle_edit_video_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    pkg_id, idx_str = payload.split("|", 1)
    idx = int(idx_str)

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.answer_callback_query(call.id, "Пакет не найден.")
        return

    videos = pkg.get("videos", [])
    if idx < 0 or idx >= len(videos):
        bot.answer_callback_query(call.id, "Видео не найдено.")
        return

    v = videos[idx]
    title = v.get("title", "Без названия")
    dur = v.get("duration", "—")
    url = v.get("videoUrl", "нет файла")

    kb = types.InlineKeyboardMarkup()
    kb.add(types.InlineKeyboardButton(text="✏️ Переименовать", callback_data=f"evid_rename:{pkg_id}|{idx}"))
    if idx > 0:
        kb.add(types.InlineKeyboardButton(text="⬆️ Переместить выше", callback_data=f"evid_up:{pkg_id}|{idx}"))
    if idx < len(videos) - 1:
        kb.add(types.InlineKeyboardButton(text="⬇️ Переместить ниже", callback_data=f"evid_down:{pkg_id}|{idx}"))
    kb.add(types.InlineKeyboardButton(text="⬅️ К списку видео", callback_data=f"epkg_vids:{pkg_id}"))

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"🎬 *{title}*\n⏱ {dur}\n🔗 {url}\n\nВыберите действие:",
        parse_mode="Markdown",
        reply_markup=kb,
    )


# Переименование видео
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("evid_rename:"))
def handle_edit_video_rename(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    pkg_id, idx_str = payload.split("|", 1)
    idx = int(idx_str)

    chat_pkg_target[chat_id] = pkg_id
    chat_edit_vid_idx[chat_id] = idx
    chat_state[chat_id] = "edit_vid_title"

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        "Введите новое *название* видеоурока:",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )


# Переместить видео выше
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("evid_up:"))
def handle_edit_video_up(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    pkg_id, idx_str = payload.split("|", 1)
    idx = int(idx_str)

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg or idx <= 0 or idx >= len(pkg.get("videos", [])):
        bot.answer_callback_query(call.id, "Невозможно переместить.")
        return

    videos = pkg["videos"]
    videos[idx], videos[idx - 1] = videos[idx - 1], videos[idx]
    write_packages(packages)

    title = videos[idx - 1].get("title", "Видео")
    bot.answer_callback_query(call.id, f"«{title}» перемещено на позицию {idx}")

    # Показываем обновлённый список видео
    _send_edit_video_list(chat_id, pkg_id)


# Переместить видео ниже
@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("evid_down:"))
def handle_edit_video_down(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    pkg_id, idx_str = payload.split("|", 1)
    idx = int(idx_str)

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg or idx < 0 or idx >= len(pkg.get("videos", [])) - 1:
        bot.answer_callback_query(call.id, "Невозможно переместить.")
        return

    videos = pkg["videos"]
    videos[idx], videos[idx + 1] = videos[idx + 1], videos[idx]
    write_packages(packages)

    title = videos[idx + 1].get("title", "Видео")
    bot.answer_callback_query(call.id, f"«{title}» перемещено на позицию {idx + 2}")

    _send_edit_video_list(chat_id, pkg_id)


def _send_edit_video_list(chat_id: int, pkg_id: str):
    """Показывает обновлённый список видео после перемещения."""
    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
        return

    videos = pkg.get("videos", [])
    if not videos:
        bot.send_message(chat_id, "В пакете больше нет видео.", reply_markup=make_yoga_keyboard())
        return

    lines = [f"🎬 Видеоуроки в пакете «{pkg.get('name', pkg_id)}»:\n"]
    for i, v in enumerate(videos, 1):
        lines.append(f"  {i}. {v.get('title', 'Без названия')}")

    kb = types.InlineKeyboardMarkup()
    for i, v in enumerate(videos):
        title = v.get("title", f"Видео {i+1}")
        label = f"{i+1}. {title}"
        if len(label) > 55:
            label = label[:52] + "..."
        kb.add(types.InlineKeyboardButton(text=label, callback_data=f"evid_sel:{pkg_id}|{i}"))

    kb.add(types.InlineKeyboardButton(text="⬅️ Назад к пакету", callback_data=f"epkg_back:{pkg_id}"))

    bot.send_message(chat_id, "\n".join(lines), reply_markup=kb)


# ─── Конец блока пакетов ───────────────────────────────────────────

@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("del_date:"))
def handle_delete_date_callback(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, date_str = call.data.split(":", 1)

    slots = read_slots()
    times = slots.get(date_str, [])
    if not times:
        bot.answer_callback_query(call.id, "Для этой даты слотов уже нет.")
        bot.send_message(
            chat_id,
            "Для выбранной даты слотов уже нет.",
            reply_markup=make_main_keyboard(),
        )
        return

    kb = types.InlineKeyboardMarkup()
    for t in times:
        kb.add(
            types.InlineKeyboardButton(
                text=t,
                callback_data=f"del_time:{date_str}|{t}",
            )
        )

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Выберите слот для удаления ({format_date_ru(date_str)}):",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("del_time:"))
def handle_delete_time_callback(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    try:
        date_str, time = payload.split("|", 1)
    except ValueError:
        bot.answer_callback_query(call.id, "Ошибка данных слота.")
        return

    delete_slot_and_notify(chat_id, date_str, time)
    bot.answer_callback_query(call.id)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("cancel_date:"))
def handle_cancel_date_callback(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, date_str = call.data.split(":", 1)

    bookings = read_bookings()
    times = sorted({b["time"] for b in bookings if b.get("date") == date_str})

    if not times:
        bot.answer_callback_query(call.id, "На эту дату записей уже нет.")
        bot.send_message(
            chat_id,
            "На выбранную дату записей уже нет.",
            reply_markup=make_main_keyboard(),
        )
        return

    kb = types.InlineKeyboardMarkup()
    for t in times:
        kb.add(
            types.InlineKeyboardButton(
                text=t,
                callback_data=f"cancel_time:{date_str}|{t}",
            )
        )

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Выберите время для отмены записи ({format_date_ru(date_str)}):",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("cancel_time:"))
def handle_cancel_time_callback(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    try:
        date_str, time = payload.split("|", 1)
    except ValueError:
        bot.answer_callback_query(call.id, "Ошибка данных записи.")
        return

    bookings = read_bookings()
    affected = [b for b in bookings if b.get("date") == date_str and b.get("time") == time]

    if not affected:
        bot.answer_callback_query(call.id, "Запись уже отсутствует.")
        bot.send_message(
            chat_id,
            "Записей на этот слот уже нет.",
            reply_markup=make_main_keyboard(),
        )
        return

    lines = [
        f"⚠ Будут отменены записи на {format_date_ru(date_str)} в {time}:",
        "",
    ]
    for b in affected:
        name = b.get("name") or "Без имени"
        phone = b.get("phone") or "без телефона"
        lines.append(f"• {name}, телефон: {phone}")
    lines.append("")
    lines.append("Вы действительно хотите отменить эти записи?")

    kb = types.InlineKeyboardMarkup()
    kb.add(
        types.InlineKeyboardButton(
            text="✅ Да, отменить записи",
            callback_data=f"confirm_cancel_booking:{date_str}|{time}",
        )
    )
    kb.add(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="cancel_cancel_booking",
        )
    )

    bot.answer_callback_query(call.id)
    bot.send_message(chat_id, "\n".join(lines), reply_markup=kb)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("confirm_cancel_booking:"))
def handle_confirm_cancel_booking_callback(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    try:
        date_str, time = payload.split("|", 1)
    except ValueError:
        bot.answer_callback_query(call.id, "Ошибка данных записи.")
        return

    bookings = read_bookings()
    remaining = [b for b in bookings if not (b.get("date") == date_str and b.get("time") == time)]
    cancelled = [b for b in bookings if b.get("date") == date_str and b.get("time") == time]

    # Сохраняем только оставшиеся записи
    from json import dump
    BOOKINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BOOKINGS_FILE, "w", encoding="utf-8") as f:
        dump(remaining, f, ensure_ascii=False, indent=2)

    if cancelled:
        lines = [
            f"❌ Отменены записи на {format_date_ru(date_str)} в {time}.",
            "",
            "Клиенты, которых нужно уведомить:",
        ]
        for b in cancelled:
            name = b.get("name") or "Без имени"
            phone = b.get("phone") or "без телефона"
            lines.append(f"• {name}, телефон: {phone}")
        bot.send_message(chat_id, "\n".join(lines), reply_markup=make_main_keyboard())
    else:
        bot.send_message(
            chat_id,
            "Записи уже были отменены ранее.",
            reply_markup=make_main_keyboard(),
        )

    bot.answer_callback_query(call.id, "Записи отменены.")


@bot.callback_query_handler(func=lambda c: c.data == "cancel_cancel_booking")
def handle_cancel_cancel_booking_callback(call: types.CallbackQuery):
    bot.answer_callback_query(call.id, "Отмена действий с записями.")


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("delpostpage:"))
def handle_delete_post_page(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, page_str = call.data.split(":", 1)
        page = int(page_str)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка номера страницы.")
        return

    bot.answer_callback_query(call.id)
    send_posts_page(chat_id, page)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("editpostpage:"))
def handle_edit_post_page(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, page_str = call.data.split(":", 1)
        page = int(page_str)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка номера страницы.")
        return

    bot.answer_callback_query(call.id)
    send_edit_posts_page(chat_id, page)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("delpost:"))
def handle_delete_post_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        slug, page_str = payload.split(":", 1)
        _ = int(page_str)  # пока не используем, но может пригодиться
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных поста.")
        return

    path = POSTS_DIR / f"{slug}.md"
    if not path.exists():
        bot.answer_callback_query(call.id, "Файл поста не найден.")
        bot.send_message(
            chat_id,
            "Пост уже удалён или файл не найден.",
            reply_markup=make_blog_keyboard(),
        )
        return

    # Пытаемся вытащить заголовок для подтверждения
    title = slug
    try:
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        if lines and lines[0].strip() == "---":
            for line in lines[1:]:
                if line.strip() == "---":
                    break
                if line.strip().startswith("title:"):
                    raw = line.split(":", 1)[1].strip()
                    if raw.startswith('"') and raw.endswith('"'):
                        raw = raw[1:-1]
                    title = raw or slug
                    break
    except Exception:
        pass

    kb = types.InlineKeyboardMarkup()
    kb.row(
        types.InlineKeyboardButton(
            text="✅ Да, удалить пост",
            callback_data=f"confirm_delpost:{slug}",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="cancel_delpost",
        )
    )

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Вы действительно хотите удалить пост «{title}»?\n\n"
        f"Файл: `{slug}.md`",
        parse_mode="Markdown",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("confirm_delpost:"))
def handle_confirm_delete_post(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, slug = call.data.split(":", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных поста.")
        return

    path = POSTS_DIR / f"{slug}.md"
    if path.exists():
        try:
            path.unlink()
            bot.send_message(
                chat_id,
                f"🗑 Пост `{slug}.md` удалён.",
                parse_mode="Markdown",
                reply_markup=make_blog_keyboard(),
            )
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось удалить файл поста: {e}",
                reply_markup=make_blog_keyboard(),
            )
    else:
        bot.send_message(
            chat_id,
            "Файл поста уже не существует.",
            reply_markup=make_blog_keyboard(),
        )

    bot.answer_callback_query(call.id, "Пост удалён.")


@bot.callback_query_handler(func=lambda c: c.data == "cancel_delpost")
def handle_cancel_delete_post(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    bot.answer_callback_query(call.id, "Удаление поста отменено.")
    bot.send_message(
        chat_id,
        "Удаление поста отменено.",
        reply_markup=make_blog_keyboard(),
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_dir:"))
def handle_media_dir(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, dir_name = call.data.split(":", 1)
    bot.answer_callback_query(call.id)
    send_media_files(chat_id, dir_name, page=0)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_page:"))
def handle_media_page(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        dir_name, page_str = payload.split("|", 1)
        page = int(page_str)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка номера страницы.")
        return

    bot.answer_callback_query(call.id)
    send_media_files(chat_id, dir_name, page=page)


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_upload:"))
def handle_media_upload_start(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, dir_name = call.data.split(":", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных папки.")
        return

    chat_state[chat_id] = "upload_file"
    chat_upload_dirs[chat_id] = dir_name

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Отправьте файл, который хотите загрузить в папку `{dir_name}`.\n\n"
        "Можно отправить фото, видео, аудио или документ — я сохраню его в соответствующую папку в `public`.",
        parse_mode="Markdown",
        reply_markup=make_blog_keyboard(),
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_file:"))
def handle_media_file(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        dir_name, filename, page_str = payload.split("|", 2)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных файла.")
        return

    path = PUBLIC_DIR / dir_name / filename
    if not path.exists():
        bot.answer_callback_query(call.id, "Файл не найден.")
        bot.send_message(
            chat_id,
            "Файл не найден на сервере.",
            reply_markup=make_blog_keyboard(),
        )
        return

    ext = path.suffix.lower()
    bot.answer_callback_query(call.id)

    # Размер файла для информации
    try:
        size_bytes = path.stat().st_size
        if size_bytes >= 1024 * 1024:
            size_str = f"{size_bytes / (1024 * 1024):.1f} МБ"
        elif size_bytes >= 1024:
            size_str = f"{size_bytes / 1024:.0f} КБ"
        else:
            size_str = f"{size_bytes} байт"
    except Exception:
        size_str = "?"

    # Пробуем отправить превью, но только для небольших файлов (< 20 МБ)
    # и фото. Для крупных видео — не пытаемся, чтобы избежать таймаутов.
    sent_preview = False
    MAX_SEND_SIZE = 20 * 1024 * 1024  # 20 МБ
    try:
        if size_bytes < MAX_SEND_SIZE:
            if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
                with open(path, "rb") as f:
                    bot.send_photo(chat_id, f, caption=filename)
                sent_preview = True
            elif ext in [".mp3", ".wav"]:
                with open(path, "rb") as f:
                    bot.send_audio(chat_id, f, caption=filename)
                sent_preview = True
    except Exception:
        pass  # Если не отправилось — не страшно, кнопки всё равно покажем

    # Всегда показываем кнопки действий с файлом
    kb = types.InlineKeyboardMarkup()
    kb.row(
        types.InlineKeyboardButton(
            text="🗑 Удалить файл",
            callback_data=f"mf_delfile:{dir_name}|{filename}",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="✏️ Переименовать файл",
            callback_data=f"mf_rename:{dir_name}|{filename}",
        )
    )
    kb.row(
        types.InlineKeyboardButton(
            text="Отмена",
            callback_data="mf_cancel",
        )
    )

    info = f"📄 `{filename}`\n📁 Папка: `{dir_name}`\n💾 Размер: {size_str}"
    if not sent_preview and ext in [".mp4", ".mov", ".avi"]:
        info += "\n\n⚠️ Видеофайл слишком большой для предпросмотра в Telegram."

    bot.send_message(
        chat_id,
        f"{info}\n\nВыберите действие:",
        parse_mode="Markdown",
        reply_markup=kb,
    )


@bot.callback_query_handler(func=lambda c: c.data == "mf_back_dirs")
def handle_media_back_dirs(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    bot.answer_callback_query(call.id)
    send_media_dirs(chat_id)


@bot.callback_query_handler(func=lambda c: c.data == "mf_cancel")
def handle_media_cancel(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    bot.answer_callback_query(call.id, "Управление файлами закрыто.")
    bot.send_message(
        chat_id,
        "Управление файлами закрыто.",
        reply_markup=make_blog_keyboard(),
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_delfile:"))
def handle_media_delete_file(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        dir_name, filename = payload.split("|", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных файла.")
        return

    path = PUBLIC_DIR / dir_name / filename
    if not path.exists():
        bot.answer_callback_query(call.id, "Файл уже не существует.")
        bot.send_message(
            chat_id,
            "Файл уже удалён или отсутствует.",
            reply_markup=make_blog_keyboard(),
        )
        return

    try:
        path.unlink()
        bot.answer_callback_query(call.id, "Файл удалён.")
        bot.send_message(
            chat_id,
            f"🗑 Файл `{filename}` удалён из папки `{dir_name}`.",
            parse_mode="Markdown",
            reply_markup=make_blog_keyboard(),
        )
    except Exception as e:
        bot.answer_callback_query(call.id, "Не удалось удалить файл.")
        bot.send_message(
            chat_id,
            f"Не удалось удалить файл: {e}",
            reply_markup=make_blog_keyboard(),
        )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_keepname:"))
def handle_media_keepname(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        dir_name, filename = payload.split("|", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных файла.")
        return

    bot.answer_callback_query(call.id, "Имя файла оставлено без изменений.")
    bot.send_message(
        chat_id,
        f"Файл `{filename}` оставлен в папке `{dir_name}` без изменений.",
        parse_mode="Markdown",
        reply_markup=make_blog_keyboard(),
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("mf_rename:"))
def handle_media_rename_file_start(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        dir_name, filename = payload.split("|", 1)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных файла.")
        return

    path = PUBLIC_DIR / dir_name / filename
    if not path.exists():
        bot.answer_callback_query(call.id, "Файл уже не существует.")
        bot.send_message(
            chat_id,
            "Файл уже удалён или отсутствует.",
            reply_markup=make_blog_keyboard(),
        )
        return

    chat_state[chat_id] = "rename_file"
    chat_rename_targets[chat_id] = (dir_name, filename)

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        f"Текущее имя файла: `{filename}`.\n"
        "Отправьте новое имя файла (только имя с расширением, без `/` или `\\`).",
        parse_mode="Markdown",
        reply_markup=make_blog_keyboard(),
    )


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("editpost:"))
def handle_edit_post_select(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    try:
        _, payload = call.data.split(":", 1)
        slug, page_str = payload.split(":", 1)
        _ = int(page_str)
    except Exception:
        bot.answer_callback_query(call.id, "Ошибка данных поста.")
        return

    path = POSTS_DIR / f"{slug}.md"
    if not path.exists():
        bot.answer_callback_query(call.id, "Файл поста не найден.")
        bot.send_message(
            chat_id,
            "Пост уже удалён или файл не найден.",
            reply_markup=make_blog_keyboard(),
        )
        return

    try:
        content = path.read_text(encoding="utf-8")
    except Exception as e:
        bot.answer_callback_query(call.id, "Не удалось прочитать файл поста.")
        bot.send_message(
            chat_id,
            f"Не удалось прочитать файл поста: {e}",
            reply_markup=make_blog_keyboard(),
        )
        return

    chat_edit_post_files[chat_id] = f"{slug}.md"
    chat_state[chat_id] = "edit_post"

    # Показываем текст поста в код-блоке, чтобы можно было удобно скопировать и отредактировать
    preview = content
    # Telegram ограничивает длину сообщения ~4096 символами — на всякий случай режем, если очень длинный
    max_len = 3500
    if len(preview) > max_len:
        preview = preview[:max_len] + "\n\n... (обрезано, скопируйте из исходного файла при необходимости)"

    bot.answer_callback_query(call.id)
    bot.send_message(
        chat_id,
        "Текущий текст поста. Скопируйте, отредактируйте и пришлите *полностью* одним сообщением.\n\n"
        "```md\n"
        f"{preview}\n"
        "```",
        parse_mode="Markdown",
        reply_markup=make_blog_keyboard(),
    )


def _finalize_new_package(chat_id: int, image_path: str = ""):
    """
    Создаёт пакет из черновика chat_pkg_draft и сохраняет в JSON.
    """
    draft = chat_pkg_draft.get(chat_id, {})

    new_package = {
        "id": draft.get("id", f"pkg-{datetime.now().strftime('%Y%m%d-%H%M%S')}"),
        "name": draft.get("name", "Новый пакет"),
        "level": draft.get("level", "Все уровни"),
        "description": draft.get("description", ""),
        "videos": [],
        "price": draft.get("price", 0),
        "image": image_path,
        "available": True,
    }

    packages = read_packages()
    existing_ids = {p["id"] for p in packages}
    if new_package["id"] in existing_ids:
        new_package["id"] = f"{new_package['id']}-{datetime.now().strftime('%H%M%S')}"

    packages.append(new_package)
    write_packages(packages)

    price = new_package["price"]
    price_str = f"{price} ₽" if price > 0 else "Бесплатно"
    img_note = f"\n🖼 Превью: `{image_path}`" if image_path else "\n🖼 Без превью"
    bot.send_message(
        chat_id,
        f"✅ Пакет создан!\n\n"
        f"📦 *{new_package['name']}*\n"
        f"📊 Уровень: {new_package['level']}\n"
        f"💰 Цена: {price_str}\n"
        f"📝 {new_package['description']}"
        f"{img_note}\n\n"
        f"ID: `{new_package['id']}`\n\n"
        "Теперь вы можете добавить видеоуроки через «Добавить видео в пакет».",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )
    chat_state[chat_id] = None
    chat_pkg_draft.pop(chat_id, None)


def _save_video_to_package(chat_id: int, pkg_id: str | None, draft: dict):
    """
    Финальный шаг: сохраняем видео из draft в пакет pkg_id.
    """
    if not pkg_id:
        bot.send_message(
            chat_id,
            "Не удалось определить пакет. Начните заново через «Добавить видео в пакет».",
            reply_markup=make_yoga_keyboard(),
        )
        chat_state[chat_id] = None
        chat_pkg_target.pop(chat_id, None)
        chat_video_draft.pop(chat_id, None)
        return

    packages = read_packages()
    pkg = next((p for p in packages if p["id"] == pkg_id), None)
    if not pkg:
        bot.send_message(
            chat_id,
            "Пакет не найден. Возможно, он был удалён.",
            reply_markup=make_yoga_keyboard(),
        )
        chat_state[chat_id] = None
        chat_pkg_target.pop(chat_id, None)
        chat_video_draft.pop(chat_id, None)
        return

    new_video: dict = {
        "title": draft.get("title", "Без названия"),
        "duration": draft.get("duration", ""),
    }
    if draft.get("videoUrl"):
        new_video["videoUrl"] = draft["videoUrl"]

    if "videos" not in pkg:
        pkg["videos"] = []

    # Вставляем в нужную позицию (1-based из draft)
    position = draft.get("position")
    if position and 1 <= position <= len(pkg["videos"]) + 1:
        pkg["videos"].insert(position - 1, new_video)
    else:
        pkg["videos"].append(new_video)
    write_packages(packages)

    url_info = ""
    if new_video.get("videoUrl"):
        url_info = f"\n🔗 Файл: `{new_video['videoUrl']}`"

    bot.send_message(
        chat_id,
        f"✅ Видео добавлено в пакет «{pkg.get('name', pkg_id)}»!\n\n"
        f"🎬 *{new_video['title']}*\n"
        f"⏱ {new_video['duration']}"
        f"{url_info}\n\n"
        f"Всего видео в пакете: {len(pkg['videos'])}.",
        parse_mode="Markdown",
        reply_markup=make_yoga_keyboard(),
    )
    chat_state[chat_id] = None
    chat_pkg_target.pop(chat_id, None)
    chat_video_draft.pop(chat_id, None)


@bot.message_handler(content_types=["photo", "video", "audio", "document"])
def handle_media_message(message):
    chat_id = message.chat.id
    state = chat_state.get(chat_id)

    # 1) Превью к посту
    if state == "add_post_preview":
        filename = chat_post_files.get(chat_id)
        if not filename:
            bot.send_message(
                chat_id,
                "Не удалось связать фото с постом. Попробуйте снова через «Управление блогом → Добавить пост».",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            return

        # Берём самое большое фото
        if not message.photo:
            bot.send_message(
                chat_id,
                "Для превью нужно отправить именно фото. Попробуйте ещё раз.",
                reply_markup=make_blog_keyboard(),
            )
            return

        photo = message.photo[-1]
        try:
            file_info = bot.get_file(photo.file_id)
            downloaded = bot.download_file(file_info.file_path)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось скачать фото с серверов Telegram: {e}",
                reply_markup=make_blog_keyboard(),
            )
            return

        # Сохраняем в public/notgallery, чтобы эти превью не попадали в фотогалерею
        photos_dir = BASE_DIR / "public" / "notgallery"
        photos_dir.mkdir(parents=True, exist_ok=True)
        img_name = f"post-preview-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jpg"
        img_path = photos_dir / img_name
        with open(img_path, "wb") as f:
            f.write(downloaded)

        # Добавляем previewImage в markdown‑файл
        web_path = f"/notgallery/{img_name}"
        try:
            add_preview_to_post(filename, web_path)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Пост сохранён, но не удалось прописать previewImage: {e}",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            chat_post_files.pop(chat_id, None)
            return

        bot.send_message(
            chat_id,
            f"✅ Превью добавлено.\n"
            f"В посте прописан `previewImage: \"{web_path}\"`.",
            parse_mode="Markdown",
            reply_markup=make_blog_keyboard(),
        )
        chat_state[chat_id] = None
        chat_post_files.pop(chat_id, None)
        return

    # 2) Превью при создании нового пакета
    if state == "add_pkg_preview":
        if not message.photo:
            bot.send_message(
                chat_id,
                "Для превью нужно отправить именно фото.\n"
                "Или напишите `Без превью`.",
                reply_markup=make_yoga_keyboard(),
            )
            return

        photo = message.photo[-1]
        try:
            file_info = bot.get_file(photo.file_id)
            downloaded = bot.download_file(file_info.file_path)
        except Exception as e:
            bot.send_message(chat_id, f"Не удалось скачать фото: {e}", reply_markup=make_yoga_keyboard())
            return

        photos_dir = BASE_DIR / "public" / "notgallery"
        photos_dir.mkdir(parents=True, exist_ok=True)
        img_name = f"pkg-preview-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jpg"
        img_path = photos_dir / img_name
        with open(img_path, "wb") as f:
            f.write(downloaded)

        web_path = f"/notgallery/{img_name}"
        _finalize_new_package(chat_id, image_path=web_path)
        return

    # 3) Превью при редактировании пакета
    if state == "edit_pkg_preview":
        if not message.photo:
            bot.send_message(
                chat_id,
                "Для превью нужно отправить фото или эмодзи (текстом).",
                reply_markup=make_yoga_keyboard(),
            )
            return

        pkg_id = chat_pkg_target.get(chat_id)
        if not pkg_id:
            bot.send_message(chat_id, "Ошибка: пакет не определён.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        photo = message.photo[-1]
        try:
            file_info = bot.get_file(photo.file_id)
            downloaded = bot.download_file(file_info.file_path)
        except Exception as e:
            bot.send_message(chat_id, f"Не удалось скачать фото: {e}", reply_markup=make_yoga_keyboard())
            return

        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None)
        if not pkg:
            bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        # Удаляем старое превью
        old_image = pkg.get("image", "")
        if old_image and old_image.startswith("/notgallery/"):
            old_path = PUBLIC_DIR / old_image.lstrip("/")
            if old_path.exists():
                try:
                    old_path.unlink()
                except Exception:
                    pass

        # Сохраняем новое
        photos_dir = BASE_DIR / "public" / "notgallery"
        photos_dir.mkdir(parents=True, exist_ok=True)
        img_name = f"pkg-preview-{datetime.now().strftime('%Y%m%d-%H%M%S')}.jpg"
        img_path = photos_dir / img_name
        with open(img_path, "wb") as f:
            f.write(downloaded)

        web_path = f"/notgallery/{img_name}"
        pkg["image"] = web_path
        write_packages(packages)

        bot.send_message(
            chat_id,
            f"✅ Превью обновлено: `{web_path}`",
            parse_mode="Markdown",
            reply_markup=make_yoga_keyboard(),
        )
        chat_state[chat_id] = None
        _send_edit_pkg_menu(chat_id, pkg_id)
        return

    # 4) Загрузка видео для пакета уроков
    if state == "add_video_file":
        # Принимаем видео или документ как файл видеоурока
        file_id = None
        ext = ""

        try:
            if message.video:
                file_id = message.video.file_id
                ext = ".mp4"
            elif message.document:
                file_id = message.document.file_id
                _, dot, tail = message.document.file_name.rpartition(".")
                ext = "." + tail if dot else ""
            else:
                bot.send_message(
                    chat_id,
                    "Для видеоурока отправьте видео или документ.\n"
                    "Можно также отправить URL или написать `Пропустить`.",
                    reply_markup=make_yoga_keyboard(),
                )
                return

            file_info = bot.get_file(file_id)
            data = bot.download_file(file_info.file_path)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось скачать файл с серверов Telegram: {e}",
                reply_markup=make_yoga_keyboard(),
            )
            return

        # Сохраняем в public/videos/
        VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        if message.document and message.document.file_name:
            filename = message.document.file_name
        else:
            filename = f"video-{datetime.now().strftime('%Y%m%d-%H%M%S')}{ext}"

        target_path = VIDEOS_DIR / filename
        # Если файл уже существует, добавляем суффикс
        if target_path.exists():
            stem = target_path.stem
            suffix = target_path.suffix
            filename = f"{stem}-{datetime.now().strftime('%H%M%S')}{suffix}"
            target_path = VIDEOS_DIR / filename

        try:
            with open(target_path, "wb") as f:
                f.write(data)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось сохранить видеофайл: {e}",
                reply_markup=make_yoga_keyboard(),
            )
            return

        pkg_id = chat_pkg_target.get(chat_id)
        draft = chat_video_draft.get(chat_id, {})
        draft["videoUrl"] = f"/videos/{filename}"

        _save_video_to_package(chat_id, pkg_id, draft)
        return

    # 3) Загрузка файла в public/<dir> через «Управление файлами»
    if state == "upload_file":
        dir_name = chat_upload_dirs.get(chat_id)
        if not dir_name:
            bot.send_message(
                chat_id,
                "Не удалось определить папку для загрузки. Начните снова через «Управление файлами».",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            return

        target_dir = PUBLIC_DIR / dir_name
        target_dir.mkdir(parents=True, exist_ok=True)

        file_id = None
        data = None
        ext = ""

        try:
            if message.photo:
                # самое большое фото
                ph = message.photo[-1]
                file_id = ph.file_id
                ext = ".jpg"
            elif message.video:
                file_id = message.video.file_id
                ext = ".mp4"
            elif message.audio:
                file_id = message.audio.file_id
                ext = ".mp3"
            elif message.document:
                file_id = message.document.file_id
                _, dot, tail = message.document.file_name.rpartition(".")
                ext = "." + tail if dot else ""
            else:
                bot.send_message(
                    chat_id,
                    "Не удалось определить тип файла. Попробуйте ещё раз.",
                    reply_markup=make_blog_keyboard(),
                )
                return

            file_info = bot.get_file(file_id)
            data = bot.download_file(file_info.file_path)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось скачать файл с серверов Telegram: {e}",
                reply_markup=make_blog_keyboard(),
            )
            return

        # Генерируем имя файла, если у документа оно своё — используем его
        if message.document and message.document.file_name:
            filename = message.document.file_name
        else:
            filename = f"upload-{datetime.now().strftime('%Y%m%d-%H%M%S')}{ext}"

        target_path = target_dir / filename
        try:
            with open(target_path, "wb") as f:
                f.write(data)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось сохранить файл: {e}",
                reply_markup=make_blog_keyboard(),
            )
            return

        # После загрузки предлагаем оставить имя или переименовать
        kb = types.InlineKeyboardMarkup()
        kb.row(
            types.InlineKeyboardButton(
                text="✅ Оставить стандартное название",
                callback_data=f"mf_keepname:{dir_name}|{filename}",
            )
        )
        kb.row(
            types.InlineKeyboardButton(
                text="✏️ Переименовать файл",
                callback_data=f"mf_rename:{dir_name}|{filename}",
            )
        )
        kb.row(
            types.InlineKeyboardButton(
                text="Отмена",
                callback_data="mf_cancel",
            )
        )

        bot.send_message(
            chat_id,
            f"✅ Файл загружен в папку `{dir_name}` под именем:\n`{filename}`.\n\n"
            "Выберите действие:",
            parse_mode="Markdown",
            reply_markup=kb,
        )
        chat_state[chat_id] = None
        chat_upload_dirs.pop(chat_id, None)
        return

    # Если медиасообщение пришло вне ожидаемого состояния — пока игнорируем


@bot.callback_query_handler(func=lambda c: c.data and c.data.startswith("confirm_del:"))
def handle_confirm_delete_callback(call: types.CallbackQuery):
    chat_id = call.message.chat.id
    _, payload = call.data.split(":", 1)
    try:
        date_str, time = payload.split("|", 1)
    except ValueError:
        bot.answer_callback_query(call.id, "Ошибка данных слота.")
        return

    # Здесь реально удаляем слот и связанные с ним записи
    slots = read_slots()
    bookings = read_bookings()

    # Разделяем записи: какие отменяем и какие оставляем
    cancelled_bookings = [b for b in bookings if b.get("date") == date_str and b.get("time") == time]
    remaining_bookings = [b for b in bookings if not (b.get("date") == date_str and b.get("time") == time)]

    # Удаляем слот
    if date_str in slots and time in slots[date_str]:
        new_times = [t for t in slots[date_str] if t != time]
        if new_times:
            slots[date_str] = new_times
        else:
            del slots[date_str]
        write_slots(slots)

    # Перезаписываем bookings.json только с оставшимися записями
    BOOKINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(BOOKINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(remaining_bookings, f, ensure_ascii=False, indent=2)

    if cancelled_bookings:
        lines = [
            f"❌ Слот удалён и записи отменены: {format_date_ru(date_str)} в {time}.",
            "",
            "Клиенты, которых нужно уведомить:",
        ]
        for b in cancelled_bookings:
            name = b.get("name") or "Без имени"
            phone = b.get("phone") or "без телефона"
            lines.append(f"• {name}, телефон: {phone}")
        bot.send_message(chat_id, "\n".join(lines), reply_markup=make_main_keyboard())
    else:
        bot.send_message(
            chat_id,
            f"🗑 Слот удалён: {format_date_ru(date_str)} в {time}",
            reply_markup=make_main_keyboard(),
        )

    bot.answer_callback_query(call.id, "Слот и связанные записи удалены.")


@bot.callback_query_handler(func=lambda c: c.data == "cancel_del")
def handle_cancel_delete_callback(call: types.CallbackQuery):
    bot.answer_callback_query(call.id, "Удаление слота отменено.")


@bot.message_handler(func=lambda m: True)
def handle_text(message):
    chat_id = message.chat.id
    state = chat_state.get(chat_id)

    if state == "add_post":
        # Пользователь прислал markdown‑текст для нового поста
        content = (message.text or "").strip()
        if not content:
            bot.send_message(
                chat_id,
                "Пост пустой. Отправьте, пожалуйста, текст поста в формате markdown одним сообщением.",
                reply_markup=make_blog_keyboard(),
            )
            return

        try:
            filename = create_blog_post_file(content)
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось сохранить пост: {e}",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            return

        # Сохраняем файл и переходим к шагу с превью
        chat_post_files[chat_id] = filename
        chat_state[chat_id] = "add_post_preview"
        bot.send_message(
            chat_id,
            f"✅ Пост сохранён как файл `{filename}` в `content/posts/`.\n\n"
            "Хотите добавить превью‑изображение?\n"
            "• Если да — просто отправьте фото одним сообщением.\n"
            "• Если нет — отправьте текст `Без превью`.",
            parse_mode="Markdown",
            reply_markup=make_blog_keyboard(),
        )
        return

    if state == "add_post_preview":
        text = (message.text or "").strip().lower()
        if text in ("без превью", "нет превью", "нет"):
            # Завершаем без превью
            bot.send_message(
                chat_id,
                "Пост сохранён без превью‑изображения.",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            chat_post_files.pop(chat_id, None)
            return
        # Любой другой текст в этом режиме игнорируем и напоминаем про фото/«Без превью»
        bot.send_message(
            chat_id,
            "Чтобы добавить превью, отправьте фото.\n"
            "Если не нужно превью — отправьте текст `Без превью`.",
            reply_markup=make_blog_keyboard(),
        )
        return

    if state == "edit_post":
        # Пользователь прислал отредактированный markdown‑текст существующего поста
        content = (message.text or "").strip()
        if not content:
            bot.send_message(
                chat_id,
                "Пост пустой. Отправьте, пожалуйста, полный текст поста в формате markdown.",
                reply_markup=make_blog_keyboard(),
            )
            return

        filename = chat_edit_post_files.get(chat_id)
        if not filename:
            bot.send_message(
                chat_id,
                "Не удалось определить, какой пост редактируется. Начните заново через «Редактировать пост».",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            return

        path = POSTS_DIR / filename
        try:
            path.write_text(content, encoding="utf-8")
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось сохранить изменения поста: {e}",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            chat_edit_post_files.pop(chat_id, None)
            return

        bot.send_message(
            chat_id,
            f"✅ Пост `{filename}` обновлён.\n\n"
            "Изменения появятся в блоге после следующей перезагрузки сайта/сборки.",
            parse_mode="Markdown",
            reply_markup=make_blog_keyboard(),
        )
        chat_state[chat_id] = None
        chat_edit_post_files.pop(chat_id, None)
        return

    if state == "rename_file":
        new_name = (message.text or "").strip()
        if not new_name:
            bot.send_message(
                chat_id,
                "Имя файла не может быть пустым. Попробуйте ещё раз или воспользуйтесь «Управление файлами» заново.",
                reply_markup=make_blog_keyboard(),
            )
            return
        if any(ch in new_name for ch in ["/", "\\"]):
            bot.send_message(
                chat_id,
                "В имени файла не должны быть символы `/` или `\\`. Укажите только имя с расширением, например `photo-1.jpg`.",
                reply_markup=make_blog_keyboard(),
            )
            return

        target_info = chat_rename_targets.get(chat_id)
        if not target_info:
            bot.send_message(
                chat_id,
                "Не удалось определить, какой файл переименовать. Начните снова через «Управление файлами».",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            return

        dir_name, old_name = target_info
        old_path = PUBLIC_DIR / dir_name / old_name

        # Если пользователь не указал расширение, сохраняем старое
        from pathlib import Path as _Path
        old_suffix = _Path(old_name).suffix
        new_suffix = _Path(new_name).suffix
        if not new_suffix and old_suffix:
            new_name = new_name + old_suffix

        new_path = PUBLIC_DIR / dir_name / new_name

        if not old_path.exists():
            bot.send_message(
                chat_id,
                "Исходный файл уже не существует.",
                reply_markup=make_blog_keyboard(),
            )
            chat_state[chat_id] = None
            chat_rename_targets.pop(chat_id, None)
            return

        if new_path.exists():
            bot.send_message(
                chat_id,
                "Файл с таким именем уже существует в этой папке. Выберите другое имя.",
                reply_markup=make_blog_keyboard(),
            )
            return

        try:
            old_path.rename(new_path)
            bot.send_message(
                chat_id,
                f"✅ Файл переименован:\n`{old_name}` → `{new_name}`",
                parse_mode="Markdown",
                reply_markup=make_blog_keyboard(),
            )
        except Exception as e:
            bot.send_message(
                chat_id,
                f"Не удалось переименовать файл: {e}",
                reply_markup=make_blog_keyboard(),
            )

        chat_state[chat_id] = None
        chat_rename_targets.pop(chat_id, None)
        return

    # ── Редактирование пакетов и видео ──

    if state == "edit_pkg_name":
        new_name = (message.text or "").strip()
        if not new_name:
            bot.send_message(chat_id, "Название не может быть пустым. Введите новое название:", reply_markup=make_yoga_keyboard())
            return

        pkg_id = chat_pkg_target.get(chat_id)
        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None)
        if not pkg:
            bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        old_name = pkg.get("name", pkg_id)
        pkg["name"] = new_name
        write_packages(packages)

        bot.send_message(
            chat_id,
            f"✅ Название изменено: «{old_name}» → «{new_name}»",
            reply_markup=make_yoga_keyboard(),
        )
        chat_state[chat_id] = None
        _send_edit_pkg_menu(chat_id, pkg_id)
        return

    if state == "edit_pkg_desc":
        new_desc = (message.text or "").strip()
        if not new_desc:
            bot.send_message(chat_id, "Описание не может быть пустым. Введите новое описание:", reply_markup=make_yoga_keyboard())
            return

        pkg_id = chat_pkg_target.get(chat_id)
        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None)
        if not pkg:
            bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        pkg["description"] = new_desc
        write_packages(packages)

        bot.send_message(chat_id, "✅ Описание обновлено.", reply_markup=make_yoga_keyboard())
        chat_state[chat_id] = None
        _send_edit_pkg_menu(chat_id, pkg_id)
        return

    if state == "edit_pkg_price":
        price_text = (message.text or "").strip()
        try:
            price = int(price_text)
            if price < 0:
                raise ValueError()
        except ValueError:
            bot.send_message(chat_id, "Введите корректную цену (целое число >= 0):", reply_markup=make_yoga_keyboard())
            return

        pkg_id = chat_pkg_target.get(chat_id)
        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None)
        if not pkg:
            bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        old_price = pkg.get("price", 0)
        pkg["price"] = price
        write_packages(packages)

        price_str = f"{price} ₽" if price > 0 else "Бесплатно"
        bot.send_message(chat_id, f"✅ Цена изменена: {old_price} ₽ → {price_str}", reply_markup=make_yoga_keyboard())
        chat_state[chat_id] = None
        _send_edit_pkg_menu(chat_id, pkg_id)
        return

    if state == "edit_pkg_position":
        pos_text = (message.text or "").strip()
        pkg_id = chat_pkg_target.get(chat_id)

        packages = read_packages()
        total = len(packages)

        try:
            new_pos = int(pos_text)
            if new_pos < 1 or new_pos > total:
                raise ValueError()
        except ValueError:
            bot.send_message(chat_id, f"Введите число от 1 до {total}:", reply_markup=make_yoga_keyboard())
            return

        # Находим текущий индекс
        old_idx = next((i for i, p in enumerate(packages) if p["id"] == pkg_id), None)
        if old_idx is None:
            bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        new_idx = new_pos - 1
        if old_idx == new_idx:
            bot.send_message(chat_id, "Пакет уже на этой позиции.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            _send_edit_pkg_menu(chat_id, pkg_id)
            return

        # Перемещаем
        pkg = packages.pop(old_idx)
        packages.insert(new_idx, pkg)
        write_packages(packages)

        bot.send_message(
            chat_id,
            f"✅ Пакет «{pkg.get('name', pkg_id)}» перемещён на позицию {new_pos}.",
            reply_markup=make_yoga_keyboard(),
        )
        chat_state[chat_id] = None
        _send_edit_pkg_menu(chat_id, pkg_id)
        return

    if state == "edit_pkg_preview":
        # Эмодзи как превью при редактировании
        text = (message.text or "").strip()
        if text and len(text) <= 10 and not text.startswith("/"):
            pkg_id = chat_pkg_target.get(chat_id)
            if not pkg_id:
                bot.send_message(chat_id, "Ошибка: пакет не определён.", reply_markup=make_yoga_keyboard())
                chat_state[chat_id] = None
                return

            packages = read_packages()
            pkg = next((p for p in packages if p["id"] == pkg_id), None)
            if not pkg:
                bot.send_message(chat_id, "Пакет не найден.", reply_markup=make_yoga_keyboard())
                chat_state[chat_id] = None
                return

            # Удаляем старое фото-превью (если было файлом)
            old_image = pkg.get("image", "")
            if old_image and old_image.startswith("/notgallery/"):
                old_path = PUBLIC_DIR / old_image.lstrip("/")
                if old_path.exists():
                    try:
                        old_path.unlink()
                    except Exception:
                        pass

            pkg["image"] = text
            write_packages(packages)

            bot.send_message(
                chat_id,
                f"✅ Превью обновлено: {text}",
                reply_markup=make_yoga_keyboard(),
            )
            chat_state[chat_id] = None
            _send_edit_pkg_menu(chat_id, pkg_id)
            return

        bot.send_message(
            chat_id,
            "Отправьте фото или эмодзи для превью.",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if state == "edit_vid_title":
        new_title = (message.text or "").strip()
        if not new_title:
            bot.send_message(chat_id, "Название не может быть пустым. Введите новое название:", reply_markup=make_yoga_keyboard())
            return

        pkg_id = chat_pkg_target.get(chat_id)
        idx = chat_edit_vid_idx.get(chat_id)
        if pkg_id is None or idx is None:
            bot.send_message(chat_id, "Ошибка: потеряны данные. Начните заново.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None)
        if not pkg or idx >= len(pkg.get("videos", [])):
            bot.send_message(chat_id, "Пакет или видео не найдены.", reply_markup=make_yoga_keyboard())
            chat_state[chat_id] = None
            return

        old_title = pkg["videos"][idx].get("title", "Без названия")
        pkg["videos"][idx]["title"] = new_title
        write_packages(packages)

        bot.send_message(
            chat_id,
            f"✅ Видео переименовано: «{old_title}» → «{new_title}»",
            reply_markup=make_yoga_keyboard(),
        )
        chat_state[chat_id] = None
        chat_edit_vid_idx.pop(chat_id, None)
        _send_edit_video_list(chat_id, pkg_id)
        return

    # ── Создание пакетов и добавление видео ──

    if state == "add_pkg_name":
        name = (message.text or "").strip()
        if not name:
            bot.send_message(
                chat_id,
                "Название не может быть пустым. Введите название пакета:",
                reply_markup=make_yoga_keyboard(),
            )
            return

        draft = chat_pkg_draft.get(chat_id, {})
        draft["name"] = name
        # Генерируем ID из названия (транслит)
        slug = re.sub(r"[^a-zA-Zа-яА-ЯёЁ0-9\s-]", "", name.lower())
        slug = re.sub(r"\s+", "-", slug.strip())
        # Простая транслитерация
        tr = {
            "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
            "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
            "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
            "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
            "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
        }
        transliterated = "".join(tr.get(c, c) for c in slug)
        transliterated = re.sub(r"-+", "-", transliterated).strip("-")
        if not transliterated:
            transliterated = f"pkg-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        draft["id"] = transliterated
        chat_pkg_draft[chat_id] = draft

        chat_state[chat_id] = "add_pkg_level"

        kb = types.InlineKeyboardMarkup()
        for level in ["Начинающий", "Средний", "Продвинутый", "Все уровни"]:
            kb.add(
                types.InlineKeyboardButton(
                    text=level,
                    callback_data=f"pkg_level:{level}",
                )
            )

        bot.send_message(
            chat_id,
            f"Название: *{name}* (ID: `{transliterated}`).\n\n"
            "Шаг 2/4: Выберите *уровень* пакета:",
            parse_mode="Markdown",
            reply_markup=kb,
        )
        return

    if state == "add_pkg_desc":
        desc = (message.text or "").strip()
        if not desc:
            bot.send_message(
                chat_id,
                "Описание не может быть пустым. Введите описание пакета:",
                reply_markup=make_yoga_keyboard(),
            )
            return

        draft = chat_pkg_draft.get(chat_id, {})
        draft["description"] = desc
        chat_pkg_draft[chat_id] = draft
        chat_state[chat_id] = "add_pkg_price"

        bot.send_message(
            chat_id,
            "Шаг 4/4: Введите *цену* пакета в рублях.\n"
            "Для бесплатного пакета введите `0`:",
            parse_mode="Markdown",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if state == "add_pkg_price":
        price_text = (message.text or "").strip()
        try:
            price = int(price_text)
            if price < 0:
                raise ValueError()
        except ValueError:
            bot.send_message(
                chat_id,
                "Введите корректную цену (целое число >= 0):",
                reply_markup=make_yoga_keyboard(),
            )
            return

        draft = chat_pkg_draft.get(chat_id, {})
        draft["price"] = price
        chat_pkg_draft[chat_id] = draft
        chat_state[chat_id] = "add_pkg_preview"

        bot.send_message(
            chat_id,
            f"Цена: *{price} ₽*.\n\n" if price > 0 else "Цена: *Бесплатно*.\n\n",
            parse_mode="Markdown",
        )
        bot.send_message(
            chat_id,
            "Шаг 5/5: Задайте *превью* для пакета.\n\n"
            "• Отправьте *фото* — обложка пакета\n"
            "• Отправьте *эмодзи* (например 🧘 или 🔥) — будет вместо картинки\n"
            "• Или напишите `Без превью`",
            parse_mode="Markdown",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if state == "add_pkg_preview":
        text = (message.text or "").strip()
        if text.lower() in ("без превью", "нет превью", "нет"):
            _finalize_new_package(chat_id, image_path="")
            return
        # Короткий текст (до 10 символов, не начинается с /) — считаем эмодзи
        if text and len(text) <= 10 and not text.startswith("/"):
            _finalize_new_package(chat_id, image_path=text)
            return
        bot.send_message(
            chat_id,
            "Отправьте фото, эмодзи или напишите `Без превью`.",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if state == "add_video_title":
        title = (message.text or "").strip()
        if not title:
            bot.send_message(
                chat_id,
                "Название видео не может быть пустым. Введите название:",
                reply_markup=make_yoga_keyboard(),
            )
            return

        draft = chat_video_draft.get(chat_id, {})
        draft["title"] = title
        chat_video_draft[chat_id] = draft
        chat_state[chat_id] = "add_video_duration"

        bot.send_message(
            chat_id,
            f"Название: *{title}*.\n\n"
            "Шаг 2/3: Введите *длительность* видео (например, `30 мин`):",
            parse_mode="Markdown",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if state == "add_video_duration":
        duration = (message.text or "").strip()
        if not duration:
            bot.send_message(
                chat_id,
                "Длительность не может быть пустой. Введите длительность (напр. `25 мин`):",
                reply_markup=make_yoga_keyboard(),
            )
            return

        draft = chat_video_draft.get(chat_id, {})
        draft["duration"] = duration
        chat_video_draft[chat_id] = draft

        # Показываем текущий список видео и спрашиваем позицию
        pkg_id = chat_pkg_target.get(chat_id)
        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None) if pkg_id else None
        videos = pkg.get("videos", []) if pkg else []

        if not videos:
            # Пакет пуст — видео будет первым, пропускаем вопрос о позиции
            draft["position"] = 1
            chat_video_draft[chat_id] = draft
            chat_state[chat_id] = "add_video_file"
            bot.send_message(
                chat_id,
                f"Длительность: *{duration}*.\n"
                "Пакет пока пуст — видео будет первым.\n\n"
                "Шаг 4/4: Отправьте *видеофайл*.\n\n"
                "• Отправьте видео или документ — файл сохранится в `public/videos/`\n"
                "• Или отправьте текстом ссылку на видео (URL)",
                parse_mode="Markdown",
                reply_markup=make_yoga_keyboard(),
            )
        else:
            chat_state[chat_id] = "add_video_position"
            lines = [f"Длительность: *{duration}*.\n"]
            lines.append("Текущие видео в пакете:")
            for i, v in enumerate(videos, 1):
                lines.append(f"  {i}. {v.get('title', 'Без названия')}")
            lines.append(f"\nШаг 3/4: Введите *номер позиции* для нового видео (1–{len(videos)+1}).")
            lines.append(f"Например, `{len(videos)+1}` — в конец, `1` — в начало.")
            bot.send_message(
                chat_id,
                "\n".join(lines),
                parse_mode="Markdown",
                reply_markup=make_yoga_keyboard(),
            )
        return

    if state == "add_video_position":
        pos_text = (message.text or "").strip()
        pkg_id = chat_pkg_target.get(chat_id)
        packages = read_packages()
        pkg = next((p for p in packages if p["id"] == pkg_id), None) if pkg_id else None
        total = len(pkg.get("videos", [])) if pkg else 0

        try:
            pos = int(pos_text)
            if pos < 1 or pos > total + 1:
                raise ValueError()
        except ValueError:
            bot.send_message(
                chat_id,
                f"Введите число от 1 до {total + 1}:",
                reply_markup=make_yoga_keyboard(),
            )
            return

        draft = chat_video_draft.get(chat_id, {})
        draft["position"] = pos
        chat_video_draft[chat_id] = draft
        chat_state[chat_id] = "add_video_file"

        bot.send_message(
            chat_id,
            f"Позиция: *{pos}*.\n\n"
            "Шаг 4/4: Отправьте *видеофайл*.\n\n"
            "• Отправьте видео или документ — файл сохранится в `public/videos/`\n"
            "• Или отправьте текстом ссылку на видео (URL)",
            parse_mode="Markdown",
            reply_markup=make_yoga_keyboard(),
        )
        return

    if state == "add_video_file":
        # Текстовое сообщение: либо URL, либо «Пропустить»
        text = (message.text or "").strip()
        if not text:
            bot.send_message(
                chat_id,
                "Отправьте видеофайл или ссылку на видео.",
                reply_markup=make_yoga_keyboard(),
            )
            return

        pkg_id = chat_pkg_target.get(chat_id)
        draft = chat_video_draft.get(chat_id, {})

        if text.startswith("http://") or text.startswith("https://") or text.startswith("/"):
            draft["videoUrl"] = text
        else:
            bot.send_message(
                chat_id,
                "Отправьте видеофайл или ссылку на видео (начинается с http).",
                reply_markup=make_yoga_keyboard(),
            )
            return

        # Сохраняем видео в пакет
        _save_video_to_package(chat_id, pkg_id, draft)
        return

    if state == "add_slot":
        handle_add_slot(chat_id, message.text)
        return
    if state == "del_slot":
        handle_delete_slot(chat_id, message.text)
        return

    # Если никакого спец-режима нет — подскажем, что можно сделать
    bot.send_message(
        chat_id,
        "Я вас понял, но не знаю, что с этим сделать 🙂\n\n"
        "Используйте команды /start, /slots или кнопки под клавиатурой.",
        reply_markup=make_main_keyboard(),
    )


if __name__ == "__main__":
    print("Бот запущен. Уведомления приходят с сайта, бот отвечает на /start.")
    print("Нажмите Ctrl+C для остановки.")
    bot.infinity_polling()
