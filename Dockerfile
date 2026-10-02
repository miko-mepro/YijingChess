# 使用带原生环境文件支持的 Node.js LTS；应用无需前端构建。
FROM node:24-alpine
WORKDIR /app

# 先安装锁定依赖，源码变动不会重复下载全部依赖。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public

# 非 root 身份运行；房间均在内存中，无需写入容器文件系统。
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5500
EXPOSE 5500
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5500/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 直接启动 Node.js，避免只读容器中 npm 创建缓存日志。
CMD ["node", "server/index.js"]
