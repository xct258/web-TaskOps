需要nmp反向代理后端地址
```
location /api/ {
    proxy_pass http://127.0.0.1:8009/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```