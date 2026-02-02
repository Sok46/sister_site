# Развёртывание на VPS (Ubuntu)

## Требования к хостингу

- SSH-доступ к серверу
- Ubuntu (или другой Linux)
- Минимум 1 ГБ RAM

---

## Вариант А: через Git (рекомендуется)

Проект клонируется на сервер, сборка выполняется на сервере.

### 1. На сервере: установить Node.js и Git

Подключитесь по SSH (подставьте свой логин и IP или домен):

```bash
ssh ваш_логин@IP_или_домен_сервера
```

Установите Node.js 20 и Git:

```bash
sudo apt update
sudo apt install -y git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Проверьте: `node -v` (должно быть v18 или выше), `npm -v`.

### 2. Клонировать проект и собрать

Выберите папку для сайта, например `/var/www/sister_site` или домашнюю `~/sister_site`:

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www
git clone URL_ВАШЕГО_РЕПОЗИТОРИЯ sister_site
cd sister_site
```

Если репозиторий приватный — настройте SSH-ключ или токен на сервере.

Установите зависимости и соберите проект:

```bash
npm ci
npm run build
```

### 3. Переменные окружения (.env)

Создайте файл `.env` в папке проекта (для уведомлений в Telegram при записи):

```bash
nano .env
```

Вставьте (подставьте свои значения):

```
TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather
TELEGRAM_ADMIN_CHAT_ID=ваш_chat_id
```

Сохраните: `Ctrl+O`, Enter, `Ctrl+X`. Токен и chat_id можно получить по инструкции в проекте (Telegram-бот).

### 4. Запуск через PM2

```bash
sudo npm install -g pm2
pm2 start npm --name "sister-site" -- start
pm2 startup
pm2 save
```

Сайт будет слушать порт **3000**. Проверка: откройте в браузере `http://IP_сервера:3000`.

### 5. Права на запись (для бронирований)

Чтобы записи сохранялись в `content/bookings/`:

```bash
chmod -R u+w /var/www/sister_site/content/bookings
```

### 6. Nginx + домен + SSL (опционально)

Чтобы сайт открывался по домену (например `https://ваш-сайт.ru`) и по 80/443 порту:

Установите Nginx и создайте конфиг сайта:

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/sister_site
```

Вставьте (замените `ваш-домен.ru` на свой домен или IP):

```nginx
server {
    listen 80;
    server_name ваш-домен.ru;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Включите сайт и перезапустите Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/sister_site /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

SSL (HTTPS) через Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.ru
```

Дальше certbot подскажет шаги. После этого сайт будет доступен по `https://ваш-домен.ru`.

---

## Вариант Б: без Git (заливка файлов с компьютера)

Если репозитория нет — соберите проект на своём ПК и загрузите файлы.

### 1. Локально (на вашем ПК)

В папке проекта:

```bash
npm run build
```

Должна появиться папка `.next`.

### 2. Загрузить на сервер

Нужно загрузить: весь проект (включая `.next`, `public`, `content`, `package.json`, `package-lock.json`, `next.config.js` и т.д.). Удобнее всего — архивом или через rsync/scp.

Пример через SCP (из папки проекта на ПК, подставьте логин и адрес сервера):

```bash
scp -r .next package.json package-lock.json next.config.js public content app components lib ваш_логин@IP_сервера:/var/www/sister_site/
```

Или упакуйте проект в `sister_site.tar.gz`, загрузите архив на сервер и там распакуйте.

### 3. На сервере

Предварительно установите Node.js и создайте папку (см. вариант А, шаг 1). Затем:

```bash
cd /var/www/sister_site
npm ci --omit=dev
```

Создайте `.env` (как в варианте А, шаг 3), настройте права на `content/bookings` и запустите через PM2 (шаги 4–5 варианта А).

---

## Обновление сайта (после изменений)

**Если используете Git:**

```bash
cd /var/www/sister_site
git pull
npm ci
npm run build
pm2 restart sister-site
```

**Если заливаете вручную:** заново загрузите изменённые файлы, на сервере выполните `npm run build` (если менялся код) и `pm2 restart sister-site`.

---

## Краткая шпаргалка (уже всё установлено)

```bash
ssh ваш_логин@сервер
cd /var/www/sister_site
git pull && npm ci && npm run build
pm2 restart sister-site
```

---

## Проверка

- Сайт открывается по адресу (домен или `http://IP:3000`).
- Форма записи на занятие отправляется и запись появляется.
- В Telegram приходит уведомление о новой записи (если настроен `.env`).

## Важно

- Папки `content/bookings/` и при необходимости `content/posts/` должны быть доступны для записи процессом Node (владелец папки — пользователь, под которым запущен PM2).
- Файл `.env` не коммитить в Git — он только на сервере.
