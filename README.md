apt update

apt install nano -y

apt install -y python3 python3-pip python3-venv

pip install --break-system-packages fastapi uvicorn[standard] pydantic jinja2

apt install -y npm nodejs



uvicorn main:app --host 0.0.0.0 --port 8009 --reload

npm create vite@latest vue

npm run dev -- --host 0.0.0.0

nginx -c /home/xct258/nginx/nginx.conf
