#!/usr/bin/env python3
"""
Telegram-бот для получения уведомлений о записях на йогу.
Уведомления приходят автоматически с сайта при каждой новой записи.
Слоты добавляются вручную в файл content/bookings/available-slots.json
"""
import json
import os
import re
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

BASE_DIR = Path(__file__).resolve().parent.parent
SLOTS_FILE = BASE_DIR / "content" / "bookings" / "available-slots.json"
BOOKINGS_FILE = BASE_DIR / "content" / "bookings" / "bookings.json"
POSTS_DIR = BASE_DIR / "content" / "posts"
PAGE_SIZE_POSTS = 5
PUBLIC_DIR = BASE_DIR / "public"

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
    ]
]
chat_state: Dict[int, StateType] = {}

# Для добавления/редактирования постов и файлов: временно храним имя файла/папки на пользователя
chat_post_files: Dict[int, str] = {}            # для нового поста (add_post_preview)
chat_edit_post_files: Dict[int, str] = {}       # для редактирования существующего поста
chat_upload_dirs: Dict[int, str] = {}           # для загрузки файлов в public/<dir>
chat_rename_targets: Dict[int, tuple[str, str]] = {}  # (dir_name, filename) для переименования


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
        "• «Управление блогом» — работа с постами (в разработке)\n\n"
        "Технически слоты хранятся в available-slots.json, записи — в bookings.json."
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


@bot.message_handler(func=lambda m: m.text in ["Управление расписанием", "Управление блогом", "⬅️ В главное меню"])
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
    bot.send_message(
        chat_id,
        "Отправьте *одним сообщением* полный текст поста в формате markdown.\n\n"
        "Файл должен выглядеть примерно так:\n"
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
        "```\n\n"
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
        "Текст под второй строкой `---` — это тело поста (markdown: заголовки, списки, картинки, ссылки).",
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
    try:
        if ext in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
            with open(path, "rb") as f:
                bot.send_photo(chat_id, f, caption=filename)
        elif ext in [".mp4", ".mov", ".avi"]:
            with open(path, "rb") as f:
                bot.send_video(chat_id, f, caption=filename)
        elif ext in [".mp3", ".wav"]:
            with open(path, "rb") as f:
                bot.send_audio(chat_id, f, caption=filename)
        else:
            with open(path, "rb") as f:
                bot.send_document(chat_id, f, caption=filename)

        # После успешной отправки предлагаем удалить или переименовать файл
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
        bot.send_message(
            chat_id,
            f"Файл `{filename}` отправлен.\nВы можете удалить его с сервера:",
            parse_mode="Markdown",
            reply_markup=kb,
        )
    except Exception as e:
        bot.send_message(
            chat_id,
            f"Не удалось отправить файл: {e}",
            reply_markup=make_blog_keyboard(),
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

    # 2) Загрузка файла в public/<dir> через «Управление файлами»
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
